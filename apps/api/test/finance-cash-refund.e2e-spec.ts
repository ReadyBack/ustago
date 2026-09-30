import { adminCashSettlementSchema } from '@ustago/validation';

import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, completedJob, startWork, step, stepOk } from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';
import {
  adminActor,
  adminPayment,
  adminRefund,
  chooseMethod,
  confirmCash,
  expectLedgerConsistent,
  idemKey,
  payOnline,
  walletOf,
} from './finance-helpers.js';
import type { Actor } from './provider-helpers.js';

describe('Finance: cash, refunds, cancellation and disputes', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Actor;
  const jobIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = await adminActor(ctx);
  });

  beforeEach(() => resetRateLimits(ctx));

  afterAll(async () => {
    await expectLedgerConsistent(ctx, jobIds);
    await cleanup(ctx);
    await ctx.app.close();
  });

  it("B: cash needs both sides; the fee becomes the provider's platform debt", async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    const chosen = await chooseMethod(ctx, job.customer, job.jobId, 'CASH').expect(200);
    expect(chosen.body.method).toBe('CASH');
    expect(chosen.body.actions.canPayOnline).toBe(false);
    // Not before the job is completed.
    await confirmCash(ctx, job.customer, job.jobId)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('CASH_NOT_ALLOWED'));
    await completedJob(ctx, m, job);

    const one = await confirmCash(ctx, job.customer, job.jobId).expect(200);
    expect(one.body.cash.status).toBe('CUSTOMER_CONFIRMED');
    // Double tap is harmless.
    await confirmCash(ctx, job.customer, job.jobId).expect(200);
    let w = await walletOf(ctx, job.provider);
    expect(w.balances.platformDebt.amountMinor).toBe(0);

    const both = await confirmCash(ctx, job.provider, job.jobId).expect(200);
    expect(both.body.cash.status).toBe('CONFIRMED');
    expect(both.body.cash.amount.amountMinor).toBe(220000);
    expect(both.body.paid.amountMinor).toBe(220000);
    expect(both.body.outstanding.amountMinor).toBe(0);
    w = await walletOf(ctx, job.provider);
    expect(w.balances.platformDebt.amountMinor).toBe(33000);
    expect(w.balances.available.amountMinor).toBe(0);
    expect(w.balances.withdrawable.amountMinor).toBe(0);
    const fees = await ctx.prisma.ledgerTransaction.count({
      where: { jobId: job.jobId, type: 'CASH_FEE_ASSESSED' },
    });
    expect(fees).toBe(1);
    // UstaGO never held the money: no payment row, no clearing entry.
    expect(await ctx.prisma.payment.count({ where: { jobId: job.jobId } })).toBe(0);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('B2: a cash dispute is decided by an admin, record only', async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    await chooseMethod(ctx, job.customer, job.jobId, 'CASH').expect(200);
    await completedJob(ctx, m, job);
    await confirmCash(ctx, job.customer, job.jobId).expect(200);
    const disputed = await ctx
      .http()
      .post(`/api/v1/jobs/${job.jobId}/cash/dispute`)
      .set('Authorization', bearer(job.provider))
      .send({ note: 'Nakit ödeme bana ulaşmadı.' })
      .expect(200);
    expect(disputed.body.cash.status).toBe('DISPUTED');
    const list = await ctx
      .http()
      .get('/api/v1/admin/finance/cash-settlements?status=DISPUTED')
      .set('Authorization', bearer(admin))
      .expect(200);
    const row = adminCashSettlementSchema.parse(
      list.body.items.find((c: { jobId: string }) => c.jobId === job.jobId),
    );
    await ctx
      .http()
      .post(`/api/v1/admin/finance/cash-settlements/${row.id}/resolve`)
      .set('Authorization', bearer(job.customer))
      .send({ outcome: 'MARK_UNPAID', note: 'deneme' })
      .expect(403);
    const resolved = await ctx
      .http()
      .post(`/api/v1/admin/finance/cash-settlements/${row.id}/resolve`)
      .set('Authorization', bearer(admin))
      .send({ outcome: 'MARK_UNPAID', note: 'Müşteri ödemediğini kabul etti.' })
      .expect(200);
    expect(resolved.body.status).toBe('RESOLVED_UNPAID');
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.platformDebt.amountMinor).toBe(0);
  });

  it('C: admin partial then full refund; never more than paid; stale screens refused', async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    const paid = await payOnline(ctx, job.customer, job.jobId);
    await completedJob(ctx, m, job);
    let detail = await adminPayment(ctx, admin, paid.id);
    expect(detail.refundable.amountMinor).toBe(220000);
    expect(detail.ledger.every((t) => t.imbalance.amountMinor === 0)).toBe(true);

    await adminRefund(ctx, admin, paid.id, { amountMinor: 50000, expectedRefundableMinor: 1 })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('REFUND_STALE'));
    await adminRefund(ctx, admin, paid.id, { amountMinor: 220001, expectedRefundableMinor: 220000 })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('REFUND_EXCEEDS_REFUNDABLE'));
    await adminRefund(ctx, job.customer, paid.id, {
      amountMinor: 1000,
      expectedRefundableMinor: 220000,
    }).expect(403);

    const key = idemKey();
    const partial = await adminRefund(
      ctx,
      admin,
      paid.id,
      { amountMinor: 50000, expectedRefundableMinor: 220000 },
      key,
    ).expect(200);
    expect(partial.body.status).toBe('PARTIALLY_REFUNDED');
    expect(partial.body.refundable.amountMinor).toBe(170000);
    // Same key again: no second refund.
    await adminRefund(
      ctx,
      admin,
      paid.id,
      { amountMinor: 50000, expectedRefundableMinor: 220000 },
      key,
    ).expect(200);
    detail = await adminPayment(ctx, admin, paid.id);
    expect(detail.refunds).toHaveLength(1);
    expect(detail.refunds[0]).toMatchObject({
      status: 'SUCCEEDED',
      amount: { amountMinor: 50000 },
      feePortion: { amountMinor: 7500 },
      providerPortion: { amountMinor: 42500 },
    });
    // Released earning: the provider part comes out of available balance.
    let w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(187000 - 42500);

    // Two admins refund the rest at the same moment: only one wins.
    const both = await Promise.all([
      adminRefund(ctx, admin, paid.id, { amountMinor: 170000, expectedRefundableMinor: 170000 }),
      adminRefund(ctx, admin, paid.id, { amountMinor: 170000, expectedRefundableMinor: 170000 }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    detail = await adminPayment(ctx, admin, paid.id);
    expect(detail.status).toBe('REFUNDED');
    expect(detail.refunded.amountMinor).toBe(220000);
    expect(detail.refundable.amountMinor).toBe(0);
    w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(0);
    const audit = detail.audit.map((a) => a.action);
    expect(audit).toEqual(
      expect.arrayContaining([
        'payment.created',
        'payment.succeeded',
        'refund.created',
        'refund.completed',
      ]),
    );
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('cancelling before the provider sets off refunds a captured payment in full', async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    const paid = await payOnline(ctx, job.customer, job.jobId);
    await stepOk(ctx, job.customer, job.jobId, 'cancel', { reason: 'Plan değişti.' });
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paid.id } });
    expect(payment.status).toBe('REFUNDED');
    const refunds = await ctx.prisma.refund.findMany({ where: { paymentId: paid.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amountMinor: 220000n,
      reason: 'JOB_CANCELLED',
      status: 'SUCCEEDED',
    });
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.pending.amountMinor).toBe(0);
    expect(w.balances.available.amountMinor).toBe(0);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({
      where: { paymentId: paid.id },
    });
    expect(earning.status).toBe('REVERSED');
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('cancelling withdraws an unfinished payment; a late success is refunded automatically', async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    const created = await ctx
      .http()
      .post(`/api/v1/jobs/${job.jobId}/payments`)
      .set('Authorization', bearer(job.customer))
      .set('Idempotency-Key', idemKey())
      .send()
      .expect(200);
    const attempt = await ctx.prisma.paymentTransaction.findFirstOrThrow({
      where: { paymentId: created.body.id },
    });
    await stepOk(ctx, job.provider, job.jobId, 'cancel', { reason: 'Parça yok.' });
    const cancelled = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(cancelled.status).toBe('CANCELLED');
    // The provider still reports the money arrived: it is sent straight back.
    const { mockProvider } = await import('./finance-helpers.js');
    const event = mockProvider(ctx).signedEvent({
      type: 'payment.succeeded',
      data: {
        providerPaymentId: attempt.gatewayTransactionId,
        amountMinor: '220000',
        currency: 'TRY',
      },
    });
    const req = ctx.http().post('/api/v1/webhooks/payments/mock');
    for (const [k, v] of Object.entries(event.headers)) req.set(k, v);
    await req.send(event.rawBody.toString('utf8')).expect(200);
    const refunds = await ctx.prisma.refund.findMany({ where: { paymentId: created.body.id } });
    const total = refunds
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((a, r) => a + r.amountMinor, 0n);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(payment.status).toBe('REFUNDED');
    expect(total).toBe(220000n);
    expect(refunds[0]?.reason).toBe('JOB_CANCELLED');
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it("F: a dispute freezes the provider's money until an admin decides", async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    const paid = await payOnline(ctx, job.customer, job.jobId);
    await startWork(ctx, job);
    await stepOk(ctx, job.customer, job.jobId, 'dispute', {
      reason: 'POOR_QUALITY',
      description: 'Klima hâlâ soğutmuyor, iş eksik kaldı.',
    });
    let w = await walletOf(ctx, job.provider);
    expect(w.balances.held.amountMinor).toBe(187000);
    expect(w.balances.available.amountMinor).toBe(0);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({
      where: { paymentId: paid.id },
    });
    expect(earning.status).toBe('HELD');

    const dispute = await ctx.prisma.dispute.findFirstOrThrow({ where: { jobId: job.jobId } });
    await ctx
      .http()
      .post(`/api/v1/admin/disputes/${dispute.id}/resolve`)
      .set('Authorization', bearer(admin))
      .send({ outcome: 'RESOLVED_PARTIAL', note: 'Kısmi iade kararı.' })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('DISPUTE_FINANCIAL_ACTION_REQUIRED'));
    const resolved = await ctx
      .http()
      .post(`/api/v1/admin/disputes/${dispute.id}/resolve`)
      .set('Authorization', bearer(admin))
      .send({
        outcome: 'RESOLVED_PARTIAL',
        note: 'İşin yarısı yapılmış; 1000 TL iade.',
        financialAction: { type: 'PARTIAL_CUSTOMER_REFUND', refundAmountMinor: 100000 },
      })
      .expect(200);
    expect(resolved.body.status).toBe('RESOLVED_PARTIAL');
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paid.id } });
    expect(payment.status).toBe('PARTIALLY_REFUNDED');
    w = await walletOf(ctx, job.provider);
    // 1000 refund = 150 fee + 850 provider; the rest (1870 − 850 = 1020) is released.
    expect(w.balances.held.amountMinor).toBe(0);
    expect(w.balances.pending.amountMinor).toBe(0);
    expect(w.balances.available.amountMinor).toBe(102000);
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('F2: release to the provider needs no refund', async () => {
    const job = await agreedJob(ctx, m);
    jobIds.push(job.jobId);
    await payOnline(ctx, job.customer, job.jobId);
    await startWork(ctx, job);
    await step(ctx, job.customer, job.jobId, 'dispute', {
      reason: 'POOR_QUALITY',
      description: 'İş beklediğim gibi olmadı, kontrol edilsin.',
    }).expect(200);
    const dispute = await ctx.prisma.dispute.findFirstOrThrow({ where: { jobId: job.jobId } });
    await ctx
      .http()
      .post(`/api/v1/admin/disputes/${dispute.id}/resolve`)
      .set('Authorization', bearer(admin))
      .send({
        outcome: 'RESOLVED_FOR_PROVIDER',
        note: 'İş eksiksiz yapılmış.',
        financialAction: { type: 'RELEASE_PROVIDER_FUNDS' },
      })
      .expect(200);
    const w = await walletOf(ctx, job.provider);
    expect(w.balances.available.amountMinor).toBe(187000);
    expect(w.balances.held.amountMinor).toBe(0);
  });
});
