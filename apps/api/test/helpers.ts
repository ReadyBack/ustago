import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import type { AdminPermission, AuthResponse, AuthTokens, OtpVerifyResponse } from '@ustago/types';
import { authResponseSchema, otpVerifyResponseSchema } from '@ustago/validation';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { API_ENV, type ApiEnv, loadApiEnv } from '../src/config/env.js';
import type { Prisma, Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ensureDevFeePolicy } from '../src/seed/seed-finance.js';
import { seedReferenceData } from '../src/seed/seed-reference.js';
import { FakeSmsProvider } from '../src/sms/fake-sms.provider.js';
import { SMS_PROVIDER } from '../src/sms/sms-provider.js';

/**
 * E2E helpers. Tests run against the real PostgreSQL and Redis from
 * docker-compose (or CI service containers) after `prisma migrate deploy`.
 * Every test user gets a unique `e2e-<run>-...@ustago.test` address and is
 * deleted afterwards, so the suite never touches seeded development data.
 */
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const RUN_ID = randomUUID().slice(0, 8);
export const PASSWORD = 'e2e-test-password-123';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(
  envOverrides: Record<string, string> = {},
): Promise<TestContext> {
  const env = loadApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    // A generous limit so the suite is not throttled; one suite lowers it.
    AUTH_RATE_LIMIT_MAX: '1000',
    API_SWAGGER_ENABLED: 'false',
    JWT_ACCESS_SECRET: process.env['JWT_ACCESS_SECRET'] ?? 'e2e-only-secret-0123456789abcdefghij',
    // Codes stay in memory and are read through the container, never HTTP.
    SMS_PROVIDER: 'fake',
    OTP_RESEND_COOLDOWN_SECONDS: '0',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'ustago-e2e-storage-')),
    ...envOverrides,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error'], rawBody: true });
  setupApp(app, app.get<ApiEnv>(API_ENV));
  await app.init();
  const prisma = app.get(PrismaService);
  await seedReferenceData(prisma);
  await ensureDevFeePolicy(prisma);
  return { app, prisma, http: () => request(app.getHttpServer()) };
}

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `e2e-${RUN_ID}-${label}-${counter}@ustago.test`;
}

const phones = new Set<string>();

/** A random Turkish mobile number in E.164 form, removed again by cleanup(). */
export function uniquePhone(): string {
  const phone = `+90532${String(randomInt(0, 1e7)).padStart(7, '0')}`;
  phones.add(phone);
  return phone;
}

/** The in-memory SMS outbox of the app under test. */
export function fakeSms(ctx: TestContext): FakeSmsProvider {
  const sms = ctx.app.get<unknown>(SMS_PROVIDER);
  if (!(sms instanceof FakeSmsProvider)) throw new Error('E2E tests need SMS_PROVIDER=fake');
  return sms;
}

/** Deletes rate-limit counters so suites sharing one IP do not throttle each other. */
export async function resetRateLimits(ctx: TestContext, pattern = 'rl:*'): Promise<void> {
  const redis = await ctx.app.get(RedisService).connected();
  const keys = await redis.keys(pattern);
  if (keys.length > 0) await redis.del(...keys);
}

export async function requestOtp(
  ctx: TestContext,
  phone: string,
  options: { purpose?: 'REGISTER_OR_LOGIN' | 'VERIFY_PHONE'; auth?: string } = {},
): Promise<string> {
  const req = ctx.http().post('/api/v1/auth/otp/request');
  if (options.auth) req.set('Authorization', options.auth);
  await req.send({ phone, purpose: options.purpose ?? 'REGISTER_OR_LOGIN' }).expect(202);
  const code = fakeSms(ctx).lastCodeFor(phone);
  if (!code) throw new Error('No OTP was sent');
  return code;
}

/** Signs in (or signs up) with phone + OTP and returns the tokens. */
export async function phoneLogin(
  ctx: TestContext,
  phone = uniquePhone(),
  profile: { firstName?: string; lastName?: string } = {},
): Promise<OtpVerifyResponse & { tokens: AuthTokens }> {
  const code = await requestOtp(ctx, phone);
  const res = await ctx
    .http()
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code, purpose: 'REGISTER_OR_LOGIN', ...profile })
    .expect(200);
  const body = otpVerifyResponseSchema.parse(res.body);
  if (!body.tokens) throw new Error('REGISTER_OR_LOGIN must return tokens');
  return { ...body, tokens: body.tokens };
}

export async function registerUser(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<AuthResponse> {
  const res = await ctx
    .http()
    .post('/api/v1/auth/register')
    .send({
      email: uniqueEmail('user'),
      password: PASSWORD,
      firstName: 'Test',
      lastName: 'Kullanıcı',
      ...overrides,
    })
    .expect(201);
  return authResponseSchema.parse(res.body);
}

/**
 * Faz 6 default for a plain ADMIN in tests: every day-to-day permission
 * (support, verification, finance), not ADMIN_SUPER. Suites that test the
 * permission split pass their own list.
 */
export const DEFAULT_ADMIN_PERMISSIONS: AdminPermission[] = [
  'ADMIN_SUPPORT',
  'ADMIN_VERIFICATION',
  'ADMIN_FINANCE',
];

/** Staff accounts cannot sign up; tests create them directly in the database. */
export async function createStaffUser(
  ctx: TestContext,
  roles: Role[],
  permissions: AdminPermission[] = roles.includes('ADMIN') ? DEFAULT_ADMIN_PERMISSIONS : [],
): Promise<AuthResponse> {
  const email = uniqueEmail(roles.join('-').toLowerCase());
  await ctx.prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, { algorithm: 2 }),
      firstName: 'Test',
      lastName: 'Yönetici',
      roles: { create: ['CUSTOMER' as Role, ...roles].map((role) => ({ role })) },
      customerProfile: { create: {} },
      adminPermissions: { create: permissions.map((permission) => ({ permission })) },
    },
  });
  return login(ctx, email);
}

export async function login(
  ctx: TestContext,
  email: string,
  password = PASSWORD,
): Promise<AuthResponse> {
  const res = await ctx.http().post('/api/v1/auth/login').send({ email, password }).expect(200);
  return authResponseSchema.parse(res.body);
}

export const bearer = (auth: { tokens: AuthTokens }) => `Bearer ${auth.tokens.accessToken}`;

/** Removes every user this run created (sessions, roles, profiles cascade). */
export async function cleanup(ctx: TestContext): Promise<void> {
  const users = await ctx.prisma.user.findMany({
    where: {
      OR: [{ email: { startsWith: `e2e-${RUN_ID}-` } }, { phone: { in: [...phones] } }],
    },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  // Marketplace rows reference users through restrict-on-delete keys:
  // jobs → quotes (revisions cascade) → requests (photos, dispatch cascade).
  const requestWhere = {
    OR: [
      { customer: { userId: { in: ids } } },
      { quotes: { some: { provider: { userId: { in: ids } } } } },
    ],
  };
  const jobWhere = {
    OR: [
      { customer: { userId: { in: ids } } },
      { provider: { userId: { in: ids } } },
      { serviceRequest: requestWhere },
    ],
  };
  // Faz 4 rows that restrict deleting a job or a user (change orders and
  // status history cascade with the job).
  await ctx.prisma.disciplinaryAction.deleteMany({
    where: { OR: [{ subjectId: { in: ids } }, { decidedById: { in: ids } }] },
  });
  await purgeFinance(ctx, jobWhere, ids);
  await ctx.prisma.review.deleteMany({ where: { job: jobWhere } });
  await ctx.prisma.dispute.deleteMany({ where: { job: jobWhere } });
  await ctx.prisma.job.deleteMany({ where: jobWhere });
  await ctx.prisma.quote.updateMany({
    where: { OR: [{ provider: { userId: { in: ids } } }, { serviceRequest: requestWhere }] },
    data: { acceptedRevisionId: null, acceptedAt: null, status: 'EXPIRED' },
  });
  await ctx.prisma.quote.deleteMany({
    where: { OR: [{ provider: { userId: { in: ids } } }, { serviceRequest: requestWhere }] },
  });
  await ctx.prisma.serviceRequest.deleteMany({ where: requestWhere });
  await ctx.prisma.otpChallenge.deleteMany({
    where: { OR: [{ phone: { in: [...phones] } }, { userId: { in: ids } }] },
  });
  await ctx.prisma.device.deleteMany({ where: { userId: { in: ids } } });
  await ctx.prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: ids } } });
  await ctx.prisma.riskSignal.deleteMany({ where: { subjectUserId: { in: ids } } });
  // Audit logs and verification timelines are append-only (Faz 6 trigger);
  // test fixtures may delete them only with the purge flag set.
  await ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ustago.audit_test_purge = 'on'`);
    await tx.$executeRawUnsafe(`SET LOCAL ustago.ledger_test_purge = 'on'`);
    const providerIds = (
      await tx.providerProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } })
    ).map((p) => p.id);
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: ids } },
          { entityId: { in: [...ids, ...providerIds] } },
        ],
      },
    });
    await tx.providerVerificationEvent.deleteMany({ where: { providerId: { in: providerIds } } });
    // Rows that point at both a deleted provider (cascade) and a deleted
    // admin (set null) in one statement: remove them first, or PostgreSQL
    // skips the cascade and reports a foreign key violation.
    await tx.providerVerificationCase.deleteMany({ where: { providerId: { in: providerIds } } });
    await tx.providerSuspension.deleteMany({ where: { providerId: { in: providerIds } } });
    await tx.providerVerification.deleteMany({ where: { providerId: { in: providerIds } } });
    await tx.platformFeePolicy.deleteMany({
      where: { code: { startsWith: `e2e-${RUN_ID}` }, jobs: { none: {} } },
    });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
  // Sub-categories first: parents are delete-restricted.
  await ctx.prisma.serviceCategory.deleteMany({
    where: { slug: { startsWith: `e2e-${RUN_ID}` }, parentId: { not: null } },
  });
  await ctx.prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: `e2e-${RUN_ID}` } } });
}

/**
 * Faz 5 rows of the run's jobs and providers. The ledger is append-only
 * (DB trigger); tests may delete only inside a transaction that sets the
 * `ustago.ledger_test_purge` flag.
 */
async function purgeFinance(
  ctx: TestContext,
  jobWhere: Prisma.JobWhereInput,
  userIds: string[],
): Promise<void> {
  const jobs = await ctx.prisma.job.findMany({ where: jobWhere, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  const providers = await ctx.prisma.providerProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const providerIds = providers.map((p) => p.id);
  if (jobIds.length === 0 && providerIds.length === 0) return;
  await ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ustago.ledger_test_purge = 'on'`);
    const txWhere: Prisma.LedgerTransactionWhereInput = {
      OR: [{ jobId: { in: jobIds } }, { providerId: { in: providerIds } }],
    };
    const ledgerTx = await tx.ledgerTransaction.findMany({ where: txWhere, select: { id: true } });
    const txIds = ledgerTx.map((t) => t.id);
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: txIds } } });
    // Reversals point at the transaction they reverse.
    await tx.ledgerTransaction.deleteMany({
      where: { id: { in: txIds }, reversesId: { not: null } },
    });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: txIds } } });
    await tx.ledgerEntry.deleteMany({
      where: { account: { providerId: { in: providerIds } } },
    });
    await tx.ledgerAccount.deleteMany({ where: { providerId: { in: providerIds } } });
    await tx.refund.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.providerEarning.deleteMany({
      where: { OR: [{ jobId: { in: jobIds } }, { providerId: { in: providerIds } }] },
    });
    await tx.paymentTransaction.deleteMany({ where: { payment: { jobId: { in: jobIds } } } });
    await tx.payment.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.cashSettlement.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.payout.deleteMany({ where: { providerId: { in: providerIds } } });
    await tx.payoutDestination.deleteMany({ where: { providerId: { in: providerIds } } });
  });
}
