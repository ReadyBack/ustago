import { payoutSchema, walletSchema } from '@ustago/validation';

import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  answerChangeOrder,
  createChangeOrder,
  startWork,
  stepOk,
  agreedJob,
  type AgreedJob,
} from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';
import {
  adminActor,
  chooseMethod,
  createPayment,
  expectLedgerConsistent,
  idemKey,
  payOnline,
  requestPayout,
  setDestination,
  simulate,
  summaryOf,
  walletOf,
} from './finance-helpers.js';
import type { Actor } from './provider-helpers.js';

/**
 * Demo scenario A (Faz 4 flow + money): budget 1500 → 2500 → 2000 → 2200
 * accepted → paid online (TEST) → +500 change order → "Kalan ₺500 ÖDE" →
 * completed. Fee 15 % (dev policy): 330 + 75 = 405, provider net 2295.
 * Then D/E: payout of 1000, and two concurrent 2000 requests from what is
 * left where only one can succeed.
 */
describe('Finance: online payment, change order difference, wallet and payouts', () => {
  let ctx: TestContext;
  let m: Market;
  let job: AgreedJob;
  let admin: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = await adminActor(ctx);
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('shows the job total and nothing paid before paying', async () => {
    job = await agreedJob(ctx, m);
    const s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.viewerRole).toBe('CUSTOMER');
    expect(s.total.amountMinor).toBe(220000);
    expect(s.paid.amountMinor).toBe(0);
    expect(s.outstanding.amountMinor).toBe(220000);
    expect(s.testMode).toBe(true);
    expect(s.actions.canPayOnline).toBe(true);
    expect(s.providerBreakdown).toBeNull();
    const p = await summaryOf(ctx, job.provider, job.jobId);
    expect(p.viewerRole).toBe('PROVIDER');
    expect(p.providerBreakdown).toMatchObject({
      gross: { amountMinor: 220000 },
      platformFee: { amountMinor: 33000 },
      net: { amountMinor: 187000 },
      feeBps: 1500,
      developmentPolicy: true,
    });
  });

  it('only the customer can pay; a stranger does not even see the job', async () => {
    await createPayment(ctx, job.provider, job.jobId).expect(403);
    const stranger = await adminActor(ctx);
    await createPayment(ctx, stranger, job.jobId).expect(404);
    await ctx
      .http()
      .post(`/api/v1/jobs/${job.jobId}/payments`)
      .set('Authorization', bearer(job.customer))
      .send()
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED'));
  });

  it('a declined card leaves the job unpaid and a retry succeeds on the same payment', async () => {
    const key = idemKey();
    const first = await createPayment(ctx, job.customer, job.jobId, key).expect(200);
    expect(first.body.amount.amountMinor).toBe(220000);
    // Same key → same payment (double tap), a different key → still one payment in flight.
    const replay = await createPayment(ctx, job.customer, job.jobId, key).expect(200);
    expect(replay.body.id).toBe(first.body.id);
    const other = await createPayment(ctx, job.customer, job.jobId).expect(200);
    expect(other.body.id).toBe(first.body.id);

    const declined = await simulate(ctx, job.customer, first.body.id, 'CARD_DECLINED').expect(200);
    expect(declined.body.lastFailureCode).toBe('CARD_DECLINED');
    expect(declined.body.status).toBe('PENDING');
    let s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.paid.amountMinor).toBe(0);

    const retry = await createPayment(ctx, job.customer, job.jobId).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.attempts).toHaveLength(2);
    const ok = await simulate(ctx, job.customer, retry.body.id, 'SUCCESS').expect(200);
    expect(ok.body.status).toBe('SUCCEEDED');
    s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.paid.amountMinor).toBe(220000);
    expect(s.outstanding.amountMinor).toBe(0);
    expect(s.method).toBe('IN_APP');
    await createPayment(ctx, job.customer, job.jobId)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('PAYMENT_NOTHING_DUE'));
    // A method change after paying is refused.
    await chooseMethod(ctx, job.customer, job.jobId, 'CASH')
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('PAYMENT_METHOD_LOCKED'));
  });

  it('writes the capture to the ledger: clearing 2200, fee 330, provider pending 1870', async () => {
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { jobId: job.jobId, status: 'SUCCEEDED' },
    });
    expect(payment.platformFeeMinor).toBe(33000n);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(earning).toMatchObject({ grossMinor: 220000n, feeMinor: 33000n, netMinor: 187000n });
    expect(earning.status).toBe('PENDING');
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.pending.amountMinor).toBe(187000);
    expect(w.balances.available.amountMinor).toBe(0);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('after a +500 change order only the difference is due ("Kalan ₺500 ÖDE")', async () => {
    await startWork(ctx, job);
    const co = await createChangeOrder(ctx, job.provider, job.jobId, 50000);
    await answerChangeOrder(ctx, job.customer, co.id, 'accept').expect(200);
    const s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.total.amountMinor).toBe(270000);
    expect(s.paid.amountMinor).toBe(220000);
    expect(s.outstanding.amountMinor).toBe(50000);
    const diff = await payOnline(ctx, job.customer, job.jobId);
    expect(diff.amount.amountMinor).toBe(50000);
    expect(diff.status).toBe('SUCCEEDED');
    const after = await summaryOf(ctx, job.customer, job.jobId);
    expect(after.paid.amountMinor).toBe(270000);
    expect(after.outstanding.amountMinor).toBe(0);
    // Cumulative fee: 15 % of 2700 = 405 = 330 + 75.
    const second = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: diff.id } });
    expect(second.platformFeeMinor).toBe(7500n);
  });

  it('completion releases the earning (dev hold 0): available 2295', async () => {
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    await stepOk(ctx, job.customer, job.jobId, 'complete');
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.pending.amountMinor).toBe(0);
    expect(w.balances.available.amountMinor).toBe(229500);
    expect(w.balances.withdrawable.amountMinor).toBe(229500);
    expect(w.testMode).toBe(true);
    const earnings = await ctx.prisma.providerEarning.findMany({ where: { jobId: job.jobId } });
    expect(earnings.every((e) => e.status === 'AVAILABLE')).toBe(true);
    const month = w.statements.find((x) => x.period === 'THIS_MONTH');
    expect(month?.grossJobValue.amountMinor).toBe(270000);
    expect(month?.platformFees.amountMinor).toBe(40500);
    expect(month?.netEarnings.amountMinor).toBe(229500);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('customer sees both payments in Ödemelerim and an Ödeme Özeti', async () => {
    const res = await ctx
      .http()
      .get('/api/v1/me/payments')
      .set('Authorization', bearer(job.customer))
      .expect(200);
    const mine = res.body.items.filter((i: { jobId: string }) => i.jobId === job.jobId);
    expect(mine.map((i: { amount: { amountMinor: number } }) => i.amount.amountMinor).sort()).toEqual([
      220000, 50000,
    ]);
    const detail = await ctx
      .http()
      .get(`/api/v1/me/payments/${mine[0].id}`)
      .set('Authorization', bearer(job.customer))
      .expect(200);
    expect(detail.body.jobTotal.amountMinor).toBe(270000);
    expect(detail.body.testMode).toBe(true);
    // The provider cannot open the customer's receipt.
    await ctx
      .http()
      .get(`/api/v1/me/payments/${mine[0].id}`)
      .set('Authorization', bearer(job.provider))
      .expect(404);
  });

  it('D: payout of 1000 needs a destination, stores only a masked IBAN, and gets paid (TEST)', async () => {
    await requestPayout(ctx, job.provider, 100000)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('PAYOUT_DESTINATION_REQUIRED'));
    const dest = await setDestination(ctx, job.provider).expect(200);
    expect(dest.body.maskedIban).toMatch(/^TR\*\* \*\*\*\* .*13 26$/);
    expect(JSON.stringify(dest.body)).not.toContain('0006100519786457841326');
    const row = await ctx.prisma.payoutDestination.findFirstOrThrow({
      where: { providerId: job.provider.providerId, deactivatedAt: null },
    });
    expect(JSON.stringify(row)).not.toContain('0006100519786457841326');
    expect(row.last4).toBe('1326');

    await requestPayout(ctx, job.provider, 5000)
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('PAYOUT_BELOW_MINIMUM'));

    const key = idemKey();
    const payout = payoutSchema.parse(
      (await requestPayout(ctx, job.provider, 100000, key).expect(201)).body,
    );
    const again = await requestPayout(ctx, job.provider, 100000, key).expect(201);
    expect(again.body.id).toBe(payout.id);
    let w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(129500);
    expect(w.balances.reserved.amountMinor).toBe(100000);

    await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${payout.id}/approve`)
      .set('Authorization', bearer(job.provider))
      .send()
      .expect(403);
    const approved = await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${payout.id}/approve`)
      .set('Authorization', bearer(admin))
      .send()
      .expect(200);
    expect(approved.body.status).toBe('PROCESSING');
    const paid = await ctx
      .http()
      .post(`/api/v1/admin/dev/payouts/${payout.id}/mark-paid`)
      .set('Authorization', bearer(admin))
      .send()
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    w = walletSchema.parse(
      (await ctx.http().get('/api/v1/me/wallet').set('Authorization', bearer(job.provider))).body,
    );
    expect(w.balances.reserved.amountMinor).toBe(0);
    expect(w.balances.available.amountMinor).toBe(129500);
    expect(w.balances.paidOut.amountMinor).toBe(100000);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('E: two concurrent 1000 requests from 1295: exactly one succeeds', async () => {
    const results = await Promise.all([
      requestPayout(ctx, job.provider, 100000),
      requestPayout(ctx, job.provider, 100000),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 422]);
    const refused = results.find((r) => r.status === 422);
    expect(refused?.body.code).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(29500);
    expect(w.balances.reserved.amountMinor).toBe(100000);

    // A failed payout gives the money back.
    const pending = results.find((r) => r.status === 201)!.body.id as string;
    await ctx
      .http()
      .post(`/api/v1/admin/finance/payouts/${pending}/approve`)
      .set('Authorization', bearer(admin))
      .send()
      .expect(200);
    const failed = await ctx
      .http()
      .post(`/api/v1/admin/dev/payouts/${pending}/mark-failed`)
      .set('Authorization', bearer(admin))
      .send()
      .expect(200);
    expect(failed.body.status).toBe('FAILED');
    const back = await walletOf(ctx, job.provider);
    expect(back.balances.available.amountMinor).toBe(129500);
    expect(back.balances.reserved.amountMinor).toBe(0);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('the provider can cancel a request that is not approved yet', async () => {
    await resetRateLimits(ctx);
    const created = await requestPayout(ctx, job.provider, 20000).expect(201);
    const cancelled = await ctx
      .http()
      .post(`/api/v1/me/payouts/${created.body.id}/cancel`)
      .set('Authorization', bearer(job.provider))
      .send()
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await ctx
      .http()
      .post(`/api/v1/me/payouts/${created.body.id}/cancel`)
      .set('Authorization', bearer(job.customer))
      .send()
      .expect(403);
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(129500);
  });

  it('a customer has no wallet', async () => {
    await ctx
      .http()
      .get('/api/v1/me/wallet')
      .set('Authorization', bearer(job.customer))
      .expect(403)
      .expect((res) => expect(res.body.code).toBe('PROVIDER_ONLY'));
  });
});
