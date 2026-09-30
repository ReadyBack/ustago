import { cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, type AgreedJob } from './job-helpers.js';
import { adanaMarket } from './marketplace-helpers.js';
import { payOnline } from './finance-helpers.js';

/**
 * The database itself refuses what the services must never do: change or
 * delete ledger rows, commit an unbalanced transaction, refund more than
 * was paid or start two payments for one job at once.
 */
describe('Finance: database guards', () => {
  let ctx: TestContext;
  let job: AgreedJob;
  let paymentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    const m = await adanaMarket(ctx);
    job = await agreedJob(ctx, m);
    paymentId = (await payOnline(ctx, job.customer, job.jobId)).id;
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('ledger rows cannot be updated or deleted', async () => {
    const entry = await ctx.prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId } });
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE ledger_entries SET amount_minor = 1 WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`DELETE FROM ledger_entries WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE ledger_transactions SET description = 'x' WHERE id = ${entry.transactionId}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('an unbalanced ledger transaction is refused at commit', async () => {
    const clearing = await ctx.prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PLATFORM_CLEARING', providerId: null },
    });
    const revenue = await ctx.prisma.ledgerAccount.findFirstOrThrow({
      where: { type: 'PLATFORM_FEE_REVENUE', providerId: null },
    });
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        const t = await tx.ledgerTransaction.create({
          data: { type: 'ADJUSTMENT', sourceKey: `e2e:unbalanced:${paymentId}` },
        });
        await tx.ledgerEntry.createMany({
          data: [
            { transactionId: t.id, accountId: clearing.id, direction: 'DEBIT', amountMinor: 100n },
            { transactionId: t.id, accountId: revenue.id, direction: 'CREDIT', amountMinor: 99n },
          ],
        });
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(
      await ctx.prisma.ledgerTransaction.count({
        where: { sourceKey: `e2e:unbalanced:${paymentId}` },
      }),
    ).toBe(0);
  });

  it('refunds can never exceed the payment, even written directly', async () => {
    await expect(
      ctx.prisma.refund.create({
        data: {
          paymentId,
          jobId: job.jobId,
          amountMinor: 220001n,
          feePortionMinor: 33000n,
          providerPortionMinor: 187001n,
          reason: 'OTHER',
          idempotencyKey: `e2e:over:${paymentId}`,
        },
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it('only one payment can be in flight per job', async () => {
    const other = await agreedJob(ctx, await adanaMarket(ctx));
    const row = {
      jobId: other.jobId,
      payerId: other.customer.userId,
      method: 'IN_APP' as const,
      amountMinor: 220000n,
      gateway: 'mock',
    };
    await ctx.prisma.payment.create({ data: { ...row, idempotencyKey: `e2e:a:${other.jobId}` } });
    await expect(
      ctx.prisma.payment.create({ data: { ...row, idempotencyKey: `e2e:b:${other.jobId}` } }),
    ).rejects.toThrow();
  });

  it('amounts must be positive integers', async () => {
    await expect(
      ctx.prisma.$executeRaw`UPDATE payments SET amount_minor = 0 WHERE id = ${paymentId}::uuid`,
    ).rejects.toThrow(/payments_amount_positive_chk/);
  });
});
