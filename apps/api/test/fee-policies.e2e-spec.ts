import type { AdminFeePolicy } from '@ustago/types';

import { FeePolicyService } from '../src/finance/fee-policy.service.js';
import { payOnline } from './finance-helpers.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  RUN_ID,
  type TestContext,
} from './helpers.js';
import { agreedJob, startWork } from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';

/**
 * "Komisyon Politikaları" (Faz 6, docs/adr/0025): DRAFT → SCHEDULED →
 * ACTIVE lifecycle, published policies frozen in the database, one winner
 * for concurrent publishes, and the job snapshot rule (a %15 job stays %15
 * when a %17 policy starts).
 */
describe('Fee policy administration (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let finance: string;
  let support: string;
  // Far in the future, so no other suite ever prices a job with these.
  const base = Date.UTC(2099, 0, 1) + Math.floor(Math.random() * 1e6) * 60_000;
  let seq = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    finance = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_FINANCE']));
    support = bearer(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_SUPPORT']));
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const api = (method: 'get' | 'post' | 'delete', path: string, auth = finance) =>
    ctx.http()[method](`/api/v1/admin/fee-policies${path}`).set('Authorization', auth);
  const draft = async (bps: number, start = new Date(base + seq * 3600_000)) => {
    seq += 1;
    const res = await api('post', '')
      .send({
        code: `e2e-${RUN_ID}-${seq}`,
        name: `E2E %${bps / 100}`,
        bps,
        effectiveFrom: start.toISOString(),
      })
      .expect(201);
    return res.body as AdminFeePolicy;
  };
  const publish = (id: string) => api('post', `/${id}/publish`).send({ confirm: true });

  it('previews the fee and provider net at ₺500 … ₺10.000', async () => {
    const res = await api('get', '/preview?bps=1500').expect(200);
    expect(res.body).toEqual([
      {
        gross: { amountMinor: 50000, currency: 'TRY' },
        fee: { amountMinor: 7500, currency: 'TRY' },
        providerNet: { amountMinor: 42500, currency: 'TRY' },
      },
      {
        gross: { amountMinor: 100000, currency: 'TRY' },
        fee: { amountMinor: 15000, currency: 'TRY' },
        providerNet: { amountMinor: 85000, currency: 'TRY' },
      },
      {
        gross: { amountMinor: 250000, currency: 'TRY' },
        fee: { amountMinor: 37500, currency: 'TRY' },
        providerNet: { amountMinor: 212500, currency: 'TRY' },
      },
      {
        gross: { amountMinor: 500000, currency: 'TRY' },
        fee: { amountMinor: 75000, currency: 'TRY' },
        providerNet: { amountMinor: 425000, currency: 'TRY' },
      },
      {
        gross: { amountMinor: 1000000, currency: 'TRY' },
        fee: { amountMinor: 150000, currency: 'TRY' },
        providerNet: { amountMinor: 850000, currency: 'TRY' },
      },
    ]);
  });

  it('DRAFT → SCHEDULED; published numbers are frozen by the database', async () => {
    const p = await draft(1700);
    expect(p.lifecycle).toBe('DRAFT');
    const published = (await publish(p.id).expect(200)).body as AdminFeePolicy;
    expect(published.lifecycle).toBe('SCHEDULED');
    expect(published.publishedBy).not.toBeNull();
    await expect(
      ctx.prisma.$executeRaw`UPDATE platform_fee_policies SET bps = 1800 WHERE id = ${p.id}::uuid`,
    ).rejects.toThrow(/immutable/);
    await api('delete', `/${p.id}`).expect(409);
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: p.id } });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'fee_policy.created',
      'fee_policy.published',
    ]);
  });

  it('a job keeps its %15 snapshot when a %17 policy starts later', async () => {
    const start = new Date(base + 500 * 3600_000);
    const p17 = await draft(1700, start);
    await publish(p17.id).expect(200);

    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    const payment = await payOnline(ctx, job.customer, job.jobId, 'SUCCESS');
    const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.platformFeeMinor).toBe(33000n); // %15 of 2200 TL
    const jobRow = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(jobRow.platformFeeBps).toBe(1500);

    // From its start, new deals get the %17 policy; this job never does.
    const service = ctx.app.get(FeePolicyService);
    const later = await service.activeAt(ctx.prisma, new Date(start.getTime() + 60_000));
    expect(later?.id).toBe(p17.id);
    const before = await service.activeAt(ctx.prisma, new Date(start.getTime() - 60_000));
    expect(before?.id).not.toBe(p17.id);
    const snapshot = await service.forJob(
      ctx.prisma,
      job.jobId,
      new Date(start.getTime() + 60_000),
    );
    expect(snapshot.bps).toBe(1500);
  });

  it('concurrent publishes: one winner; two policies can never start at the same instant', async () => {
    const p = await draft(1600);
    const results = await Promise.all([publish(p.id), publish(p.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const start = new Date(base + 900 * 3600_000);
    const a = await draft(1650, start);
    const b = await draft(1660, start);
    const [ra, rb] = await Promise.all([publish(a.id), publish(b.id)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.code).toBe('FEE_POLICY_START_CONFLICT');
  });

  it('only a SCHEDULED policy can be retired; the active one is replaced, not switched off', async () => {
    const p = await draft(1750);
    await publish(p.id).expect(200);
    const retired = await api('post', `/${p.id}/retire`).send({ confirm: true }).expect(200);
    expect(retired.body.lifecycle).toBe('RETIRED');
    const list = (await api('get', '').expect(200)).body as AdminFeePolicy[];
    const active = list.filter((x) => x.lifecycle === 'ACTIVE');
    expect(active).toHaveLength(1);
    const refused = await api('post', `/${active[0]?.id}/retire`)
      .send({ confirm: true })
      .expect(409);
    expect(refused.body.code).toBe('FEE_POLICY_NOT_RETIRABLE');
  });

  it('refuses a start in the past and needs ADMIN_FINANCE', async () => {
    const past = await draft(1500, new Date(Date.now() - 3600_000));
    const res = await publish(past.id).expect(422);
    expect(res.body.code).toBe('FEE_POLICY_START_IN_PAST');
    await api('delete', `/${past.id}`).expect(204);
    await api('post', '', support)
      .send({
        code: `e2e-${RUN_ID}-x`,
        name: 'x x x',
        bps: 1500,
        effectiveFrom: new Date(base).toISOString(),
      })
      .expect(403);
    await api('get', '', support).expect(200);
  });
});
