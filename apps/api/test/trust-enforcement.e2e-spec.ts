import { payoutSchema } from '@ustago/validation';

import { SuspensionsService } from '../src/providers/suspensions.service.js';
import {
  adminActor,
  idemKey,
  payOnline,
  requestPayout,
  setDestination,
  verifyDestination,
  walletOf,
} from './finance-helpers.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import { type AgreedJob, agreedJob, startWork, stepOk } from './job-helpers.js';
import {
  adanaMarket,
  createRequest,
  customerIn,
  type Market,
  postQuote,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import type { Actor } from './provider-helpers.js';

const REASON = 'Müşteri şikâyetleri inceleniyor; inceleme süresince yeni iş alamazsınız.';

/**
 * Faz 6 enforcement (docs/adr/0023): verification gates payouts,
 * suspensions block new quotes / NOW / payouts at once, unknown payout
 * outcomes stay reserved until a finance admin decides, and admin kill
 * switches close features without a deploy.
 */
describe('Trust enforcement: verification, suspensions, payouts (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let finance: Actor;
  let verifier: string;
  let support: string;
  let superAdmin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    finance = await adminActor(ctx);
    verifier = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_VERIFICATION']));
    support = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_SUPPORT']));
    superAdmin = bearer(await createStaffUser(ctx, ['SUPER_ADMIN'], []));
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  /** A completed, paid job: the provider has 1870 TL available. */
  async function funded(provider?: ProviderActor): Promise<AgreedJob> {
    const job = await agreedJob(ctx, m, provider ? { provider } : {});
    await startWork(ctx, job);
    await payOnline(ctx, job.customer, job.jobId, 'SUCCESS');
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    await stepOk(ctx, job.customer, job.jobId, 'complete');
    await setDestination(ctx, job.provider).expect(200);
    await verifyDestination(ctx, finance, job.provider.providerId);
    return job;
  }

  const suspend = (providerId: string, body: Record<string, unknown> = {}, auth = verifier) =>
    ctx
      .http()
      .post(`/api/v1/admin/providers/${providerId}/suspensions`)
      .set('Authorization', auth)
      .send({ reasonCode: 'QUALITY_ISSUES', userVisibleReason: REASON, ...body });
  const lift = (providerId: string) =>
    ctx
      .http()
      .post(`/api/v1/admin/providers/${providerId}/suspensions/lift`)
      .set('Authorization', verifier)
      .send({ note: 'e2e: inceleme tamamlandı.' });

  it('refuses payouts until the account is verified', async () => {
    const provider = await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan, m.cukurova],
      verification: null,
    });
    const job = await funded(provider);
    expect((await walletOf(ctx, job.provider)).balances.available.amountMinor).toBe(187000);
    const res = await requestPayout(ctx, job.provider, 100000).expect(403);
    expect(res.body).toMatchObject({
      code: 'PROVIDER_NOT_VERIFIED',
      message: 'Hesap doğrulamanız tamamlanmadan para çekemezsiniz.',
    });
    // NOW availability needs verification too.
    const now = await ctx
      .http()
      .patch('/api/v1/providers/me/availability')
      .set('Authorization', bearer(job.provider))
      .send({ nowEnabled: true, isAvailableNow: true });
    expect(now.status).toBe(409);
    expect(now.body.code).toBe('NOW_REQUIRES_VERIFICATION');
  });

  it('a suspension blocks new quotes, NOW and payouts, keeps existing jobs, and lifts cleanly', async () => {
    const job = await funded();
    const provider = job.provider;
    const res = await suspend(provider.providerId).expect(201);
    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      level: 'SUSPENDED',
      reasonCode: 'QUALITY_ISSUES',
    });

    // Payout, NOW and a new quote are refused.
    const payout = await requestPayout(ctx, provider, 100000).expect(403);
    expect(payout.body.code).toBe('PROVIDER_SUSPENDED');
    const now = await ctx
      .http()
      .patch('/api/v1/providers/me/availability')
      .set('Authorization', bearer(provider))
      .send({ nowEnabled: true, isAvailableNow: true });
    expect(now.status).toBe(409);
    expect(now.body.code).toBe('PROVIDER_SUSPENDED');
    const customer = await customerIn(ctx, m.seyhan);
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await postQuote(ctx, provider, request.id, { totalMinor: 150000 }).expect(403);
    expect(quote.body.code).toBe('PROVIDER_SUSPENDED');

    // Hidden from customers; history stays.
    await ctx.http().get(`/api/v1/providers/${provider.providerId}`).expect(404);
    await ctx
      .http()
      .get(`/api/v1/jobs/${job.jobId}`)
      .set('Authorization', bearer(provider))
      .expect(200);
    const view = await ctx
      .http()
      .get('/api/v1/providers/me/verification')
      .set('Authorization', bearer(provider))
      .expect(200);
    expect(view.body.accountStatus).toBe('SUSPENDED');
    expect(view.body.activeSuspension.userVisibleReason).toBe(REASON);
    expect(JSON.stringify(view.body)).not.toContain('internalNote');

    // A second suspension while one is in force is refused.
    const again = await suspend(provider.providerId).expect(409);
    expect(again.body.code).toBe('PROVIDER_ALREADY_SUSPENDED');

    await lift(provider.providerId).expect(200);
    await requestPayout(ctx, provider, 100000).expect(201);
    await ctx.http().get(`/api/v1/providers/${provider.providerId}`).expect(200);
    const audit = await ctx.prisma.auditLog.findMany({
      where: {
        entityId: provider.providerId,
        action: { in: ['provider.suspended', 'provider.unsuspended'] },
      },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'provider.suspended',
      'provider.unsuspended',
    ]);
    const notes = await ctx.prisma.notification.findMany({
      where: { userId: provider.userId, type: { startsWith: 'provider.account.' } },
    });
    expect(notes.map((n) => n.type).sort()).toEqual([
      'provider.account.reinstated',
      'provider.account.suspended',
    ]);
  });

  it('suspension × quote race: no quote is accepted after the suspension commits', async () => {
    for (let round = 0; round < 5; round += 1) {
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
      });
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const [quote, suspension] = await Promise.all([
        postQuote(ctx, provider, request.id, { totalMinor: 150000 }),
        suspend(provider.providerId),
      ]);
      expect(suspension.status).toBe(201);
      expect([201, 403]).toContain(quote.status);
      if (quote.status === 403) expect(quote.body.code).toBe('PROVIDER_SUSPENDED');
      // After the suspension, every further attempt is refused.
      const after = await postQuote(ctx, provider, request.id, { totalMinor: 140000 });
      expect(after.status).toBe(403);
      const quotes = await ctx.prisma.quote.count({ where: { providerId: provider.providerId } });
      expect(quotes).toBe(quote.status === 201 ? 1 : 0);
    }
  });

  it('two admins suspending at once: exactly one suspension', async () => {
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const results = await Promise.all([suspend(provider.providerId), suspend(provider.providerId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await ctx.prisma.providerSuspension.count({ where: { providerId: provider.providerId } }),
    ).toBe(1);
  });

  it('temporary suspensions: auto-lift ends by itself, otherwise waits for an admin', async () => {
    const auto = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const manual = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    await suspend(auto.providerId, { expiresAt, autoLift: true }).expect(201);
    await suspend(manual.providerId, { expiresAt, autoLift: false }).expect(201);
    const result = await ctx.app
      .get(SuspensionsService)
      .expireDue(new Date(Date.now() + 2 * 3600_000));
    expect(result.lifted).toBeGreaterThanOrEqual(1);
    const [a, b] = await Promise.all([
      ctx.prisma.providerProfile.findUniqueOrThrow({ where: { id: auto.providerId } }),
      ctx.prisma.providerProfile.findUniqueOrThrow({ where: { id: manual.providerId } }),
    ]);
    expect(a.accountStatus).toBe('ACTIVE');
    expect(b.accountStatus).toBe('SUSPENDED');
    const pending = await ctx.prisma.providerSuspension.findFirstOrThrow({
      where: { providerId: manual.providerId },
    });
    expect(pending.status).toBe('EXPIRED_PENDING_REVIEW');
  });

  it('only ADMIN_VERIFICATION suspends; only ADMIN_FINANCE approves payouts', async () => {
    const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
    const denied = await suspend(provider.providerId, {}, support).expect(403);
    expect(denied.body.code).toBe('ADMIN_PERMISSION_REQUIRED');
    const job = await funded();
    const payout = payoutSchema.parse(
      (await requestPayout(ctx, job.provider, 100000).expect(201)).body,
    );
    await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${payout.id}/approve`)
      .set('Authorization', support)
      .send()
      .expect(403);
    await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${payout.id}/approve`)
      .set('Authorization', verifier)
      .send()
      .expect(403);
  });

  it('an unknown payout outcome stays reserved until a finance admin records it', async () => {
    const job = await funded();
    // 1000,13 TL: the mock payout provider "loses" the answer (timeout).
    const payout = payoutSchema.parse(
      (await requestPayout(ctx, job.provider, 100013, idemKey()).expect(201)).body,
    );
    const approved = await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${payout.id}/approve`)
      .set('Authorization', bearer(finance))
      .send()
      .expect(200);
    expect(approved.body.status).toBe('NEEDS_RECONCILIATION');
    let w = await walletOf(ctx, job.provider);
    expect(w.balances.reserved.amountMinor).toBe(100013);
    const alert = await ctx.prisma.operationalAlert.findFirstOrThrow({
      where: { dedupeKey: `finance.payout_outcome_unknown:${payout.id}` },
    });
    expect(alert).toMatchObject({ severity: 'CRITICAL', status: 'OPEN' });

    // Nothing is retried or released automatically; a finance admin decides.
    const resolved = await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${payout.id}/resolve`)
      .set('Authorization', bearer(finance))
      .send({ outcome: 'FAILED', note: 'Sağlayıcı kaydında transfer yok.' })
      .expect(200);
    expect(resolved.body.status).toBe('FAILED');
    w = await walletOf(ctx, job.provider);
    expect(w.balances.reserved.amountMinor).toBe(0);
    expect(w.balances.available.amountMinor).toBe(187000);
    const closed = await ctx.prisma.operationalAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(closed.status).toBe('RESOLVED');

    // 1000,14 TL: a definite bank rejection fails at once and releases.
    const rejected = payoutSchema.parse(
      (await requestPayout(ctx, job.provider, 100014, idemKey()).expect(201)).body,
    );
    const failed = await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${rejected.id}/approve`)
      .set('Authorization', bearer(finance))
      .send()
      .expect(200);
    expect(failed.body).toMatchObject({ status: 'FAILED', failureCode: 'MOCK_BANK_REJECTED' });
  });

  it('kill switch: an ADMIN_SUPER turns payouts off and on without a deploy', async () => {
    const job = await funded();
    await resetRateLimits(ctx);
    const flag = (enabled: boolean, auth = superAdmin) =>
      ctx
        .http()
        .put('/api/v1/admin/runtime-flags/payouts')
        .set('Authorization', auth)
        .send({ enabled, reason: 'e2e: bakım penceresi', confirm: true });
    await flag(false, bearer(finance)).expect(403);
    await flag(false).expect(200);
    try {
      const closed = await requestPayout(ctx, job.provider, 100000).expect(503);
      expect(closed.body.code).toBe('FEATURE_DISABLED');
    } finally {
      await flag(true).expect(200);
    }
    await requestPayout(ctx, job.provider, 100000).expect(201);
    const audit = await ctx.prisma.auditLog.count({
      where: { action: 'runtime_flag.changed', entityId: 'payouts' },
    });
    expect(audit).toBeGreaterThanOrEqual(2);
  });
});
