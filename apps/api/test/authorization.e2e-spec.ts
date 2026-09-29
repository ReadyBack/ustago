import { currentUserSchema, paginatedSchema, providerProfileSchema } from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  login,
  registerUser,
  type TestContext,
  uniqueEmail,
} from './helpers.js';

describe('Authorization / RBAC (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  describe('admin user management', () => {
    it('customers and providers get 403 on admin routes', async () => {
      const customer = await registerUser(ctx);
      const provider = await registerUser(ctx, { accountType: 'PROVIDER' });
      for (const auth of [customer, provider]) {
        const res = await ctx
          .http()
          .get('/api/v1/users')
          .set('Authorization', bearer(auth))
          .expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    });

    it('anonymous callers get 401 on admin routes', async () => {
      await ctx.http().get('/api/v1/users').expect(401);
    });

    it('admins can list and filter users with cursor pagination', async () => {
      const admin = await createStaffUser(ctx, ['ADMIN']);
      await registerUser(ctx, { accountType: 'PROVIDER' });
      await registerUser(ctx, { accountType: 'PROVIDER' });

      const first = await ctx
        .http()
        .get('/api/v1/users')
        .query({ role: 'PROVIDER', limit: 1 })
        .set('Authorization', bearer(admin))
        .expect(200);
      const page1 = paginatedSchema(currentUserSchema).parse(first.body);
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]?.roles).toContain('PROVIDER');
      expect(page1.nextCursor).not.toBeNull();

      const second = await ctx
        .http()
        .get('/api/v1/users')
        .query({ role: 'PROVIDER', limit: 1, cursor: page1.nextCursor })
        .set('Authorization', bearer(admin))
        .expect(200);
      const page2 = paginatedSchema(currentUserSchema).parse(second.body);
      expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    });

    it('suspending a user ends their sessions and blocks login', async () => {
      const admin = await createStaffUser(ctx, ['ADMIN']);
      const email = uniqueEmail('suspend');
      const victim = await registerUser(ctx, { email });

      await ctx
        .http()
        .patch(`/api/v1/users/${victim.user.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ status: 'SUSPENDED', reason: 'E2E test' })
        .expect(200);

      await ctx.http().get('/api/v1/me').set('Authorization', bearer(victim)).expect(401);
      const res = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'e2e-test-password-123' })
        .expect(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');

      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'user.status_changed', entityId: victim.user.id },
      });
      expect(audit?.actorId).toBe(admin.user.id);

      await ctx
        .http()
        .patch(`/api/v1/users/${victim.user.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ status: 'ACTIVE', reason: 'E2E test' })
        .expect(200);
      await login(ctx, email);
    });

    it('a plain admin cannot suspend another admin or change themselves', async () => {
      const admin = await createStaffUser(ctx, ['ADMIN']);
      const otherAdmin = await createStaffUser(ctx, ['ADMIN']);
      await ctx
        .http()
        .patch(`/api/v1/users/${otherAdmin.user.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ status: 'SUSPENDED', reason: 'E2E test' })
        .expect(403);
      const self = await ctx
        .http()
        .patch(`/api/v1/users/${admin.user.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ status: 'SUSPENDED', reason: 'E2E test' })
        .expect(403);
      expect(self.body.code).toBe('CANNOT_CHANGE_SELF');
    });

    it('only SUPER_ADMIN grants staff roles, and the change applies without a new token', async () => {
      const superAdmin = await createStaffUser(ctx, ['SUPER_ADMIN']);
      const admin = await createStaffUser(ctx, ['ADMIN']);
      const user = await registerUser(ctx);

      await ctx
        .http()
        .put(`/api/v1/users/${user.user.id}/roles/ADMIN`)
        .set('Authorization', bearer(admin))
        .expect(403);

      const granted = await ctx
        .http()
        .put(`/api/v1/users/${user.user.id}/roles/ADMIN`)
        .set('Authorization', bearer(superAdmin))
        .expect(200);
      expect(granted.body.roles).toEqual(['CUSTOMER', 'ADMIN']);

      // Same access token as before the grant.
      await ctx.http().get('/api/v1/users').set('Authorization', bearer(user)).expect(200);

      await ctx
        .http()
        .delete(`/api/v1/users/${user.user.id}/roles/ADMIN`)
        .set('Authorization', bearer(superAdmin))
        .expect(200);
      await ctx.http().get('/api/v1/users').set('Authorization', bearer(user)).expect(403);
    });

    it('rejects granting non-staff roles by hand and bad ids', async () => {
      const superAdmin = await createStaffUser(ctx, ['SUPER_ADMIN']);
      const user = await registerUser(ctx);
      await ctx
        .http()
        .put(`/api/v1/users/${user.user.id}/roles/PROVIDER`)
        .set('Authorization', bearer(superAdmin))
        .expect(400);
      await ctx
        .http()
        .get('/api/v1/users/not-a-uuid')
        .set('Authorization', bearer(superAdmin))
        .expect(400);
    });
  });

  describe('provider role', () => {
    it('a customer becomes a provider and keeps the customer role', async () => {
      const customer = await registerUser(ctx);
      await ctx
        .http()
        .get('/api/v1/providers/me')
        .set('Authorization', bearer(customer))
        .expect(403);

      const created = await ctx
        .http()
        .post('/api/v1/providers/me')
        .set('Authorization', bearer(customer))
        .send({ displayName: 'Test Usta' })
        .expect(201);
      expect(providerProfileSchema.parse(created.body).status).toBe('DRAFT');

      const me = await ctx
        .http()
        .get('/api/v1/me')
        .set('Authorization', bearer(customer))
        .expect(200);
      expect(me.body.roles).toEqual(['CUSTOMER', 'PROVIDER']);
      await ctx
        .http()
        .get('/api/v1/providers/me')
        .set('Authorization', bearer(customer))
        .expect(200);

      const again = await ctx
        .http()
        .post('/api/v1/providers/me')
        .set('Authorization', bearer(customer))
        .send({ displayName: 'Test Usta' })
        .expect(409);
      expect(again.body.code).toBe('PROVIDER_PROFILE_EXISTS');
    });

    it('a provider updates their own profile', async () => {
      const provider = await registerUser(ctx, { accountType: 'PROVIDER' });
      const res = await ctx
        .http()
        .patch('/api/v1/providers/me')
        .set('Authorization', bearer(provider))
        .send({ bio: '15 yıllık tecrübe', yearsOfExperience: 15 })
        .expect(200);
      expect(res.body).toMatchObject({ bio: '15 yıllık tecrübe', yearsOfExperience: 15 });
    });
  });
});
