import { cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  agreedJob,
  answerChangeOrder,
  createChangeOrder,
  postReview,
  proposeChangeOrder,
  startWork,
  step,
  stepOk,
} from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';

/**
 * Races on real PostgreSQL: row locks plus conditional updates must let
 * exactly one request win and write everything exactly once.
 */
describe('Job concurrency (e2e)', () => {
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

  it('accept × accept on a change order adds the amount once', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    const co = await createChangeOrder(ctx, job.provider, job.jobId, 50000);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => answerChangeOrder(ctx, job.customer, co.id, 'accept')),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    const row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(row.currentTotalMinor).toBe(270000n);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: job.jobId, action: 'job.change_order.accepted' },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: { userId: job.provider.userId, type: 'change_order.accepted' },
      }),
    ).toBe(1);
  });

  it('accept × reject: exactly one wins and the total matches the winner', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    const co = await createChangeOrder(ctx, job.provider, job.jobId, 30000);
    const [a, r] = await Promise.all([
      answerChangeOrder(ctx, job.customer, co.id, 'accept'),
      answerChangeOrder(ctx, job.customer, co.id, 'reject'),
    ]);
    expect([a.status, r.status].sort()).toEqual([200, 409]);
    const order = await ctx.prisma.changeOrder.findUniqueOrThrow({ where: { id: co.id } });
    const row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
    if (order.status === 'ACCEPTED') expect(row.currentTotalMinor).toBe(250000n);
    else expect(row.currentTotalMinor).toBe(220000n);
  });

  it('two providers’ devices proposing at once leave one pending change order', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    const results = await Promise.all(
      [10000, 20000, 30000].map((amount) =>
        proposeChangeOrder(ctx, job.provider, job.jobId, amount),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(
      await ctx.prisma.changeOrder.count({ where: { jobId: job.jobId, status: 'PENDING' } }),
    ).toBe(1);
  });

  it('a double-tapped step moves the job once', async () => {
    const job = await agreedJob(ctx, m);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => step(ctx, job.provider, job.jobId, 'en-route')),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(
      await ctx.prisma.jobStatusHistory.count({
        where: { jobId: job.jobId, toStatus: 'PROVIDER_EN_ROUTE' },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: { userId: job.customer.userId, type: 'job.en_route' },
      }),
    ).toBe(1);
  });

  it('complete × dispute on a completion request: one outcome only', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    const [done, dispute] = await Promise.all([
      step(ctx, job.customer, job.jobId, 'complete'),
      step(ctx, job.customer, job.jobId, 'dispute', {
        reason: 'POOR_QUALITY',
        description: 'Aynı anda sorun bildirimi denemesi.',
      }),
    ]);
    expect([done.status, dispute.status].sort()).toEqual([200, 409]);
    const row = await ctx.prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(['COMPLETED', 'DISPUTED']).toContain(row.status);
    expect(row.completedAt === null).toBe(row.status === 'DISPUTED');
  });

  it('customer cancel × provider en-route: never both', async () => {
    const job = await agreedJob(ctx, m);
    const [cancel, go] = await Promise.all([
      step(ctx, job.customer, job.jobId, 'cancel', { reason: 'Vazgeçtim' }),
      step(ctx, job.provider, job.jobId, 'en-route'),
    ]);
    expect([cancel.status, go.status].sort()).toEqual([200, 409]);
  });

  it('a double-tapped review creates one review', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    await stepOk(ctx, job.customer, job.jobId, 'complete');
    const results = await Promise.all(
      Array.from({ length: 3 }, () => postReview(ctx, job.customer, job.jobId, { rating: 5 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await ctx.prisma.review.count({ where: { jobId: job.jobId } })).toBe(1);
  });
});
