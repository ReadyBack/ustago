import { MOCK_SIGNATURE_HEADER } from '../src/finance/providers/mock-payment.provider.js';
import { cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, type AgreedJob } from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';
import {
  createPayment,
  expectLedgerConsistent,
  mockProvider,
  summaryOf,
} from './finance-helpers.js';

/**
 * Webhooks are the only way money states move: signature and timestamp
 * are checked on the raw body, every event is processed once (unique
 * event id), and late events never move a payment backwards.
 */
describe('Finance: payment webhooks', () => {
  let ctx: TestContext;
  let m: Market;
  let job: AgreedJob;
  let paymentId: string;
  let providerPaymentId: string;

  const post = (rawBody: Buffer, headers: Record<string, string>, provider = 'mock') => {
    const req = ctx.http().post(`/api/v1/webhooks/payments/${provider}`);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req.send(rawBody.toString('utf8'));
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    job = await agreedJob(ctx, m);
    const created = await createPayment(ctx, job.customer, job.jobId).expect(200);
    paymentId = created.body.id;
    const attempt = await ctx.prisma.paymentTransaction.findFirstOrThrow({
      where: { paymentId },
    });
    providerPaymentId = attempt.gatewayTransactionId ?? '';
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  const succeeded = (amountMinor = '220000', id?: string, now?: Date) =>
    mockProvider(ctx).signedEvent(
      {
        ...(id ? { id } : {}),
        type: 'payment.succeeded',
        data: { providerPaymentId, amountMinor, currency: 'TRY' },
      },
      now,
    );

  it('rejects an unknown provider, a missing or wrong signature and a malformed body', async () => {
    const event = succeeded();
    await post(event.rawBody, event.headers, 'iyzico').expect(404);
    await post(event.rawBody, { 'content-type': 'application/json' }).expect(401);
    const [t] = (event.headers[MOCK_SIGNATURE_HEADER] ?? '').split(',');
    await post(event.rawBody, {
      'content-type': 'application/json',
      [MOCK_SIGNATURE_HEADER]: `${t},v1=${'0'.repeat(64)}`,
    }).expect(401);
    // Signed body changed after signing.
    const tampered = Buffer.from(event.rawBody.toString('utf8').replace('220000', '1'), 'utf8');
    await post(tampered, event.headers).expect(401);
    const s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.paid.amountMinor).toBe(0);
  });

  it('rejects a replayed event outside the timestamp window', async () => {
    const old = succeeded('220000', undefined, new Date(Date.now() - 3600_000));
    await post(old.rawBody, old.headers)
      .expect(401)
      .expect((res) => expect(res.body.code).toBe('WEBHOOK_TIMESTAMP_OUT_OF_RANGE'));
  });

  it('ignores an event whose amount does not match the attempt', async () => {
    const wrong = succeeded('1');
    const res = await post(wrong.rawBody, wrong.headers).expect(200);
    expect(res.body.outcome).toBe('IGNORED_UNKNOWN');
    const s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.paid.amountMinor).toBe(0);
  });

  it('processes the same event once, even when it arrives 5 times at once', async () => {
    const event = succeeded('220000', `evt_dup_${paymentId}`);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(event.rawBody, event.headers)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    const rows = await ctx.prisma.webhookEvent.count({
      where: { provider: 'mock', eventId: `evt_dup_${paymentId}` },
    });
    expect(rows).toBe(1);
    const captured = await ctx.prisma.ledgerTransaction.count({
      where: { paymentId, type: 'PAYMENT_CAPTURED' },
    });
    expect(captured).toBe(1);
    const s = await summaryOf(ctx, job.customer, job.jobId);
    expect(s.paid.amountMinor).toBe(220000);
  });

  it('a late "failed" event after success never moves the payment back', async () => {
    const late = mockProvider(ctx).signedEvent({
      type: 'payment.failed',
      data: { providerPaymentId, amountMinor: '220000', currency: 'TRY', failureCode: 'LATE' },
    });
    const res = await post(late.rawBody, late.headers).expect(200);
    expect(res.body.outcome).toBe('IGNORED_STALE');
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('SUCCEEDED');
    await expectLedgerConsistent(ctx, [job.jobId]);
  });

  it('stores the payload without the signature header or secrets', async () => {
    const row = await ctx.prisma.webhookEvent.findFirstOrThrow({
      where: { provider: 'mock', eventId: `evt_dup_${paymentId}` },
    });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('v1=');
    expect(stored).not.toMatch(/secret/i);
  });
});
