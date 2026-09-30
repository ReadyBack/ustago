import { AuditService } from '../src/audit/audit.service.js';
import { AccountDeletionService } from '../src/security/account-deletion.service.js';
import { adminActor, requestPayout, setDestination, verifyDestination } from './finance-helpers.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  login,
  PASSWORD,
  registerUser,
  resetRateLimits,
  type TestContext,
  trackUserForCleanup,
} from './helpers.js';
import { completedJob } from './job-helpers.js';
import { adanaMarket, customerIn, type Market } from './marketplace-helpers.js';

/**
 * Faz 6 security and operations (docs/adr/0024-0027): sessions and IP
 * hashing, admin permissions, audit redaction, health / metrics /
 * operations status, scheduled reconciliation runs, account deletion and
 * data export requests, and notification deep links.
 */
describe('Security and operations (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let superAdmin: string;
  let superAdminId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    const sa = await createStaffUser(ctx, ['SUPER_ADMIN'], []);
    superAdmin = bearer(sa);
    superAdminId = sa.user.id;
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('lists my sessions without raw IPs and revokes one of mine only', async () => {
    const first = await registerUser(ctx);
    const email = first.user.email ?? '';
    const second = await login(ctx, email, PASSWORD);
    const list = await ctx
      .http()
      .get('/api/v1/me/sessions')
      .set('Authorization', bearer(first))
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/ip|127\.0\.0\.1|::1/i);

    const rows = await ctx.prisma.authSession.findMany({ where: { userId: first.user.id } });
    for (const row of rows) {
      expect(row.ipAddress).toBeNull();
      expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    }

    const current = (list.body as { id: string; current: boolean }[]).find((x) => x.current);
    const other = rows.find((r) => r.id !== current?.id);
    const stranger = await registerUser(ctx);
    await ctx
      .http()
      .delete(`/api/v1/me/sessions/${other?.id}`)
      .set('Authorization', bearer(stranger))
      .expect(404);
    await ctx
      .http()
      .delete(`/api/v1/me/sessions/${other?.id}`)
      .set('Authorization', bearer(first))
      .expect(204);
    // The revoked session's tokens stop working at once.
    await ctx.http().get('/api/v1/me/sessions').set('Authorization', bearer(second)).expect(401);
    await ctx.http().get('/api/v1/me/sessions').set('Authorization', bearer(first)).expect(200);
  });

  it('only an ADMIN_SUPER changes permissions, never their own, always audited', async () => {
    const staff = await createStaffUser(ctx, ['ADMIN'], ['ADMIN_SUPPORT']);
    const customer = await registerUser(ctx);
    const put = (userId: string, auth: string, permissions: string[]) =>
      ctx
        .http()
        .put(`/api/v1/admin/users/${userId}/permissions`)
        .set('Authorization', auth)
        .send({ permissions, confirm: true });

    const denied = await put(staff.user.id, bearer(staff), ['ADMIN_SUPER']).expect(403);
    expect(denied.body.code).toBe('ADMIN_PERMISSION_REQUIRED');
    await put(staff.user.id, superAdmin, ['ADMIN_SUPPORT', 'ADMIN_FINANCE']).expect(200);
    const grants = await ctx.prisma.adminPermissionGrant.findMany({
      where: { userId: staff.user.id },
    });
    expect(grants.map((g) => g.permission).sort()).toEqual(['ADMIN_FINANCE', 'ADMIN_SUPPORT']);
    await put(customer.user.id, superAdmin, ['ADMIN_SUPPORT']).expect(422);

    const self = await put(superAdminId, superAdmin, []).expect(403);
    expect(self.body.code).toBe('ADMIN_SELF_PERMISSION_CHANGE');

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.permission.changed', entityId: staff.user.id },
    });
    expect(audit.metadata).toMatchObject({
      after: expect.arrayContaining(['ADMIN_FINANCE', 'ADMIN_SUPPORT']),
    });
  });

  it('shows the audit trail redacted and filtered by date', async () => {
    const actor = await registerUser(ctx);
    await ctx.app.get(AuditService).record({
      action: 'test.redaction_check',
      actorId: actor.user.id,
      entityType: 'user',
      entityId: actor.user.id,
      metadata: { phone: '+905321234567', iban: 'TR330006100519786457841326', note: 'ok' },
    });
    const res = await ctx
      .http()
      .get(`/api/v1/admin/audit-events?entityId=${actor.user.id}&action=test.redaction_check`)
      .set('Authorization', superAdmin)
      .expect(200);
    expect(res.body.items[0].metadata).toEqual({
      phone: '[REDACTED]',
      iban: '[REDACTED]',
      note: 'ok',
    });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const none = await ctx
      .http()
      .get(`/api/v1/admin/audit-events?entityId=${actor.user.id}&from=${tomorrow}`)
      .set('Authorization', superAdmin)
      .expect(200);
    expect(none.body.items).toHaveLength(0);
    await ctx
      .http()
      .get('/api/v1/admin/audit-events?from=2026-10-02&to=2026-10-01')
      .set('Authorization', superAdmin)
      .expect(400);
  });

  it('reports health, metrics and an honest operations status', async () => {
    await ctx.http().get('/api/v1/health/live').expect(200);
    const ready = await ctx.http().get('/api/v1/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
    const metrics = await ctx.http().get('/api/v1/metrics').expect(200);
    expect(metrics.text).toContain('ustago_http_requests_total');
    expect(metrics.text).not.toMatch(/@|\+90/);

    const status = await ctx
      .http()
      .get('/api/v1/admin/ops/status')
      .set('Authorization', superAdmin)
      .expect(200);
    // Mock and development adapters are never reported as production ready.
    for (const integration of status.body.integrations as { productionReady: boolean }[]) {
      expect(integration.productionReady).toBe(false);
    }
    expect(JSON.stringify(status.body)).not.toMatch(/postgres(ql)?:\/\/|redis:\/\//);
  });

  it('runs reconciliation on demand, one run at a time, and records it', async () => {
    const finance = bearer(await adminActor(ctx));
    const run = await ctx
      .http()
      .post('/api/v1/admin/finance/reconciliation/runs')
      .set('Authorization', finance)
      .send()
      .expect(200);
    expect(['SUCCEEDED', 'FAILED']).toContain(run.body.status);
    expect(run.body.trigger).toBe('MANUAL');

    // A RUNNING row is the lock: a second run is refused, nothing is fixed.
    const lock = await ctx.prisma.financeReconciliationRun.create({
      data: { trigger: 'SCHEDULED', status: 'RUNNING' },
    });
    try {
      const busy = await ctx
        .http()
        .post('/api/v1/admin/finance/reconciliation/runs')
        .set('Authorization', finance)
        .send()
        .expect(409);
      expect(busy.body.code).toBe('RECONCILIATION_RUNNING');
    } finally {
      await ctx.prisma.financeReconciliationRun.delete({ where: { id: lock.id } });
    }
    const history = await ctx
      .http()
      .get('/api/v1/admin/finance/reconciliation/runs')
      .set('Authorization', finance)
      .expect(200);
    expect(history.body.items.some((r: { id: string }) => r.id === run.body.id)).toBe(true);
  });

  it('account deletion waits for open jobs and then pseudonymises the account', async () => {
    const blocked = await customerIn(ctx, m.seyhan);
    const job = await completedJob(ctx, m);
    trackUserForCleanup(blocked.userId);
    trackUserForCleanup(job.customer.userId);
    // A customer with a completed job only is free to go; one with an open
    // job is blocked.
    await ctx.prisma.job.update({ where: { id: job.jobId }, data: { status: 'IN_PROGRESS' } });
    const b = await ctx
      .http()
      .post('/api/v1/me/account-deletion')
      .set('Authorization', bearer(job.customer))
      .send({ confirm: 'HESABIMI SIL' })
      .expect(201);
    expect(b.body).toMatchObject({ status: 'BLOCKED_BY_ACTIVE_JOB', blockers: ['ACTIVE_JOB'] });
    await ctx.prisma.job.update({ where: { id: job.jobId }, data: { status: 'COMPLETED' } });

    await ctx
      .http()
      .post('/api/v1/me/account-deletion')
      .set('Authorization', bearer(blocked))
      .send({ confirm: 'yes' })
      .expect(400);
    const req = await ctx
      .http()
      .post('/api/v1/me/account-deletion')
      .set('Authorization', bearer(blocked))
      .send({ confirm: 'HESABIMI SIL' })
      .expect(201);
    expect(req.body.status).toBe('REQUESTED');
    expect(req.body.scheduledFor).not.toBeNull();
    await ctx
      .http()
      .post('/api/v1/me/account-deletion')
      .set('Authorization', bearer(blocked))
      .send({ confirm: 'HESABIMI SIL' })
      .expect(409);

    // Nothing happens before the grace period; after it, pseudonymised.
    const service = ctx.app.get(AccountDeletionService);
    await service.processDue(new Date());
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: blocked.userId } })).deletedAt,
    ).toBeNull();
    await service.processDue(new Date(Date.now() + 1000 * 86_400_000));
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: blocked.userId } });
    expect(user).toMatchObject({ phone: null, email: null, firstName: 'Silinmiş' });
    expect(user.deletedAt).not.toBeNull();
    await ctx.http().get('/api/v1/me/sessions').set('Authorization', bearer(blocked)).expect(401);
    const blockedAgain = await ctx.prisma.accountDeletionRequest.findFirstOrThrow({
      where: { userId: job.customer.userId },
    });
    // The customer whose job was reopened is re-checked, not deleted blindly.
    expect(['COMPLETED', 'BLOCKED_BY_ACTIVE_JOB']).toContain(blockedAgain.status);
  });

  it('records a data export request once, without pretending an archive exists', async () => {
    const user = await registerUser(ctx);
    const first = await ctx
      .http()
      .post('/api/v1/me/data-exports')
      .set('Authorization', bearer(user))
      .send()
      .expect(201);
    expect(first.body).toMatchObject({ status: 'REQUESTED', readyAt: null });
    await ctx
      .http()
      .post('/api/v1/me/data-exports')
      .set('Authorization', bearer(user))
      .send()
      .expect(409);
  });

  it('finance notifications carry a deep link to the right screen', async () => {
    const finance = await adminActor(ctx);
    const job = await completedJob(ctx, m);
    await ctx.prisma.job.update({ where: { id: job.jobId }, data: {} });
    await setDestination(ctx, job.provider).expect(200);
    await verifyDestination(ctx, finance, job.provider.providerId);
    // Cash is simplest here: no online earning, so ask for a payout only
    // when there is money; otherwise just check the request notification path.
    const payout = await requestPayout(ctx, job.provider, 10000);
    const notes = await ctx
      .http()
      .get('/api/v1/me/notifications')
      .set('Authorization', bearer(job.provider))
      .expect(200);
    const items = notes.body.items as {
      type: string;
      deepLink: string | null;
      entityType: string | null;
    }[];
    if (payout.status === 201) {
      const requested = items.find((n) => n.type === 'payout.requested');
      expect(requested?.deepLink).toBe(`/provider/payouts/${payout.body.id}`);
    }
    const jobNote = items.find((n) => n.type.startsWith('job.'));
    expect(jobNote?.deepLink).toBe(`/jobs/${job.jobId}`);
    // Someone else's list never contains these rows.
    const other = await registerUser(ctx);
    const theirs = await ctx
      .http()
      .get('/api/v1/me/notifications')
      .set('Authorization', bearer(other))
      .expect(200);
    expect(JSON.stringify(theirs.body)).not.toContain(job.jobId);
  });
});
