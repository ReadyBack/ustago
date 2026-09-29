import {
  providerOnboardingStatusSchema,
  providerProfileSchema,
  providerVerificationSchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createTestApp,
  registerUser,
  resetRateLimits,
  RUN_ID,
  type TestContext,
} from './helpers.js';
import {
  catalog,
  type Catalog,
  completeOnboarding,
  createUploadIntent,
  draftProvider,
  FILES,
  pathOf,
  PROFILE,
  putFile,
} from './provider-helpers.js';

describe('Provider onboarding (e2e)', () => {
  let ctx: TestContext;
  let c: Catalog;

  beforeAll(async () => {
    ctx = await createTestApp({ VERIFICATION_MAX_FILE_BYTES: '4096' });
    await resetRateLimits(ctx, 'rl:otp:*');
    c = await catalog(ctx);
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  describe('onboarding status and submit', () => {
    it('starts in DRAFT with every step but the phone missing', async () => {
      const provider = await draftProvider(ctx);
      const res = await ctx
        .http()
        .get('/api/v1/providers/me/onboarding')
        .set('Authorization', bearer(provider))
        .expect(200);
      const status = providerOnboardingStatusSchema.parse(res.body);
      expect(status).toMatchObject({
        providerStatus: 'DRAFT',
        phoneVerified: true,
        canSubmit: false,
        requiredVerificationTypes: ['IDENTITY'],
      });
      expect(status.missingSteps).toEqual([
        'PROFILE',
        'SERVICES',
        'SERVICE_AREAS',
        'REQUIRED_VERIFICATIONS',
      ]);
    });

    it('requires a verified phone', async () => {
      const account = await registerUser(ctx, { accountType: 'PROVIDER' });
      const res = await ctx
        .http()
        .get('/api/v1/providers/me/onboarding')
        .set('Authorization', bearer(account))
        .expect(200);
      expect(res.body.missingSteps).toContain('PHONE_VERIFIED');
    });

    it('refuses an incomplete application with the missing steps', async () => {
      const provider = await draftProvider(ctx);
      const res = await ctx
        .http()
        .post('/api/v1/providers/me/submit')
        .set('Authorization', bearer(provider))
        .expect(422);
      expect(res.body.code).toBe('PROVIDER_ONBOARDING_INCOMPLETE');
      expect(res.body.details.missingSteps).toContain('REQUIRED_VERIFICATIONS');
    });

    it('submits a complete application once, even when retried or raced', async () => {
      const provider = await draftProvider(ctx);
      await completeOnboarding(ctx, provider, c);
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          ctx.http().post('/api/v1/providers/me/submit').set('Authorization', bearer(provider)),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const profile = providerProfileSchema.parse(results[0]?.body);
      expect(profile.status).toBe('PENDING_REVIEW');
      expect(profile.submittedAt).not.toBeNull();

      const again = await ctx
        .http()
        .post('/api/v1/providers/me/submit')
        .set('Authorization', bearer(provider))
        .expect(200);
      expect(again.body.submittedAt).toBe(profile.submittedAt);
      const events = await ctx.prisma.auditLog.count({
        where: { action: 'provider.application_submitted', entityId: provider.providerId },
      });
      expect(events).toBe(1);
    });

    it('locks the application while it is under review', async () => {
      const provider = await draftProvider(ctx);
      await completeOnboarding(ctx, provider, c);
      await ctx.http().post('/api/v1/providers/me/submit').set('Authorization', bearer(provider));
      const auth = bearer(provider);

      const edits = [
        ctx
          .http()
          .patch('/api/v1/providers/me')
          .set('Authorization', auth)
          .send({ bio: 'x'.repeat(30) }),
        ctx
          .http()
          .put('/api/v1/providers/me/services')
          .set('Authorization', auth)
          .send({ categoryIds: [c.plainCategoryId] }),
        ctx
          .http()
          .put('/api/v1/providers/me/service-areas')
          .set('Authorization', auth)
          .send({ areas: [] }),
        ctx
          .http()
          .post('/api/v1/providers/me/verifications/upload-intent')
          .set('Authorization', auth)
          .send({ type: 'IDENTITY', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 100 }),
      ];
      for (const res of await Promise.all(edits)) {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_PROVIDER_STATE');
      }
      const reapply = await ctx
        .http()
        .post('/api/v1/providers/me/reapply')
        .set('Authorization', auth)
        .expect(409);
      expect(reapply.body.code).toBe('INVALID_PROVIDER_STATE');
    });

    it('never lets a pending provider become available', async () => {
      const provider = await draftProvider(ctx);
      await completeOnboarding(ctx, provider, c);
      await ctx.http().post('/api/v1/providers/me/submit').set('Authorization', bearer(provider));
      const res = await ctx
        .http()
        .patch('/api/v1/providers/me/availability')
        .set('Authorization', bearer(provider))
        .send({ isAvailableNow: true })
        .expect(409);
      expect(res.body.code).toBe('PROVIDER_NOT_ACTIVE');
    });
  });

  describe('services and service areas', () => {
    it('accepts only active categories and replaces the list', async () => {
      const provider = await draftProvider(ctx);
      const inactive = await ctx.prisma.serviceCategory.create({
        data: { slug: `e2e-${RUN_ID}-off-${Date.now()}`, name: 'Kapalı', isActive: false },
      });
      const bad = await ctx
        .http()
        .put('/api/v1/providers/me/services')
        .set('Authorization', bearer(provider))
        .send({ categoryIds: [c.plainCategoryId, inactive.id] })
        .expect(422);
      expect(bad.body.code).toBe('CATEGORY_NOT_AVAILABLE');
      expect(bad.body.details.categoryIds).toEqual([inactive.id]);

      const ok = await ctx
        .http()
        .put('/api/v1/providers/me/services')
        .set('Authorization', bearer(provider))
        .send({ categoryIds: [c.plainCategoryId] })
        .expect(200);
      expect(ok.body.map((s: { categoryId: string }) => s.categoryId)).toEqual([c.plainCategoryId]);

      const dupes = await ctx
        .http()
        .put('/api/v1/providers/me/services')
        .set('Authorization', bearer(provider))
        .send({ categoryIds: [c.plainCategoryId, c.plainCategoryId] })
        .expect(400);
      expect(dupes.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a district sent under the wrong province', async () => {
      const provider = await draftProvider(ctx);
      const res = await ctx
        .http()
        .put('/api/v1/providers/me/service-areas')
        .set('Authorization', bearer(provider))
        .send({ areas: [{ provinceId: c.provinceId, districtIds: [c.otherProvinceDistrictId] }] })
        .expect(422);
      expect(res.body.code).toBe('DISTRICT_PROVINCE_MISMATCH');
    });

    it('stores areas grouped by province', async () => {
      const provider = await draftProvider(ctx);
      const res = await ctx
        .http()
        .put('/api/v1/providers/me/service-areas')
        .set('Authorization', bearer(provider))
        .send({ areas: [{ provinceId: c.provinceId, districtIds: c.districtIds }] })
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].province.id).toBe(c.provinceId);
      expect(res.body[0].districts).toHaveLength(c.districtIds.length);
    });

    it('keeps the NOW preference only with a NOW-capable category', async () => {
      const provider = await draftProvider(ctx);
      const auth = bearer(provider);
      await ctx
        .http()
        .put('/api/v1/providers/me/services')
        .set('Authorization', auth)
        .send({ categoryIds: [c.plainCategoryId] })
        .expect(200);
      const refused = await ctx
        .http()
        .patch('/api/v1/providers/me/availability')
        .set('Authorization', auth)
        .send({ nowEnabled: true })
        .expect(422);
      expect(refused.body.code).toBe('NOW_CATEGORY_NOT_SUPPORTED');

      await ctx
        .http()
        .put('/api/v1/providers/me/services')
        .set('Authorization', auth)
        .send({ categoryIds: [c.nowCategoryId] })
        .expect(200);
      const saved = await ctx
        .http()
        .patch('/api/v1/providers/me/availability')
        .set('Authorization', auth)
        .send({ nowEnabled: true })
        .expect(200);
      expect(saved.body).toMatchObject({ nowEnabled: true, isAvailableNow: false });

      // Dropping the last NOW-capable category ends the preference.
      await ctx
        .http()
        .put('/api/v1/providers/me/services')
        .set('Authorization', auth)
        .send({ categoryIds: [c.plainCategoryId] })
        .expect(200);
      const me = await ctx
        .http()
        .get('/api/v1/providers/me')
        .set('Authorization', auth)
        .expect(200);
      expect(me.body.nowEnabled).toBe(false);
    });
  });

  describe('verification uploads', () => {
    it('stores the document privately under a random key', async () => {
      const provider = await draftProvider(ctx);
      const intent = await createUploadIntent(ctx, provider, {
        fileName: '../../etc/passwd/kimlik.png',
      });
      expect(intent.method).toBe('PUT');
      expect(intent.uploadUrl).not.toContain('kimlik');
      await putFile(ctx, intent, FILES.png).expect(204);

      const res = await ctx
        .http()
        .post('/api/v1/providers/me/verifications')
        .set('Authorization', bearer(provider))
        .send({ type: 'IDENTITY', uploadId: intent.uploadId })
        .expect(201);
      const verification = providerVerificationSchema.parse(res.body);
      expect(verification).toMatchObject({ status: 'PENDING', mimeType: 'image/png' });
      expect(verification.originalFileName).not.toMatch(/[/\\]|\.\./);
      expect(JSON.stringify(res.body)).not.toMatch(/documentKey|verifications\//);

      const row = await ctx.prisma.providerVerification.findUniqueOrThrow({
        where: { id: verification.id },
      });
      expect(row.documentKey).toMatch(
        new RegExp(`^verifications/${provider.providerId}/[0-9a-f-]{36}\\.png$`),
      );

      // The upload link is single-use: it cannot swap the inspected file.
      const swap = await putFile(ctx, intent, FILES.html);
      expect(swap.status).toBe(409);
      // And the intent cannot be submitted twice.
      const replay = await ctx
        .http()
        .post('/api/v1/providers/me/verifications')
        .set('Authorization', bearer(provider))
        .send({ type: 'IDENTITY', uploadId: intent.uploadId })
        .expect(404);
      expect(replay.body.code).toBe('UPLOAD_NOT_FOUND');
    });

    it.each([
      ['image/svg+xml', 'logo.svg'],
      ['application/x-msdownload', 'kimlik.exe'],
      ['text/html', 'kimlik.html'],
    ])('refuses %s uploads', async (mimeType, fileName) => {
      const provider = await draftProvider(ctx);
      const res = await ctx
        .http()
        .post('/api/v1/providers/me/verifications/upload-intent')
        .set('Authorization', bearer(provider))
        .send({ type: 'IDENTITY', fileName, mimeType, sizeBytes: 100 })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('refuses files over the size limit, declared or actual', async () => {
      const provider = await draftProvider(ctx);
      const declared = await ctx
        .http()
        .post('/api/v1/providers/me/verifications/upload-intent')
        .set('Authorization', bearer(provider))
        .send({ type: 'IDENTITY', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 5000 })
        .expect(422);
      expect(declared.body.code).toBe('INVALID_VERIFICATION_FILE');

      const intent = await createUploadIntent(ctx, provider);
      const big = Buffer.concat([FILES.png, Buffer.alloc(5000)]);
      const res = await putFile(ctx, intent, big);
      expect(res.status).toBe(413);
    });

    it('checks the content, not the declared type', async () => {
      const provider = await draftProvider(ctx);
      const intent = await createUploadIntent(ctx, provider);
      await putFile(ctx, intent, FILES.html).expect(204);
      const res = await ctx
        .http()
        .post('/api/v1/providers/me/verifications')
        .set('Authorization', bearer(provider))
        .send({ type: 'IDENTITY', uploadId: intent.uploadId })
        .expect(422);
      expect(res.body.code).toBe('INVALID_VERIFICATION_FILE');
    });

    it('requires the upload to have happened', async () => {
      const provider = await draftProvider(ctx);
      const intent = await createUploadIntent(ctx, provider);
      const res = await ctx
        .http()
        .post('/api/v1/providers/me/verifications')
        .set('Authorization', bearer(provider))
        .send({ type: 'IDENTITY', uploadId: intent.uploadId })
        .expect(422);
      expect(res.body.code).toBe('UPLOAD_NOT_COMPLETED');
    });

    it('does not let one provider submit another provider’s upload', async () => {
      const owner = await draftProvider(ctx);
      const thief = await draftProvider(ctx);
      const intent = await createUploadIntent(ctx, owner);
      await putFile(ctx, intent, FILES.png).expect(204);
      const res = await ctx
        .http()
        .post('/api/v1/providers/me/verifications')
        .set('Authorization', bearer(thief))
        .send({ type: 'IDENTITY', uploadId: intent.uploadId })
        .expect(404);
      expect(res.body.code).toBe('UPLOAD_NOT_FOUND');
    });

    it('rejects tampered links and wrong content types', async () => {
      const provider = await draftProvider(ctx);
      const intent = await createUploadIntent(ctx, provider);
      const path = pathOf(intent.uploadUrl);
      const tampered = `${path.slice(0, -3)}${path.endsWith('a') ? 'bbb' : 'aaa'}`;
      const forged = await ctx
        .http()
        .put(tampered)
        .set('Content-Type', 'image/png')
        .send(FILES.png)
        .expect(403);
      expect(forged.body.code).toBe('STORAGE_LINK_INVALID');

      const mismatch = await putFile(ctx, intent, FILES.pdf, 'application/pdf').expect(400);
      expect(mismatch.body.code).toBe('STORAGE_CONTENT_TYPE_MISMATCH');

      // An upload link cannot be used to read.
      await ctx.http().get(path).expect(403);
    });

    it('replaces a pending document while the application is still a draft', async () => {
      const provider = await draftProvider(ctx);
      const upload = async () => {
        const intent = await createUploadIntent(ctx, provider);
        await putFile(ctx, intent, FILES.png).expect(204);
        return ctx
          .http()
          .post('/api/v1/providers/me/verifications')
          .set('Authorization', bearer(provider))
          .send({ type: 'IDENTITY', uploadId: intent.uploadId })
          .expect(201);
      };
      await upload();
      await upload();
      const pending = await ctx.prisma.providerVerification.count({
        where: { providerId: provider.providerId, status: 'PENDING' },
      });
      expect(pending).toBe(1);
    });
  });

  it('keeps profile validation strict', async () => {
    const provider = await draftProvider(ctx);
    const res = await ctx
      .http()
      .patch('/api/v1/providers/me')
      .set('Authorization', bearer(provider))
      .send({ ...PROFILE, status: 'ACTIVE' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
