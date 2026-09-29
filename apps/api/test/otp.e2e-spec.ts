import { authTokensSchema, otpRequestResponseSchema } from '@ustago/validation';

import {
  bearer,
  cleanup,
  createTestApp,
  fakeSms,
  phoneLogin,
  registerUser,
  requestOtp,
  resetRateLimits,
  type TestContext,
  uniquePhone,
} from './helpers.js';

const OTP_REQUEST = '/api/v1/auth/otp/request';
const OTP_VERIFY = '/api/v1/auth/otp/verify';

/** A code of the right length that is not `code`. */
const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe('Phone + OTP auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx, 'rl:otp:*');
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  const verify = (body: Record<string, unknown>, auth?: string) => {
    const req = ctx.http().post(OTP_VERIFY);
    if (auth) req.set('Authorization', auth);
    return req.send({ purpose: 'REGISTER_OR_LOGIN', ...body });
  };

  describe('request', () => {
    it('normalises the number and never returns the code', async () => {
      const phone = uniquePhone();
      const res = await ctx
        .http()
        .post(OTP_REQUEST)
        .send({ phone: `0 ${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` })
        .expect(202);
      const body = otpRequestResponseSchema.parse(res.body);
      expect(body.phone).toBe(phone);
      expect(body.purpose).toBe('REGISTER_OR_LOGIN');
      expect(body.codeLength).toBe(6);

      const code = fakeSms(ctx).lastCodeFor(phone);
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(res.body)).not.toContain(code);
      expect(res.headers['x-otp-code']).toBeUndefined();
    });

    it('stores only a keyed hash of the code', async () => {
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone);
      const row = await ctx.prisma.otpChallenge.findFirstOrThrow({ where: { phone } });
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.codeHash).not.toContain(code);
      expect(JSON.stringify(row)).not.toContain(`"${code}"`);
      expect(row.maxAttempts).toBe(5);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(180_000, -3);
    });

    it.each([
      ['a landline', '+902121234567'],
      ['a short number', '+90532123'],
      ['letters', 'telefon'],
      ['an unsupported country', '+14155552671'],
    ])('rejects %s', async (_label, phone) => {
      const res = await ctx.http().post(OTP_REQUEST).send({ phone }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('requires a signed-in user for VERIFY_PHONE', async () => {
      const res = await ctx
        .http()
        .post(OTP_REQUEST)
        .send({ phone: uniquePhone(), purpose: 'VERIFY_PHONE' })
        .expect(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('rejects an invalid bearer token instead of treating the caller as anonymous', async () => {
      await ctx
        .http()
        .post(OTP_REQUEST)
        .set('Authorization', 'Bearer not-a-token')
        .send({ phone: uniquePhone() })
        .expect(401);
    });

    it('invalidates the challenge and answers 503 when the SMS cannot be sent', async () => {
      const phone = uniquePhone();
      fakeSms(ctx).failNext = 1;
      const res = await ctx.http().post(OTP_REQUEST).send({ phone }).expect(503);
      expect(res.body.code).toBe('SMS_UNAVAILABLE');
      const open = await ctx.prisma.otpChallenge.count({
        where: { phone, invalidatedAt: null, consumedAt: null },
      });
      expect(open).toBe(0);
    });
  });

  describe('verify: sign up and sign in', () => {
    it('creates a CUSTOMER with a verified phone on first use, then signs the same user in', async () => {
      const phone = uniquePhone();
      const first = await phoneLogin(ctx, phone, { firstName: 'Ayşe', lastName: 'Yılmaz' });
      expect(first.isNewUser).toBe(true);
      expect(first.user.roles).toEqual(['CUSTOMER']);
      expect(first.user.phone).toBe(phone);
      expect(first.user.phoneVerifiedAt).not.toBeNull();
      expect(first.user.email).toBeNull();
      expect(first.user.firstName).toBe('Ayşe');
      expect(first.user.customerProfile).not.toBeNull();
      authTokensSchema.parse(first.tokens);

      const second = await phoneLogin(ctx, phone);
      expect(second.isNewUser).toBe(false);
      expect(second.user.id).toBe(first.user.id);

      // Phone sign-in shares the regular session machinery.
      const refreshed = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.tokens.refreshToken })
        .expect(200);
      authTokensSchema.parse(refreshed.body);
      await ctx
        .http()
        .post('/api/v1/auth/logout-all')
        .set('Authorization', bearer(second))
        .expect(204);
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshed.body.refreshToken })
        .expect(401);
    });

    it('signs in an e-mail account that verified its phone earlier', async () => {
      const phone = uniquePhone();
      const account = await registerUser(ctx);
      const code = await requestOtp(ctx, phone, { purpose: 'VERIFY_PHONE', auth: bearer(account) });
      const verified = await verify(
        { phone, code, purpose: 'VERIFY_PHONE' },
        bearer(account),
      ).expect(200);
      expect(verified.body.tokens).toBeNull();
      expect(verified.body.user.phoneVerifiedAt).not.toBeNull();

      const login = await phoneLogin(ctx, phone);
      expect(login.isNewUser).toBe(false);
      expect(login.user.id).toBe(account.user.id);
    });

    it('never signs into an account that only claimed the number without verifying it', async () => {
      const phone = uniquePhone();
      const claimant = await registerUser(ctx, { phone });
      expect(claimant.user.phoneVerifiedAt).toBeNull();

      const owner = await phoneLogin(ctx, phone);
      expect(owner.isNewUser).toBe(true);
      expect(owner.user.id).not.toBe(claimant.user.id);

      const released = await ctx.prisma.user.findUniqueOrThrow({ where: { id: claimant.user.id } });
      expect(released.phone).toBeNull();
    });

    it('refuses suspended accounts', async () => {
      const phone = uniquePhone();
      const user = await phoneLogin(ctx, phone);
      await ctx.prisma.user.update({ where: { id: user.user.id }, data: { status: 'SUSPENDED' } });
      const code = await requestOtp(ctx, phone);
      const res = await verify({ phone, code }).expect(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('creates exactly one account when the same number signs up twice in parallel', async () => {
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone);
      const results = await Promise.all([verify({ phone, code }), verify({ phone, code })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(await ctx.prisma.user.count({ where: { phone } })).toBe(1);
    });
  });

  describe('verify: code security', () => {
    it('counts wrong attempts, then locks the challenge', async () => {
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone);
      for (let remaining = 4; remaining >= 1; remaining -= 1) {
        const res = await verify({ phone, code: wrongCode(code) }).expect(400);
        expect(res.body.code).toBe('OTP_INVALID');
        expect(res.body.details.attemptsRemaining).toBe(remaining);
      }
      const locked = await verify({ phone, code: wrongCode(code) }).expect(429);
      expect(locked.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

      // Even the right code is useless now.
      const after = await verify({ phone, code }).expect(400);
      expect(after.body.code).toBe('OTP_INVALID');
    });

    it('never counts more than maxAttempts under parallel guessing', async () => {
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone);
      await Promise.all(Array.from({ length: 12 }, () => verify({ phone, code: wrongCode(code) })));
      const row = await ctx.prisma.otpChallenge.findFirstOrThrow({ where: { phone } });
      expect(row.attempts).toBeLessThanOrEqual(5);
      expect(row.invalidatedAt).not.toBeNull();
    });

    it('cannot be replayed', async () => {
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone);
      await verify({ phone, code }).expect(200);
      const replay = await verify({ phone, code }).expect(400);
      expect(replay.body.code).toBe('OTP_INVALID');
    });

    it('expires', async () => {
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone);
      await ctx.prisma.otpChallenge.updateMany({
        where: { phone },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await verify({ phone, code }).expect(400);
      expect(res.body.code).toBe('OTP_EXPIRED');
    });

    it('invalidates the previous code when a new one is requested', async () => {
      const phone = uniquePhone();
      const oldCode = await requestOtp(ctx, phone);
      const newCode = await requestOtp(ctx, phone);
      if (oldCode !== newCode) {
        const res = await verify({ phone, code: oldCode }).expect(400);
        expect(res.body.code).toBe('OTP_INVALID');
      }
      await verify({ phone, code: newCode }).expect(200);
      expect(
        await ctx.prisma.otpChallenge.count({
          where: { phone, consumedAt: null, invalidatedAt: null },
        }),
      ).toBe(0);
    });

    it('does not accept a code issued for another number', async () => {
      const a = uniquePhone();
      const b = uniquePhone();
      const codeA = await requestOtp(ctx, a);
      await requestOtp(ctx, b);
      const res = await verify({ phone: b, code: codeA });
      if (res.status === 200) {
        // 1 in 10^6: the two random codes happened to be equal.
        expect(fakeSms(ctx).lastCodeFor(b)).toBe(codeA);
      } else {
        expect(res.body.code).toBe('OTP_INVALID');
      }
    });

    it('rejects a malformed code without consuming an attempt budget beyond one', async () => {
      const phone = uniquePhone();
      await requestOtp(ctx, phone);
      const res = await verify({ phone, code: '12ab' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      const row = await ctx.prisma.otpChallenge.findFirstOrThrow({ where: { phone } });
      expect(row.attempts).toBe(0);
    });
  });

  describe('VERIFY_PHONE', () => {
    it('attaches a number to the signed-in account without issuing tokens', async () => {
      const account = await registerUser(ctx);
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone, { purpose: 'VERIFY_PHONE', auth: bearer(account) });
      const res = await verify({ phone, code, purpose: 'VERIFY_PHONE' }, bearer(account)).expect(
        200,
      );
      expect(res.body).toMatchObject({ tokens: null, isNewUser: false });
      expect(res.body.user.phone).toBe(phone);
    });

    it('cannot use another account’s challenge', async () => {
      const owner = await registerUser(ctx);
      const attacker = await registerUser(ctx);
      const phone = uniquePhone();
      const code = await requestOtp(ctx, phone, { purpose: 'VERIFY_PHONE', auth: bearer(owner) });
      const res = await verify({ phone, code, purpose: 'VERIFY_PHONE' }, bearer(attacker)).expect(
        400,
      );
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('refuses a number already verified by someone else', async () => {
      const phone = uniquePhone();
      await phoneLogin(ctx, phone);
      const other = await registerUser(ctx);
      const res = await ctx
        .http()
        .post(OTP_REQUEST)
        .set('Authorization', bearer(other))
        .send({ phone, purpose: 'VERIFY_PHONE' })
        .expect(409);
      expect(res.body.code).toBe('PHONE_ALREADY_IN_USE');
    });
  });

  describe('rate limits', () => {
    let limited: TestContext;

    beforeAll(async () => {
      limited = await createTestApp({
        OTP_MAX_REQUESTS_PER_WINDOW: '3',
        OTP_RESEND_COOLDOWN_SECONDS: '30',
      });
    });

    afterAll(async () => {
      await limited.app.close();
    });

    it('enforces the resend cooldown per number', async () => {
      const phone = uniquePhone();
      await limited.http().post(OTP_REQUEST).send({ phone }).expect(202);
      const res = await limited.http().post(OTP_REQUEST).send({ phone }).expect(429);
      expect(res.body.code).toBe('OTP_RATE_LIMITED');
      expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('caps requests per number per window', async () => {
      const phone = uniquePhone();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        // Clear only the cooldown so the window counter is what trips.
        await resetRateLimits(limited, 'rl:otp:cooldown:*');
        statuses.push((await limited.http().post(OTP_REQUEST).send({ phone })).status);
      }
      expect(statuses).toEqual([202, 202, 202, 429]);
    });
  });
});
