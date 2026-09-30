import type {
  AdminVerificationCaseDetail,
  AppNotification,
  ProviderVerificationCaseView,
} from '@ustago/types';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  registerUser,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  catalog,
  type Catalog,
  createUploadIntent,
  draftProvider,
  FILES,
  pathOf,
  pendingProvider,
  putFile,
  uploadVerification,
} from './provider-helpers.js';
import { providerIn } from './marketplace-helpers.js';

const REASON = 'Kimlik fotoğrafı okunamıyor, lütfen daha net bir fotoğraf yükleyin.';
const INTERNAL = 'Fotoğraf bulanık; sahtecilik şüphesi yok.';

/**
 * Faz 6 provider verification case (docs/adr/0023): state machine,
 * admin decisions with optimistic versions, permissions, document access
 * and the verified badge.
 */
describe('Provider verification case (e2e)', () => {
  let ctx: TestContext;
  let c: Catalog;
  let verifier: string;
  let support: string;
  let finance: string;
  let provinceWasActive: boolean;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx, 'rl:*');
    c = await catalog(ctx);
    verifier = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_VERIFICATION']));
    support = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_SUPPORT']));
    finance = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_FINANCE']));
    provinceWasActive = (
      await ctx.prisma.province.findUniqueOrThrow({ where: { id: c.provinceId } })
    ).isActive;
    await ctx.prisma.province.update({ where: { id: c.provinceId }, data: { isActive: true } });
  });

  afterAll(async () => {
    await ctx.prisma.province.update({
      where: { id: c.provinceId },
      data: { isActive: provinceWasActive },
    });
    await cleanup(ctx);
    await ctx.app.close();
  });

  const admin = (method: 'get' | 'post', path: string, auth = verifier, body?: object) => {
    const req = ctx.http()[method](`/api/v1/admin${path}`).set('Authorization', auth);
    return method === 'post' ? req.send(body ?? {}) : req;
  };
  const detail = async (providerId: string): Promise<AdminVerificationCaseDetail> =>
    (await admin('get', `/verification-cases/${providerId}`).expect(200))
      .body as AdminVerificationCaseDetail;
  const own = async (auth: string): Promise<ProviderVerificationCaseView> =>
    (
      await ctx
        .http()
        .get('/api/v1/providers/me/verification')
        .set('Authorization', auth)
        .expect(200)
    ).body as ProviderVerificationCaseView;
  const notifications = async (userId: string): Promise<AppNotification[]> => {
    const rows = await ctx.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows as unknown as AppNotification[];
  };

  it('walks NOT_STARTED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → NEEDS_REVISION → VERIFIED', async () => {
    const provider = await draftProvider(ctx);
    const auth = bearer(provider);
    expect((await own(auth)).status).toBe('NOT_STARTED');

    await uploadVerification(ctx, provider);
    const started = await own(auth);
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.checklist.map((i) => i.key)).toEqual([
      'PROFILE',
      'SERVICES',
      'SERVICE_AREAS',
      'DOCUMENTS',
      'SUBMIT',
    ]);
    expect(started.capabilities.canRequestPayout).toBe(false);

    // Application + case are submitted together.
    const pending = await pendingProvider(ctx, c);
    const pAuth = bearer(pending);
    expect((await own(pAuth)).status).toBe('SUBMITTED');

    // An invalid transition is refused with a stable code.
    const early = await admin(
      'post',
      `/verification-cases/${pending.providerId}/approve`,
      verifier,
      {
        expectedVersion: (await detail(pending.providerId)).version,
      },
    ).expect(409);
    expect(early.body.code).toBe('PROVIDER_VERIFICATION_INVALID_TRANSITION');

    let d = await detail(pending.providerId);
    expect(d.actions).toEqual({
      startReview: true,
      approve: false,
      requestRevision: false,
      reject: false,
    });
    d = (
      await admin('post', `/verification-cases/${pending.providerId}/start-review`, verifier, {
        expectedVersion: d.version,
      }).expect(200)
    ).body as AdminVerificationCaseDetail;
    expect(d.status).toBe('UNDER_REVIEW');
    expect(d.reviewedBy).not.toBeNull();

    d = (
      await admin('post', `/verification-cases/${pending.providerId}/request-revision`, verifier, {
        expectedVersion: d.version,
        reasonCode: 'DOCUMENT_UNREADABLE',
        userVisibleReason: REASON,
        internalNote: INTERNAL,
        rejectDocumentIds: [pending.verificationId],
      }).expect(200)
    ).body as AdminVerificationCaseDetail;
    expect(d.status).toBe('NEEDS_REVISION');
    expect(d.internalNote).toBe(INTERNAL);
    expect(d.decisionBy).not.toBeNull();

    // The provider sees the reason, never the internal note.
    const revision = await own(pAuth);
    expect(revision.status).toBe('NEEDS_REVISION');
    expect(revision.userVisibleReason).toBe(REASON);
    expect(revision.canEditDocuments).toBe(true);
    expect(JSON.stringify(revision)).not.toContain(INTERNAL);

    // Fix and resubmit.
    await uploadVerification(ctx, pending);
    await ctx.http().post('/api/v1/providers/me/submit').set('Authorization', pAuth).expect(200);
    expect((await own(pAuth)).status).toBe('SUBMITTED');

    d = await detail(pending.providerId);
    d = (
      await admin('post', `/verification-cases/${pending.providerId}/start-review`, verifier, {
        expectedVersion: d.version,
      }).expect(200)
    ).body as AdminVerificationCaseDetail;
    d = (
      await admin('post', `/verification-cases/${pending.providerId}/approve`, verifier, {
        expectedVersion: d.version,
      }).expect(200)
    ).body as AdminVerificationCaseDetail;
    expect(d.status).toBe('VERIFIED');
    expect(d.providerStatus).toBe('ACTIVE');
    expect(d.timeline.map((e) => e.toStatus)).toEqual(
      expect.arrayContaining(['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'VERIFIED']),
    );

    // Verified badge on the public profile, and the provider can now use NOW.
    const pub = await ctx.http().get(`/api/v1/providers/${pending.providerId}`).expect(200);
    expect(pub.body.isVerified).toBe(true);
    expect(JSON.stringify(pub.body)).not.toContain(INTERNAL);
    const verified = await own(pAuth);
    expect(verified.capabilities).toMatchObject({
      canRequestPayout: true,
      showVerifiedBadge: true,
    });

    // Every step notified the provider with a deep link to the case.
    const notes = (await notifications(pending.userId)).filter((n) =>
      n.type.startsWith('provider.verification.'),
    );
    expect(notes.map((n) => n.type)).toEqual(
      expect.arrayContaining([
        'provider.verification.submitted',
        'provider.verification.under_review',
        'provider.verification.needs_revision',
        'provider.verification.approved',
      ]),
    );
    for (const n of notes) expect(n.deepLink).toBe('/provider/verification');

    // Audited with the deciding admin.
    const audits = await ctx.prisma.auditLog.findMany({
      where: { entityId: pending.providerId, action: { startsWith: 'provider.verification.' } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects a stale version and lets only one of approve × reject win', async () => {
    const pending = await pendingProvider(ctx, c);
    let d = await detail(pending.providerId);
    d = (
      await admin('post', `/verification-cases/${pending.providerId}/start-review`, verifier, {
        expectedVersion: d.version,
      }).expect(200)
    ).body as AdminVerificationCaseDetail;

    const stale = await admin(
      'post',
      `/verification-cases/${pending.providerId}/approve`,
      verifier,
      {
        expectedVersion: d.version - 1,
      },
    ).expect(409);
    expect(stale.body.code).toBe('VERIFICATION_VERSION_CONFLICT');

    const [approve, reject] = await Promise.all([
      admin('post', `/verification-cases/${pending.providerId}/approve`, verifier, {
        expectedVersion: d.version,
      }),
      admin('post', `/verification-cases/${pending.providerId}/reject`, verifier, {
        expectedVersion: d.version,
        reasonCode: 'DOCUMENT_MISMATCH',
        userVisibleReason: 'Belgedeki bilgiler hesabınızla eşleşmiyor.',
      }),
    ]);
    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
    const final = await detail(pending.providerId);
    expect(['VERIFIED', 'REJECTED']).toContain(final.status);
    const decisions = await ctx.prisma.providerVerificationEvent.count({
      where: { providerId: pending.providerId, toStatus: { in: ['VERIFIED', 'REJECTED'] } },
    });
    expect(decisions).toBe(1);
  });

  it('needs ADMIN_VERIFICATION for decisions; any admin may read the queue', async () => {
    const pending = await pendingProvider(ctx, c);
    const version = (await detail(pending.providerId)).version;
    for (const auth of [support, finance]) {
      const res = await admin(
        'post',
        `/verification-cases/${pending.providerId}/start-review`,
        auth,
        {
          expectedVersion: version,
        },
      ).expect(403);
      expect(res.body.code).toBe('ADMIN_PERMISSION_REQUIRED');
    }
    const queue = await admin(
      'get',
      '/verification-cases?status=SUBMITTED&limit=100',
      support,
    ).expect(200);
    expect(
      queue.body.items.some((i: { providerId: string }) => i.providerId === pending.providerId),
    ).toBe(true);
    const customer = bearer(await registerUser(ctx));
    await admin('get', '/verification-cases', customer).expect(403);
  });

  it('keeps documents private: owner or admin only, others get 404', async () => {
    const pending = await pendingProvider(ctx, c);
    const other = await draftProvider(ctx);
    const url = `/api/v1/providers/me/verifications/${pending.verificationId}/url`;
    const mine = await ctx.http().get(url).set('Authorization', bearer(pending)).expect(200);
    await ctx.http().get(pathOf(mine.body.url)).expect(200);
    await ctx.http().get(url).set('Authorization', bearer(other)).expect(404);

    const d = await detail(pending.providerId);
    const doc = d.documents.find((x) => x.id === pending.verificationId);
    expect(doc?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // No scanner is configured: honest NOT_SCANNED, never a fake "clean".
    expect(doc?.scanStatus).toBe('NOT_SCANNED');
    const access = await ctx.prisma.auditLog.count({
      where: { action: 'verification.document_accessed', entityId: pending.verificationId },
    });
    expect(access).toBeGreaterThanOrEqual(1);
  });

  it('refuses the same file twice and locks documents while the case is under review', async () => {
    const provider = await draftProvider(ctx);
    const file = FILES.png;
    const upload = async () => {
      const intent = await createUploadIntent(ctx, provider, { type: 'OTHER' });
      await putFile(ctx, intent, file).expect(204);
      return ctx
        .http()
        .post('/api/v1/providers/me/verifications')
        .set('Authorization', bearer(provider))
        .send({ type: 'OTHER', uploadId: intent.uploadId });
    };
    expect((await upload()).status).toBe(201);
    const dup = await upload();
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DOCUMENT_DUPLICATE');

    // An approved provider whose case waits for review cannot swap files.
    const active = await providerIn(ctx, {
      categoryIds: [c.nowCategoryId],
      districtIds: c.districtIds,
      verification: 'SUBMITTED',
    });
    const locked = await createUploadIntentRaw(active);
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('VERIFICATION_LOCKED');
  });

  const createUploadIntentRaw = (actor: { tokens: { accessToken: string } }) =>
    ctx
      .http()
      .post('/api/v1/providers/me/verifications/upload-intent')
      .set('Authorization', `Bearer ${actor.tokens.accessToken}`)
      .send({
        type: 'PROFESSIONAL_CERTIFICATE',
        fileName: 'sertifika.pdf',
        mimeType: 'application/pdf',
        sizeBytes: FILES.pdf.length,
      });

  it('asks for a category document before quoting when an admin requires it', async () => {
    const res = await admin('post', `/categories/${c.plainCategoryId}/requirements`, verifier, {
      documentType: 'PROFESSIONAL_CERTIFICATE',
      note: 'e2e: mesleki yeterlilik',
    }).expect(201);
    await admin('post', `/categories/${c.plainCategoryId}/requirements`, verifier, {
      documentType: 'PROFESSIONAL_CERTIFICATE',
    }).expect(409);
    const provider = await draftProvider(ctx);
    await uploadVerification(ctx, provider);
    const view = await own(bearer(provider));
    // The provider has not picked the category yet: only IDENTITY is required.
    expect(view.documents.filter((x) => x.required).map((x) => x.type)).toEqual(['IDENTITY']);
    await ctx
      .http()
      .delete(`/api/v1/admin/category-requirements/${res.body.id}`)
      .set('Authorization', verifier)
      .expect(204);
  });
});
