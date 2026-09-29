import { apiErrorResponseSchema, authTokensSchema, currentUserSchema } from '@ustago/validation';

import {
  bearer,
  cleanup,
  createTestApp,
  login,
  PASSWORD,
  registerUser,
  type TestContext,
  uniqueEmail,
  uniquePhone,
} from './helpers.js';

describe('Auth (e2e, real PostgreSQL + Redis)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  describe('POST /auth/register', () => {
    it('creates a customer, hashes the password and signs in', async () => {
      const email = uniqueEmail('register');
      const phone = uniquePhone();
      const auth = await registerUser(ctx, {
        email: email.toUpperCase(),
        phone: `0${phone.slice(3)}`,
      });
      expect(auth.user.phone).toBe(phone);

      expect(auth.user.email).toBe(email);
      expect(auth.user.roles).toEqual(['CUSTOMER']);
      expect(auth.user.customerProfile).not.toBeNull();
      expect(auth.user.providerProfile).toBeNull();
      expect(auth.tokens.tokenType).toBe('Bearer');
      expect(JSON.stringify(auth)).not.toContain(PASSWORD);

      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      expect(row.passwordHash).not.toContain(PASSWORD);

      const stored = await ctx.prisma.refreshToken.findMany({
        where: { session: { userId: row.id } },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.tokenHash).not.toBe(auth.tokens.refreshToken);
    });

    it('creates a provider account with both roles and a DRAFT profile', async () => {
      const auth = await registerUser(ctx, { accountType: 'PROVIDER' });
      expect(auth.user.roles).toEqual(['CUSTOMER', 'PROVIDER']);
      expect(auth.user.providerProfile).toMatchObject({
        status: 'DRAFT',
        displayName: 'Test Kullanıcı',
      });
    });

    it('rejects a duplicate e-mail with 409 EMAIL_TAKEN', async () => {
      const email = uniqueEmail('dup');
      await registerUser(ctx, { email });
      const res = await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, firstName: 'A', lastName: 'B' })
        .expect(409);
      expect(apiErrorResponseSchema.parse(res.body).code).toBe('EMAIL_TAKEN');
    });

    it('validates input and returns field details', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'short', firstName: '', lastName: 'B' })
        .expect(400);
      const body = apiErrorResponseSchema.parse(res.body);
      expect(body.code).toBe('VALIDATION_FAILED');
      const paths = (body.details as { path: string }[]).map((d) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['email', 'password', 'firstName']));
    });

    it('cannot self-assign staff roles', async () => {
      const base = {
        email: uniqueEmail('evil'),
        password: PASSWORD,
        firstName: 'A',
        lastName: 'B',
      };
      await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({ ...base, accountType: 'ADMIN' })
        .expect(400);
      await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({ ...base, roles: ['SUPER_ADMIN'] })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('signs in with the right password', async () => {
      const email = uniqueEmail('login');
      await registerUser(ctx, { email });
      const auth = await login(ctx, email);
      expect(auth.user.email).toBe(email);
      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.lastLoginAt).not.toBeNull();
    });

    it('gives the same 401 for a wrong password and an unknown e-mail', async () => {
      const email = uniqueEmail('login-wrong');
      await registerUser(ctx, { email });
      const wrong = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'yanlis-sifre-000' })
        .expect(401);
      const unknown = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('nobody'), password: PASSWORD })
        .expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('records failed attempts in the audit log', async () => {
      const email = uniqueEmail('audit');
      const auth = await registerUser(ctx, { email });
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'yanlis-sifre-000' })
        .expect(401);
      const entries = await ctx.prisma.auditLog.findMany({
        where: { actorId: auth.user.id, action: 'auth.login_failed' },
      });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain('yanlis-sifre');
    });
  });

  describe('GET /me', () => {
    it('returns the current user', async () => {
      const auth = await registerUser(ctx);
      const res = await ctx.http().get('/api/v1/me').set('Authorization', bearer(auth)).expect(200);
      const me = currentUserSchema.parse(res.body);
      expect(me.id).toBe(auth.user.id);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('requires a token', async () => {
      const res = await ctx.http().get('/api/v1/me').expect(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('rejects a forged token', async () => {
      const res = await ctx
        .http()
        .get('/api/v1/me')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad')
        .expect(401);
      expect(res.body.code).toBe('ACCESS_TOKEN_INVALID');
    });

    it('updates the profile with PATCH /me', async () => {
      const auth = await registerUser(ctx);
      const res = await ctx
        .http()
        .patch('/api/v1/me')
        .set('Authorization', bearer(auth))
        .send({ firstName: 'Yeni' })
        .expect(200);
      expect(res.body.firstName).toBe('Yeni');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and issues a working access token', async () => {
      const auth = await registerUser(ctx);
      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(200);
      const tokens = authTokensSchema.parse(res.body);
      expect(tokens.refreshToken).not.toBe(auth.tokens.refreshToken);
      await ctx
        .http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);
    });

    it('detects reuse of a consumed token and revokes the whole session', async () => {
      const auth = await registerUser(ctx);
      const first = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(200);
      const rotated = authTokensSchema.parse(first.body);

      // An attacker replays the old token.
      const replay = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimate client's newer tokens are now dead too.
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.refreshToken })
        .expect(401);
      const me = await ctx
        .http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${rotated.accessToken}`)
        .expect(401);
      expect(me.body.code).toBe('SESSION_REVOKED');
    });

    it('lets only one of two concurrent refreshes win', async () => {
      const auth = await registerUser(ctx);
      const results = await Promise.all(
        [0, 1].map(() =>
          ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: auth.tokens.refreshToken }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('rejects an unknown token', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'x'.repeat(43) })
        .expect(401);
      expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('rejects an expired refresh token', async () => {
      const auth = await registerUser(ctx);
      await ctx.prisma.refreshToken.updateMany({
        where: { session: { userId: auth.user.id } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('POST /auth/logout ends this session immediately', async () => {
      const auth = await registerUser(ctx);
      await ctx.http().post('/api/v1/auth/logout').set('Authorization', bearer(auth)).expect(204);
      await ctx.http().get('/api/v1/me').set('Authorization', bearer(auth)).expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(401);
    });

    it('POST /auth/logout-all ends every session of the user', async () => {
      const email = uniqueEmail('logout-all');
      const first = await registerUser(ctx, { email });
      const second = await login(ctx, email);
      await ctx
        .http()
        .post('/api/v1/auth/logout-all')
        .set('Authorization', bearer(second))
        .expect(204);
      await ctx.http().get('/api/v1/me').set('Authorization', bearer(first)).expect(401);
      await ctx.http().get('/api/v1/me').set('Authorization', bearer(second)).expect(401);
    });
  });

  describe('devices', () => {
    it('registers a push token and links it to the session', async () => {
      const auth = await registerUser(ctx);
      const pushToken = `ExponentPushToken[e2e-${auth.user.id}]`;
      const res = await ctx
        .http()
        .post('/api/v1/me/devices')
        .set('Authorization', bearer(auth))
        .send({ platform: 'ANDROID', pushProvider: 'EXPO', pushToken, appVersion: '1.0.0' })
        .expect(201);
      expect(res.body).not.toHaveProperty('pushToken');
      const sessions = await ctx.prisma.authSession.findMany({ where: { userId: auth.user.id } });
      expect(sessions[0]?.deviceId).toBe(res.body.id);

      // The same install signs in as another user: the token moves.
      const other = await registerUser(ctx);
      await ctx
        .http()
        .post('/api/v1/me/devices')
        .set('Authorization', bearer(other))
        .send({ platform: 'ANDROID', pushProvider: 'EXPO', pushToken })
        .expect(201);
      const device = await ctx.prisma.device.findUniqueOrThrow({ where: { pushToken } });
      expect(device.userId).toBe(other.user.id);

      await ctx
        .http()
        .delete(`/api/v1/me/devices/${device.id}`)
        .set('Authorization', bearer(auth))
        .expect(404);
      await ctx
        .http()
        .delete(`/api/v1/me/devices/${device.id}`)
        .set('Authorization', bearer(other))
        .expect(204);
    });
  });
});
