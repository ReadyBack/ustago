import {
  adminProviderDetailSchema,
  adminProviderListItemSchema,
  auditEventSchema,
  paginatedSchema,
  publicProviderProfileSchema,
  signedUrlSchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  phoneLogin,
  registerUser,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  catalog,
  type Catalog,
  draftProvider,
  FILES,
  pathOf,
  pendingProvider,
  uploadVerification,
} from './provider-helpers.js';

const REASON = 'Kimlik fotoğrafı okunamıyor, lütfen yeniden yükleyin.';

describe('Admin review of providers (e2e)', () => {
  let ctx: TestContext;
  let c: Catalog;
  let admin: string;
  let provinceWasActive: boolean;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx, 'rl:otp:*');
    c = await catalog(ctx);
    admin = bearer(await createStaffUser(ctx, ['ADMIN']));
    provinceWasActive = (
      await ctx.prisma.province.findUniqueOrThrow({ where: { id: c.provinceId } })
    ).isActive;
  });

  afterAll(async () => {
    await ctx.prisma.province.update({
      where: { id: c.provinceId },
      data: { isActive: provinceWasActive },
    });
    await cleanup(ctx);
    await ctx.app.close();
  });

  const post = (path: string, body: Record<string, unknown> = {}, auth = admin) =>
    ctx.http().post(`/api/v1/admin${path}`).set('Authorization', auth).send(body);

  it('keeps every admin route behind the ADMIN role', async () => {
    const customer = bearer(await registerUser(ctx));
    const provider = await pendingProvider(ctx, c);
    const routes = [
      () => ctx.http().get('/api/v1/admin/providers'),
      () => ctx.http().get(`/api/v1/admin/providers/${provider.providerId}`),
      () => ctx.http().get('/api/v1/admin/provider-verifications'),
      () => ctx.http().get('/api/v1/admin/audit-events'),
      () => ctx.http().post(`/api/v1/admin/providers/${provider.providerId}/approve`),
      () =>
        ctx.http().post(`/api/v1/admin/provider-verifications/${provider.verificationId}/approve`),
      () =>
        ctx
          .http()
          .post(`/api/v1/admin/provider-verifications/${provider.verificationId}/document-url`),
    ];
    for (const route of routes) {
      const res = await route().set('Authorization', customer);
      expect(res.status).toBe(403);
    }
    await ctx.http().get('/api/v1/admin/providers').expect(401);
    // The provider cannot review itself through the admin API either.
    await post(`/providers/${provider.providerId}/approve`, {}, bearer(provider)).expect(403);
  });

  it('lists pending applications oldest first without private fields', async () => {
    const first = await pendingProvider(ctx, c);
    const second = await pendingProvider(ctx, c);
    const res = await ctx
      .http()
      .get('/api/v1/admin/providers')
      .query({ status: 'PENDING_REVIEW', limit: 100 })
      .set('Authorization', admin)
      .expect(200);
    const page = paginatedSchema(adminProviderListItemSchema).parse(res.body);
    const ids = page.items.map((p) => p.id);
    expect(ids.indexOf(first.providerId)).toBeLessThan(ids.indexOf(second.providerId));
    expect(page.items.every((p) => p.status === 'PENDING_REVIEW')).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/documentKey|passwordHash|tcKimlik/i);
  });

  it('runs the full review: document → verification → provider approval', async () => {
    const provider = await pendingProvider(ctx, c);

    const detailRes = await ctx
      .http()
      .get(`/api/v1/admin/providers/${provider.providerId}`)
      .set('Authorization', admin)
      .expect(200);
    const detail = adminProviderDetailSchema.parse(detailRes.body);
    expect(detail.status).toBe('PENDING_REVIEW');
    expect(detail.verifications[0]).toMatchObject({ status: 'PENDING', hasDocument: true });
    expect(JSON.stringify(detailRes.body)).not.toMatch(/documentKey|verifications\//);

    // Provider approval waits for the identity document.
    const early = await post(`/providers/${provider.providerId}/approve`).expect(422);
    expect(early.body.code).toBe('VERIFICATION_REQUIRED');
    expect(early.body.details.missingVerificationTypes).toEqual(['IDENTITY']);

    // The document is only reachable through a short-lived signed link.
    const link = signedUrlSchema.parse(
      (await post(`/provider-verifications/${provider.verificationId}/document-url`).expect(200))
        .body,
    );
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
    const doc = await ctx.http().get(pathOf(link.url)).buffer(true).expect(200);
    expect(doc.headers['content-type']).toBe('image/png');
    expect(doc.headers['cache-control']).toBe('private, no-store');
    expect(doc.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(doc.body as Buffer, FILES.png)).toBe(0);
    // A download link cannot be used to upload.
    await ctx
      .http()
      .put(pathOf(link.url))
      .set('Content-Type', 'image/png')
      .send(FILES.png)
      .expect(403);

    const noReason = await post(`/provider-verifications/${provider.verificationId}/reject`).expect(
      400,
    );
    expect(noReason.body.code).toBe('VALIDATION_FAILED');

    const approved = await post(
      `/provider-verifications/${provider.verificationId}/approve`,
    ).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED' });
    expect(approved.body.reviewedAt).not.toBeNull();
    const twice = await post(`/provider-verifications/${provider.verificationId}/reject`, {
      reason: REASON,
    }).expect(409);
    expect(twice.body.code).toBe('VERIFICATION_ALREADY_REVIEWED');

    const active = await post(`/providers/${provider.providerId}/approve`).expect(200);
    expect(active.body).toMatchObject({ status: 'ACTIVE', isAvailableNow: false });

    const again = await post(`/providers/${provider.providerId}/approve`).expect(409);
    expect(again.body.code).toBe('INVALID_PROVIDER_STATE');

    // The trail names who did what, without document keys.
    const audit = await ctx
      .http()
      .get('/api/v1/admin/audit-events')
      .query({ entityType: 'provider_profile', entityId: provider.providerId })
      .set('Authorization', admin)
      .expect(200);
    const events = paginatedSchema(auditEventSchema).parse(audit.body);
    expect(events.items.map((e) => e.action)).toEqual(
      expect.arrayContaining(['provider.approved', 'provider.application_submitted']),
    );
    const accessed = await ctx.prisma.auditLog.count({
      where: { action: 'verification.document_accessed', entityId: provider.verificationId },
    });
    expect(accessed).toBe(1);
    expect(JSON.stringify(audit.body)).not.toMatch(/verifications\//);
  });

  it('lets only one of two concurrent reviewers decide a document', async () => {
    const provider = await pendingProvider(ctx, c);
    const second = bearer(await createStaffUser(ctx, ['ADMIN']));
    const results = await Promise.all([
      post(`/provider-verifications/${provider.verificationId}/approve`),
      post(`/provider-verifications/${provider.verificationId}/reject`, { reason: REASON }, second),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = await ctx.prisma.providerVerification.findUniqueOrThrow({
      where: { id: provider.verificationId },
    });
    expect(['APPROVED', 'REJECTED']).toContain(row.status);
  });

  it('rejects with a reason, lets the provider fix it and apply again', async () => {
    const provider = await pendingProvider(ctx, c);
    await post(`/provider-verifications/${provider.verificationId}/reject`, {
      reason: REASON,
    }).expect(200);
    const rejected = await post(`/providers/${provider.providerId}/reject`, {
      reason: REASON,
    }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', statusReason: REASON });

    const auth = bearer(provider);
    const onboarding = await ctx
      .http()
      .get('/api/v1/providers/me/onboarding')
      .set('Authorization', auth)
      .expect(200);
    expect(onboarding.body).toMatchObject({ providerStatus: 'REJECTED', statusReason: REASON });
    expect(onboarding.body.missingSteps).toContain('REQUIRED_VERIFICATIONS');

    // Submitting straight from REJECTED is not allowed; reapply first.
    const direct = await ctx
      .http()
      .post('/api/v1/providers/me/submit')
      .set('Authorization', auth)
      .expect(409);
    expect(direct.body.code).toBe('INVALID_PROVIDER_STATE');

    await ctx.http().post('/api/v1/providers/me/reapply').set('Authorization', auth).expect(200);
    await uploadVerification(ctx, provider);
    const resubmitted = await ctx
      .http()
      .post('/api/v1/providers/me/submit')
      .set('Authorization', auth)
      .expect(200);
    expect(resubmitted.body).toMatchObject({ status: 'PENDING_REVIEW', statusReason: null });
  });

  it('refuses to let an admin review their own application', async () => {
    // An employee who also works as a provider.
    const applicant = await draftProvider(ctx);
    const pending = await pendingProviderFor(applicant);
    const user = await ctx.prisma.user.update({
      where: { id: applicant.userId },
      data: { roles: { create: { role: 'ADMIN' } } },
    });
    const asAdmin = bearer(await phoneLogin(ctx, user.phone ?? ''));

    const doc = await post(
      `/provider-verifications/${pending.verificationId}/approve`,
      {},
      asAdmin,
    );
    expect(doc.status).toBe(403);
    expect(doc.body.code).toBe('CANNOT_REVIEW_SELF');
    const profile = await post(`/providers/${applicant.providerId}/approve`, {}, asAdmin);
    expect(profile.status).toBe(403);
    expect(profile.body.code).toBe('CANNOT_REVIEW_SELF');
  });

  it('suspends and reinstates an active provider, ending availability', async () => {
    const provider = await pendingProvider(ctx, c);
    await post(`/provider-verifications/${provider.verificationId}/approve`).expect(200);
    await post(`/providers/${provider.providerId}/approve`).expect(200);

    await ctx.prisma.province.update({ where: { id: c.provinceId }, data: { isActive: true } });
    const auth = bearer(provider);
    const on = await ctx
      .http()
      .patch('/api/v1/providers/me/availability')
      .set('Authorization', auth)
      .send({ nowEnabled: true, isAvailableNow: true })
      .expect(200);
    expect(on.body).toMatchObject({ nowEnabled: true, isAvailableNow: true });

    const noReason = await post(`/providers/${provider.providerId}/suspend`).expect(400);
    expect(noReason.body.code).toBe('VALIDATION_FAILED');
    const suspended = await post(`/providers/${provider.providerId}/suspend`, {
      reason: 'Şikayet incelemesi sürüyor.',
    }).expect(200);
    expect(suspended.body).toMatchObject({ status: 'SUSPENDED', isAvailableNow: false });

    const blocked = await ctx
      .http()
      .patch('/api/v1/providers/me/availability')
      .set('Authorization', auth)
      .send({ isAvailableNow: true })
      .expect(409);
    expect(blocked.body.code).toBe('PROVIDER_NOT_ACTIVE');
    await ctx.http().get(`/api/v1/providers/${provider.providerId}`).expect(404);

    const back = await post(`/providers/${provider.providerId}/reinstate`).expect(200);
    expect(back.body).toMatchObject({
      status: 'ACTIVE',
      statusReason: null,
      isAvailableNow: false,
    });
  });

  it('opens NOW only where the province and category allow it', async () => {
    const provider = await pendingProvider(ctx, c);
    await post(`/provider-verifications/${provider.verificationId}/approve`).expect(200);
    await post(`/providers/${provider.providerId}/approve`).expect(200);
    const auth = bearer(provider);
    const setAvailability = (body: Record<string, boolean>) =>
      ctx.http().patch('/api/v1/providers/me/availability').set('Authorization', auth).send(body);

    await ctx.prisma.province.update({ where: { id: c.provinceId }, data: { isActive: false } });
    const closedProvince = await setAvailability({ nowEnabled: true, isAvailableNow: true }).expect(
      422,
    );
    expect(closedProvince.body.code).toBe('NOW_NOT_AVAILABLE');

    await ctx.prisma.province.update({ where: { id: c.provinceId }, data: { isActive: true } });
    await ctx
      .http()
      .put(`/api/v1/locations/provinces/${c.provinceId}/categories/${c.nowCategoryId}`)
      .set('Authorization', admin)
      .send({ isActive: true, nowEnabled: false })
      .expect(200);
    const closedPair = await setAvailability({ nowEnabled: true, isAvailableNow: true }).expect(
      422,
    );
    expect(closedPair.body.code).toBe('NOW_NOT_AVAILABLE');

    await ctx
      .http()
      .put(`/api/v1/locations/provinces/${c.provinceId}/categories/${c.nowCategoryId}`)
      .set('Authorization', admin)
      .send({ isActive: true, nowEnabled: true })
      .expect(200);
    const open = await setAvailability({ nowEnabled: true, isAvailableNow: true }).expect(200);
    expect(open.body.isAvailableNow).toBe(true);

    // Turning the preference off always ends availability.
    const off = await setAvailability({ nowEnabled: false }).expect(200);
    expect(off.body).toMatchObject({ nowEnabled: false, isAvailableNow: false });
  });

  it('shows only safe fields on the public profile of an active provider', async () => {
    const provider = await pendingProvider(ctx, c);
    await ctx.http().get(`/api/v1/providers/${provider.providerId}`).expect(404);
    await post(`/provider-verifications/${provider.verificationId}/approve`).expect(200);
    await post(`/providers/${provider.providerId}/approve`).expect(200);

    const res = await ctx.http().get(`/api/v1/providers/${provider.providerId}`).expect(200);
    const profile = publicProviderProfileSchema.parse(res.body);
    expect(profile.verificationBadges).toEqual(['IDENTITY']);
    const text = JSON.stringify(res.body);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: provider.userId } });
    expect(text).not.toContain(user.phone ?? '<none>');
    expect(text).not.toContain(provider.userId);
    expect(text).not.toMatch(/documentKey|statusReason|reviewedBy|email|phone|verifications\//);
  });

  it('keeps the database from ever making a non-active provider available', async () => {
    const provider = await draftProvider(ctx);
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE provider_profiles SET now_enabled = true, is_available_now = true WHERE id = ${provider.providerId}::uuid`,
    ).rejects.toThrow(/provider_profiles_available_now_check/);
  });

  /** Onboards and submits an application for an existing draft provider. */
  async function pendingProviderFor(actor: Awaited<ReturnType<typeof draftProvider>>) {
    const auth = bearer(actor);
    await ctx
      .http()
      .patch('/api/v1/providers/me')
      .set('Authorization', auth)
      .send({ bio: 'Kendi başvurusunu onaylamaya çalışan yönetici.', yearsOfExperience: 3 })
      .expect(200);
    await ctx
      .http()
      .put('/api/v1/providers/me/services')
      .set('Authorization', auth)
      .send({ categoryIds: [c.plainCategoryId] })
      .expect(200);
    await ctx
      .http()
      .put('/api/v1/providers/me/service-areas')
      .set('Authorization', auth)
      .send({ areas: [{ provinceId: c.provinceId, districtIds: c.districtIds }] })
      .expect(200);
    const verificationId = await uploadVerification(ctx, actor);
    await ctx.http().post('/api/v1/providers/me/submit').set('Authorization', auth).expect(200);
    return { verificationId };
  }
});
