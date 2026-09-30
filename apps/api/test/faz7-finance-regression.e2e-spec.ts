import { quoteSchema } from '@ustago/validation';

import { createRequestV2, dispatchesOf, setCoverage } from './faz7-helpers.js';
import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { expectLedgerConsistent, payOnline, summaryOf, walletOf } from './finance-helpers.js';
import { answerChangeOrder, createChangeOrder, getJob, startWork, stepOk } from './job-helpers.js';
import {
  accept,
  adanaMarket,
  counter,
  createQuote,
  customerIn,
  type Market,
  providerIn,
} from './marketplace-helpers.js';

/**
 * Faz 7 must not change money: the Faz 5 acceptance numbers, reached
 * through the Faz 7 path (V2 request with a budget range and schedule,
 * wave dispatch, a quote with labour / material / service / other lines
 * and an arrival estimate, negotiation). Agreed ₺2.200 + accepted change
 * order ₺500 = ₺2.700; 15 % commission = ₺405; provider gets ₺2.295;
 * the ledger balances.
 */
describe('Faz 7: finance regression (e2e)', () => {
  let ctx: TestContext;
  let m: Market;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('2.200 agreed + 500 change order = 2.700; fee 405; provider 2.295; ledger balanced', async () => {
    const customer = await customerIn(ctx, m.seyhan);
    const provider = await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan, m.cukurova],
      displayName: 'Faz 7 Klima Ustası',
    });
    await setCoverage(ctx, provider, { serviceCenterDistrictId: m.cukurova }).expect(200);

    const request = await createRequestV2(ctx, customer, {
      categoryId: m.klimaId,
      title: 'Klima montajı',
      budgetMinor: 150000,
      budgetMaxMinor: 200000,
      scheduleOption: 'TOMORROW',
    });
    expect((await dispatchesOf(ctx, request.id)).map((d) => d.providerId)).toContain(
      provider.providerId,
    );

    // Offer 2.500 in four lines, then 2.000 ↔ 2.200 and accepted.
    const offer = await createQuote(ctx, provider, request.id, 250000, {
      laborMinor: 150000,
      materialMinor: 70000,
      serviceMinor: 20000,
      otherMinor: 10000,
      arrivalEta: 'TOMORROW',
    });
    expect(offer.latest.service?.amountMinor).toBe(20000);
    await counter(ctx, customer, offer.id, 200000, 1).expect(200);
    await counter(ctx, provider, offer.id, 220000, 2).expect(200);
    const accepted = await accept(ctx, customer, offer.id, 3).expect(200);
    const jobId = accepted.body.jobId as string;
    const quote = quoteSchema.parse(
      (
        await ctx
          .http()
          .get(`/api/v1/quotes/${offer.id}`)
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(quote.status).toBe('ACCEPTED');
    expect(quote.latest.total.amountMinor).toBe(220000);

    const job = await getJob(ctx, customer, jobId);
    expect(job.agreedPrice.amountMinor).toBe(220000);

    await startWork(ctx, { customer, provider, jobId, requestId: request.id });
    const co = await createChangeOrder(ctx, provider, jobId, 50000);
    await answerChangeOrder(ctx, customer, co.id, 'accept').expect(200);
    const row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(row.agreedPriceMinor).toBe(220000n);
    expect(row.currentTotalMinor).toBe(270000n);
    expect((await summaryOf(ctx, customer, jobId)).outstanding.amountMinor).toBe(270000);

    const payment = await payOnline(ctx, customer, jobId, 'SUCCESS');
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.amount.amountMinor).toBe(270000);
    const paid = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.platformFeeMinor).toBe(40500n);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(earning).toMatchObject({ grossMinor: 270000n, feeMinor: 40500n, netMinor: 229500n });
    await expectLedgerConsistent(ctx, [jobId]);

    await stepOk(ctx, provider, jobId, 'request-completion');
    await stepOk(ctx, customer, jobId, 'complete');
    const wallet = await walletOf(ctx, provider);
    expect(wallet.balances.available.amountMinor).toBe(229500);
    expect(wallet.balances.pending.amountMinor).toBe(0);
    await expectLedgerConsistent(ctx, [jobId]);
  });
});
