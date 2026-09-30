/**
 * Faz 7 local benchmark: matching, opportunities, discovery and chat with
 * 100 and 1000 synthetic providers and a 1000-message conversation, plus
 * EXPLAIN ANALYZE of the matching query.
 *
 *   DATABASE_URL=postgresql://.../ustago_bench REDIS_URL=redis://localhost:6379/9 \
 *     node --import ./scripts/register-swc.mjs scripts/bench-faz7.ts [--out file.md]
 *
 * It writes synthetic rows, so it refuses to run unless the database name
 * contains "bench". Run it on a freshly migrated + seeded database. Numbers
 * are from one local machine: they show the order of magnitude and the query
 * plans, not production capacity.
 */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';

import { AppModule } from '../src/app.module.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import { ChatMessagesService } from '../src/conversations/chat-messages.service.js';
import { DiscoveryService } from '../src/discovery/discovery.service.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { MatchingRepository } from '../src/matching/matching.repository.js';
import { ProviderMatchingService } from '../src/matching/provider-matching.service.js';

// Local secrets from the root .env; DATABASE_URL/REDIS_URL given on the command line win.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const url = process.env['DATABASE_URL'] ?? '';
if (!/\/[^/?]*bench[^/?]*(\?|$)/.test(url)) {
  throw new Error(
    'Refusing to run: DATABASE_URL must point at a database whose name contains "bench".',
  );
}
const outIndex = process.argv.indexOf('--out');
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
const RUNS = 20;
const ADANA = 1;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const lines: string[] = [];
const log = (s = '') => {
  lines.push(s);
  console.warn(s);
};

async function time<T>(
  fn: () => Promise<T>,
  runs = RUNS,
): Promise<{ p50: number; p95: number; last: T }> {
  const samples: number[] = [];
  let last!: T;
  await fn(); // warm-up
  for (let i = 0; i < runs; i += 1) {
    const t = process.hrtime.bigint();
    last = await fn();
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), last };
}
const ms = (n: number) => `${n.toFixed(1)} ms`;

function pick<T>(items: T[], i: number): T {
  const item = items[i % items.length];
  if (item === undefined) throw new Error('empty list');
  return item;
}

/** Creates `count` listed providers spread over Adana's districts. */
async function addProviders(count: number, categoryId: string, tag: string): Promise<void> {
  const districts = await prisma.district.findMany({
    where: { provinceId: ADANA, latitude: { not: null } },
    select: { id: true, latitude: true, longitude: true },
  });
  const users = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    email: `bench-${tag}-${i}@bench.test`,
    firstName: 'Bench',
    lastName: `${tag}${i}`,
    emailVerifiedAt: new Date(),
  }));
  await prisma.user.createMany({ data: users });
  await prisma.userRole.createMany({
    data: users.map((u) => ({ userId: u.id, role: 'PROVIDER' as const })),
  });
  const profiles = users.map((u, i) => {
    const d = pick(districts, i);
    return {
      id: randomUUID(),
      userId: u.id,
      displayName: `Bench Usta ${tag}${i}`,
      status: 'ACTIVE' as const,
      approvedAt: new Date(),
      submittedAt: new Date(),
      serviceCenterDistrictId: d.id,
      maxTravelKm: i % 3 === 0 ? 30 : null,
      lastActiveAt: new Date(Date.now() - (i % 40) * 86_400_000),
      district: d,
    };
  });
  await prisma.providerProfile.createMany({
    data: profiles.map(({ district: _d, ...p }) => p),
  });
  await prisma.providerService.createMany({
    data: profiles.map((p) => ({ providerId: p.id, categoryId })),
  });
  await prisma.providerServiceArea.createMany({
    data: profiles.flatMap((p, i) => [
      { providerId: p.id, districtId: p.district.id },
      { providerId: p.id, districtId: pick(districts, i + 1).id },
    ]),
    skipDuplicates: true,
  });
  // Every fifth provider covers the whole province, every seventh a 25 km radius.
  await prisma.providerServiceRegion.createMany({
    data: profiles.flatMap((p, i) =>
      i % 5 === 0
        ? [{ providerId: p.id, kind: 'PROVINCE' as const, provinceId: ADANA }]
        : i % 7 === 0
          ? [
              {
                providerId: p.id,
                kind: 'RADIUS' as const,
                provinceId: ADANA,
                centerDistrictId: p.district.id,
                radiusKm: 25,
                centerLat: p.district.latitude,
                centerLng: p.district.longitude,
              },
            ]
          : [],
    ),
  });
  await prisma.providerWeeklyHours.createMany({
    data: profiles
      .filter((_, i) => i % 2 === 0)
      .flatMap((p) =>
        [1, 2, 3, 4, 5, 6].map((weekday) => ({
          providerId: p.id,
          weekday,
          startMinute: 480,
          endMinute: 1140,
        })),
      ),
  });
}

/** Runs the query `fn` would send through $queryRaw with EXPLAIN ANALYZE in front. */
async function explain(fn: (db: Prisma.TransactionClient) => Promise<unknown>): Promise<string> {
  let plan = '';
  const proxy = new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === '$queryRaw') {
        return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const q = Prisma.sql(strings, ...values);
          const rows = await target.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
            `EXPLAIN (ANALYZE, BUFFERS) ${q.text}`,
            ...q.values,
          );
          plan = rows.map((r) => r['QUERY PLAN']).join('\n');
          return [];
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as unknown as Prisma.TransactionClient;
  await fn(proxy);
  return plan;
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const matching = app.get(ProviderMatchingService);
  const repo = app.get(MatchingRepository);
  const discovery = app.get(DiscoveryService);
  const chat = app.get(ChatMessagesService);

  const category = await prisma.serviceCategory.findUniqueOrThrow({ where: { slug: 'klima' } });
  await prisma.province.update({ where: { id: ADANA }, data: { isActive: true } });
  const seyhan = await prisma.district.findUniqueOrThrow({
    where: { provinceId_slug: { provinceId: ADANA, slug: 'seyhan' } },
  });

  // One customer with a published request in Seyhan (inserted directly: no dispatch).
  const customerUser = await prisma.user.create({
    data: {
      email: `bench-customer-${randomUUID()}@bench.test`,
      firstName: 'Bench',
      lastName: 'Customer',
      roles: { create: [{ role: 'CUSTOMER' }] },
      customerProfile: { create: {} },
    },
    include: { customerProfile: true },
  });
  const address = await prisma.address.create({
    data: {
      userId: customerUser.id,
      label: 'Bench',
      provinceId: ADANA,
      districtId: seyhan.id,
      neighborhood: 'Bench',
      addressLine: 'Bench 1',
    },
  });
  const customerProfileId = customerUser.customerProfile?.id ?? '';
  const request = await prisma.serviceRequest.create({
    data: {
      customerId: customerProfileId,
      categoryId: category.id,
      addressId: address.id,
      provinceId: ADANA,
      districtId: seyhan.id,
      type: 'QUOTE',
      status: 'PUBLISHED',
      title: 'Bench klima bakımı',
      description: 'Benchmark talebi, gerçek değildir.',
      publishedAt: new Date(),
      approxLatitude: seyhan.latitude,
      approxLongitude: seyhan.longitude,
    },
  });

  log('# Faz 7 benchmark');
  log('');
  log(
    `Tarih: ${new Date().toISOString()} · Node ${process.versions.node} · ${RUNS} ölçüm (p50/p95), ısınma turu hariç.`,
  );
  log('');
  log('| Sağlayıcı | Aday (uygun) | rank() p50 | rank() p95 | opportunities p50 | discovery p50 |');
  log('|---|---|---|---|---|---|');

  let explainPlan = '';
  let firstProviderId = '';
  for (const [target, tag] of [
    [100, 'a'],
    [1000, 'b'],
  ] as const) {
    const existing = await prisma.providerProfile.count({
      where: { user: { email: { endsWith: '@bench.test' } } },
    });
    await addProviders(target - existing, category.id, tag);
    await prisma.$executeRawUnsafe('ANALYZE');
    const rank = await time(() => matching.rank(request.id));
    firstProviderId ||= (
      await prisma.providerProfile.findFirstOrThrow({
        where: { user: { email: { endsWith: '@bench.test' } } },
        select: { id: true },
      })
    ).id;
    const opp = await time(() =>
      repo.opportunities(firstProviderId, { sort: 'NEAREST', limit: 20 }),
    );
    const disc = await time(() =>
      discovery.listProviders(undefined, {
        categoryId: category.id,
        districtId: seyhan.id,
        sort: 'RECOMMENDED',
        verifiedOnly: false,
        availableToday: false,
        limit: 20,
      }),
    );
    log(
      `| ${target} | ${rank.last.length} | ${ms(rank.p50)} | ${ms(rank.p95)} | ${ms(opp.p50)} | ${ms(disc.p50)} |`,
    );
    if (target === 1000)
      explainPlan = await explain((db) => repo.candidates(db, request.id, { limit: 2000 }));
  }

  // Chat: one conversation with 1000 messages.
  const providerProfile = await prisma.providerProfile.findUniqueOrThrow({
    where: { id: firstProviderId },
  });
  const conversation = await prisma.conversation.create({
    data: {
      serviceRequestId: request.id,
      providerId: providerProfile.id,
      customerId: customerProfileId,
      participants: {
        create: [
          { userId: customerUser.id, role: 'CUSTOMER' },
          { userId: providerProfile.userId, role: 'PROVIDER' },
        ],
      },
    },
  });
  await prisma.message.createMany({
    data: Array.from({ length: 1000 }, (_, i) => ({
      conversationId: conversation.id,
      senderId: i % 2 === 0 ? customerUser.id : providerProfile.userId,
      type: 'TEXT' as const,
      body: `Bench mesajı ${i}`,
      clientMessageId: randomUUID(),
    })),
  });
  await prisma.$executeRawUnsafe('ANALYZE');
  const customer: AuthUser = {
    id: customerUser.id,
    sessionId: 'bench',
    roles: ['CUSTOMER'],
    permissions: [],
  };
  const latest = await time(() => chat.list(customer, conversation.id, { limit: 50 }));
  const middle = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { id: 'asc' },
    skip: 500,
    take: 1,
  });
  const older = await time(() =>
    chat.list(customer, conversation.id, { limit: 50, before: middle[0]?.id }),
  );
  const last = await prisma.message.findFirstOrThrow({
    where: { conversationId: conversation.id },
    orderBy: { id: 'desc' },
  });
  const poll = await time(() =>
    chat.list(customer, conversation.id, { limit: 50, after: last.id }),
  );
  log('');
  log('| Sohbet (1000 mesaj) | p50 | p95 |');
  log('|---|---|---|');
  log(`| Son 50 mesaj | ${ms(latest.p50)} | ${ms(latest.p95)} |`);
  log(`| Ortadan eski sayfa (before) | ${ms(older.p50)} | ${ms(older.p95)} |`);
  log(`| Yoklama, yeni mesaj yok (after) | ${ms(poll.p50)} | ${ms(poll.p95)} |`);
  log('');
  log('## EXPLAIN (ANALYZE, BUFFERS): eşleştirme aday sorgusu, 1000 usta');
  log('');
  log('```');
  log(explainPlan);
  log('```');
} finally {
  await app.close();
  await prisma.$disconnect();
}
if (outFile) writeFileSync(outFile, `${lines.join('\n')}\n`);
