import {
  adminDisputeDetailSchema,
  adminDisputeListItemSchema,
  adminJobDetailSchema,
  adminJobListItemSchema,
  paginatedSchema,
  providerQualitySchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  agreedJob,
  answerChangeOrder,
  createChangeOrder,
  startWork,
  stepOk,
} from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';

describe('Admin: jobs and disputes (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Awaited<ReturnType<typeof createStaffUser>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = await createStaffUser(ctx, ['ADMIN']);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const get = (path: string) =>
    ctx.http().get(`/api/v1/admin/${path}`).set('Authorization', bearer(admin));

  it('lists and filters jobs, and shows a detail with minimal personal data', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    const co = await createChangeOrder(ctx, job.provider, job.jobId, 50000);
    await answerChangeOrder(ctx, job.customer, co.id, 'accept').expect(200);

    const byStatus = paginatedSchema(adminJobListItemSchema).parse(
      (await get(`jobs?status=IN_PROGRESS&providerId=${job.provider.providerId}`).expect(200)).body,
    );
    expect(byStatus.items.map((j) => j.id)).toEqual([job.jobId]);
    expect(byStatus.items[0]).toMatchObject({
      agreedPrice: { amountMinor: 220000 },
      currentTotal: { amountMinor: 270000 },
    });
    const byCustomer = await get(`jobs?customerId=${job.customer.userId}`).expect(200);
    expect(byCustomer.body.items).toHaveLength(1);
    const byProvince = await get(`jobs?provinceId=34&providerId=${job.provider.providerId}`).expect(
      200,
    );
    expect(byProvince.body.items).toHaveLength(0);
    const byCategory = await get(
      `jobs?categoryId=${m.klimaId}&providerId=${job.provider.providerId}`,
    ).expect(200);
    expect(byCategory.body.items).toHaveLength(1);
    const future = new Date(Date.now() + 86400_000).toISOString();
    const byDate = await get(`jobs?from=${future}&providerId=${job.provider.providerId}`).expect(
      200,
    );
    expect(byDate.body.items).toHaveLength(0);

    const detail = adminJobDetailSchema.parse((await get(`jobs/${job.jobId}`).expect(200)).body);
    expect(detail.negotiation.map((r) => r.total.amountMinor)).toEqual([250000, 200000, 220000]);
    expect(detail.acceptedRevisionId).toBe(detail.negotiation[2]?.id);
    expect(detail.changeOrders).toHaveLength(1);
    expect(detail.statusHistory.map((h) => h.to)).toEqual([
      'CREATED',
      'PROVIDER_EN_ROUTE',
      'PROVIDER_ARRIVED',
      'IN_PROGRESS',
    ]);
    expect(detail.statusHistory[1]?.actor).toBe('PROVIDER');
    expect(detail.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['job.started', 'job.change_order.accepted']),
    );
    expect(detail.customer.maskedPhone).toMatch(/\*/);
    const raw = JSON.stringify(detail);
    expect(raw).not.toContain('Atatürk Caddesi');
    expect(raw).not.toContain('Kapı kodu');
  });

  it('refuses non-admins', async () => {
    const job = await agreedJob(ctx, m);
    await ctx
      .http()
      .get('/api/v1/admin/jobs')
      .set('Authorization', bearer(job.customer))
      .expect(403);
    await ctx
      .http()
      .get('/api/v1/admin/disputes')
      .set('Authorization', bearer(job.provider))
      .expect(403);
  });

  it('resolves a dispute once, notifies both parties and rescores the provider', async () => {
    const job = await agreedJob(ctx, m);
    await startWork(ctx, job);
    await stepOk(ctx, job.provider, job.jobId, 'request-completion');
    const disputed = await stepOk(ctx, job.customer, job.jobId, 'dispute', {
      reason: 'POOR_QUALITY',
      description: 'Klima hâlâ soğutmuyor, iş eksik kaldı.',
    });
    const disputeId = disputed.dispute?.id ?? '';

    const open = paginatedSchema(adminDisputeListItemSchema).parse(
      (await get('disputes?group=OPEN').expect(200)).body,
    );
    expect(open.items.map((d) => d.id)).toContain(disputeId);
    const before = providerQualitySchema.parse(
      (await get(`providers/${job.provider.providerId}/quality`).expect(200)).body,
    );
    expect(before.openDisputes).toBe(1);

    await ctx
      .http()
      .post(`/api/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', bearer(admin))
      .send({ outcome: 'RESOLVED_FOR_CUSTOMER', note: '' })
      .expect(400);
    const resolved = adminDisputeDetailSchema.parse(
      (
        await ctx
          .http()
          .post(`/api/v1/admin/disputes/${disputeId}/resolve`)
          .set('Authorization', bearer(admin))
          .send({
            outcome: 'RESOLVED_FOR_CUSTOMER',
            note: 'Usta işi eksik bıraktı; müşteri haklı bulundu.',
          })
          .expect(200)
      ).body,
    );
    expect(resolved).toMatchObject({ status: 'RESOLVED_FOR_CUSTOMER' });
    expect(resolved.resolvedBy?.id).toBe(admin.user.id);
    const twice = await ctx
      .http()
      .post(`/api/v1/admin/disputes/${disputeId}/resolve`)
      .set('Authorization', bearer(admin))
      .send({ outcome: 'CLOSED', note: 'İkinci karar denemesi' })
      .expect(409);
    expect(twice.body.code).toBe('DISPUTE_ALREADY_RESOLVED');

    const after = providerQualitySchema.parse(
      (await get(`providers/${job.provider.providerId}/quality`).expect(200)).body,
    );
    expect(after.openDisputes).toBe(0);
    for (const userId of [job.customer.userId, job.provider.userId]) {
      const note = await ctx.prisma.notification.findFirst({
        where: { userId, type: 'dispute.resolved' },
      });
      expect(note?.title).toBe('Sorun bildirimi sonuçlandı.');
    }
    const resolvedList = await get('disputes?group=RESOLVED').expect(200);
    expect((resolvedList.body.items as { id: string }[]).map((d) => d.id)).toContain(disputeId);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: disputeId, action: 'dispute.resolved' },
      }),
    ).toBe(1);
  });
});
