import { cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  answerChangeOrder,
  createChangeOrder,
  startWork,
  stepOk,
  agreedJob,
  type AgreedJob,
} from './job-helpers.js';
import { adanaMarket } from './marketplace-helpers.js';
import {
  adminActor,
  adminPayment,
  adminRefund,
  expectLedgerConsistent,
  payOnline,
  requestPayout,
  setDestination,
  summaryOf,
  walletOf,
} from './finance-helpers.js';
import type { Actor } from './provider-helpers.js';

/**
 * The Faz 5 acceptance scenario, end to end on real PostgreSQL with the
 * mock provider: 1500 → 2500 → 2000 → 2200 accepted, on the way, arrived,
 * started, +500 change order accepted (agreed 2200, total 2700), ONE online
 * payment of 2700, fee 405 (15 % dev policy), provider net 2295, completed,
 * admin sees it all, two concurrent 2000 payouts from 2295 (only one
 * passes), then a 500 partial refund. The ledger balances after each step.
 */
describe('Finance: Faz 5 acceptance scenario', () => {
  let ctx: TestContext;
  let job: AgreedJob;
  let admin: Actor;
  let paymentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    job = await agreedJob(ctx, await adanaMarket(ctx));
    admin = await adminActor(ctx);
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('agreed 2200, +500 change order: agreed stays 2200, total 2700', async () => {
    await startWork(ctx, job);
    const co = await createChangeOrder(ctx, job.provider, job.jobId, 50000);
    await answerChangeOrder(ctx, job.customer, co.id, 'accept').expect(200);
    const row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(row.agreedPriceMinor).toBe(220000n);
    expect(row.currentTotalMinor).toBe(270000n);
    const s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.outstanding.amountMinor).toBe(270000);
  });

  it('one online TEST payment of 2700 succeeds: fee 405, provider net 2295', async () => {
    const payment = await payOnline(ctx, job.customer, job.jobId, 'SUCCESS');
    paymentId = payment.id;
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.amount.amountMinor).toBe(270000);
    const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(row.platformFeeMinor).toBe(40500n);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({ where: { paymentId } });
    expect(earning).toMatchObject({ grossMinor: 270000n, feeMinor: 40500n, netMinor: 229500n });
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('completing the job makes 2295 available (dev hold 0)', async () => {
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    await stepOk(ctx, job.customer, job.jobId, 'complete');
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.pending.amountMinor).toBe(0);
    expect(w.balances.available.amountMinor).toBe(229500);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('admin sees payment, fee, earning and balanced ledger', async () => {
    const d = await adminPayment(ctx, admin, paymentId);
    expect(d.amount.amountMinor).toBe(270000);
    expect(d.platformFee.amountMinor).toBe(40500);
    expect(d.feeBps).toBe(1500);
    expect(d.job.agreedPrice.amountMinor).toBe(220000);
    expect(d.job.currentTotal.amountMinor).toBe(270000);
    expect(d.earning?.net.amountMinor).toBe(229500);
    expect(d.ledger.length).toBeGreaterThanOrEqual(2);
    expect(d.ledger.every((t) => t.imbalance.amountMinor === 0)).toBe(true);
  });

  it('two concurrent 2000 payouts from 2295: the same money is withdrawn once', async () => {
    await setDestination(ctx, job.provider).expect(200);
    const results = await Promise.all([
      requestPayout(ctx, job.provider, 200000),
      requestPayout(ctx, job.provider, 200000),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422)?.body.code).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(29500);
    expect(w.balances.reserved.amountMinor).toBe(200000);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('a 500 partial refund keeps the ledger balanced', async () => {
    const res = await adminRefund(ctx, admin, paymentId, {
      amountMinor: 50000,
      expectedRefundableMinor: 270000,
    }).expect(200);
    expect(res.body.status).toBe('PARTIALLY_REFUNDED');
    expect(res.body.refundable.amountMinor).toBe(220000);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { paymentId } });
    // Split in the payment's fee/net ratio: 75 fee + 425 provider.
    expect(refund.feePortionMinor).toBe(7500n);
    expect(refund.providerPortionMinor).toBe(42500n);
    const w = await walletOf(ctx, job.provider);
    // 295 available covers part of the 425; the rest becomes platform debt.
    expect(w.balances.available.amountMinor).toBe(0);
    expect(w.balances.platformDebt.amountMinor).toBe(13000);
    expect(w.balances.reserved.amountMinor).toBe(200000);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });
});
