import { cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, completedJob, createChangeOrder, startWork } from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';

/**
 * Faz 4 database guarantees (migration 20261001090000): even a bug or a
 * hand-written UPDATE cannot rewrite the agreed price, a step timestamp or
 * a change order's arithmetic.
 */
describe('Job lifecycle constraints (e2e, real PostgreSQL)', () => {
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

  it('never changes the agreed price', async () => {
    const job = await agreedJob(ctx, m);
    await expect(
      ctx.prisma.job.update({ where: { id: job.jobId }, data: { agreedPriceMinor: 1n } }),
    ).rejects.toThrow(/agreed/i);
  });

  it('writes step timestamps once and in order', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    await expect(
      ctx.prisma.job.update({ where: { id: job.jobId }, data: { enRouteAt: new Date() } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.job.update({ where: { id: job.jobId }, data: { arrivedAt: null } }),
    ).rejects.toThrow();
    // A completion time without a completion request breaks the step order.
    await expect(
      ctx.prisma.job.update({ where: { id: job.jobId }, data: { completedAt: new Date() } }),
    ).rejects.toThrow();
  });

  it('keeps the current total at or above the agreed price', async () => {
    const job = await agreedJob(ctx, m);
    await expect(
      ctx.prisma.job.update({ where: { id: job.jobId }, data: { currentTotalMinor: 100n } }),
    ).rejects.toThrow(/jobs_current_total_ge_agreed_chk/);
  });

  it('checks change order arithmetic and allows one pending order per job', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    const co = await createChangeOrder(ctx, job.provider, job.jobId, 50000);
    await expect(
      ctx.prisma.changeOrder.update({ where: { id: co.id }, data: { proposedTotalMinor: 999n } }),
    ).rejects.toThrow(/change_orders_totals_chk/);
    await expect(
      ctx.prisma.changeOrder.create({
        data: {
          jobId: job.jobId,
          requestedById: job.provider.userId,
          description: 'İkinci bekleyen talep',
          amountDeltaMinor: 1000n,
          previousTotalMinor: 220000n,
          proposedTotalMinor: 221000n,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      ctx.prisma.changeOrder.update({ where: { id: co.id }, data: { status: 'ACCEPTED' } }),
    ).rejects.toThrow(/change_orders_responded_chk/);
  });

  it('allows one review per job with ratings 1-5', async () => {
    const job = await completedJob(ctx, m);
    const data = {
      jobId: job.jobId,
      direction: 'CUSTOMER_TO_PROVIDER' as const,
      authorId: job.customer.userId,
      targetId: job.provider.userId,
    };
    await expect(ctx.prisma.review.create({ data: { ...data, rating: 6 } })).rejects.toThrow(
      /reviews_rating_range_chk/,
    );
    await ctx.prisma.review.create({ data: { ...data, rating: 5 } });
    await expect(ctx.prisma.review.create({ data: { ...data, rating: 4 } })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(
      ctx.prisma.review.updateMany({ where: { jobId: job.jobId }, data: { status: 'HIDDEN' } }),
    ).rejects.toThrow(/reviews_hidden_moderated_chk/);
  });
});
