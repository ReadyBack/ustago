/**
 * Faz 7 DEMO marketplace data (development only, see main.ts).
 *
 * Gives the local demo something real to show in the new screens:
 * - service centres, max travel, a radius and a whole-province region,
 *   weekly hours, one planned time off and one paused provider;
 * - İzmir on the waitlist (launch status), Ankara open;
 * - two published requests that go through the real dispatch (MATCH_V1),
 *   one quote with a price breakdown and an arrival estimate, and a short
 *   request-bound conversation — all through the API services, so the
 *   rows look exactly like ones the app creates;
 * - one favourite.
 *
 * Idempotent: provider settings are only filled when still empty (a tester's
 * edits survive), and the requests are keyed by fixed idempotency keys.
 */
import type { INestApplicationContext } from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { ChatMessagesService } from '../conversations/chat-messages.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import type { PrismaClient, Role } from '../generated/prisma/client.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { ServiceRequestsService } from '../service-requests/service-requests.service.js';

const ANKARA = 6;
const IZMIR = 35;

interface ProviderSetup {
  email: string;
  provinceId: number;
  centre: string;
  maxTravelKm?: number;
  region?: { kind: 'PROVINCE' } | { kind: 'RADIUS'; centre: string; radiusKm: number };
  /** [weekday 1-7, start "HH:MM", end "HH:MM"]; none = flexible hours. */
  hours?: [number, string, string][];
  timeOffInDays?: [number, number];
  paused?: boolean;
}

const WEEKDAYS_8_19: [number, string, string][] = [1, 2, 3, 4, 5, 6].map((d) => [
  d,
  '08:00',
  '19:00',
]);
const OFFICE_HOURS: [number, string, string][] = [1, 2, 3, 4, 5].map((d) => [d, '09:00', '18:00']);

const SETUPS: ProviderSetup[] = [
  {
    email: 'usta-klima@ustago.test',
    provinceId: 1,
    centre: 'seyhan',
    maxTravelKm: 25,
    region: { kind: 'RADIUS', centre: 'seyhan', radiusKm: 20 },
    hours: WEEKDAYS_8_19,
  },
  {
    email: 'usta-elektrik@ustago.test',
    provinceId: 1,
    centre: 'cukurova',
    region: { kind: 'PROVINCE' },
    hours: OFFICE_HOURS,
  },
  { email: 'usta-tesisat@ustago.test', provinceId: 1, centre: 'cukurova', maxTravelKm: 30 },
  {
    email: 'usta@ustago.test',
    provinceId: 34,
    centre: 'kadikoy',
    maxTravelKm: 20,
    hours: WEEKDAYS_8_19,
  },
  {
    email: 'usta-ankara-elektrik@ustago.test',
    provinceId: ANKARA,
    centre: 'cankaya',
    region: { kind: 'RADIUS', centre: 'cankaya', radiusKm: 30 },
    hours: OFFICE_HOURS,
  },
  {
    email: 'usta-ankara-boya@ustago.test',
    provinceId: ANKARA,
    centre: 'kecioren',
    hours: WEEKDAYS_8_19,
    timeOffInDays: [7, 10],
  },
  { email: 'usta-izmir-klima@ustago.test', provinceId: IZMIR, centre: 'karsiyaka' },
  { email: 'usta-istanbul-klima@ustago.test', provinceId: 34, centre: 'besiktas', paused: true },
];

/** Fixed keys: a second run returns the same requests instead of new ones. */
const KLIMA_REQUEST_KEY = '0192f4c1-7a00-7000-8000-00000000f701';
const ELEKTRIK_REQUEST_KEY = '0192f4c1-7a00-7000-8000-00000000f702';
const CHAT_KEYS = [
  '0192f4c1-7a00-7000-8000-00000000f711',
  '0192f4c1-7a00-7000-8000-00000000f712',
] as const;

export interface DemoMarketplaceResult {
  providersConfigured: number;
  requests: number;
  dispatched: number;
  quotes: number;
  messages: number;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function authUser(prisma: PrismaClient, email: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, roles: { select: { role: true } } },
  });
  if (!user) return null;
  return {
    id: user.id,
    sessionId: 'seed',
    roles: user.roles.map((r) => r.role as Role),
    permissions: [],
  };
}

async function districtId(prisma: PrismaClient, provinceId: number, slug: string) {
  const d = await prisma.district.findUniqueOrThrow({
    where: { provinceId_slug: { provinceId, slug } },
    select: { id: true, latitude: true, longitude: true },
  });
  return d;
}

async function configureProvider(prisma: PrismaClient, s: ProviderSetup): Promise<boolean> {
  const profile = await prisma.providerProfile.findFirst({
    where: { user: { email: s.email } },
    select: { id: true, serviceCenterDistrictId: true },
  });
  // Already configured (or edited by a tester): leave it alone.
  if (!profile || profile.serviceCenterDistrictId) return false;
  const centre = await districtId(prisma, s.provinceId, s.centre);
  await prisma.providerProfile.update({
    where: { id: profile.id },
    data: {
      serviceCenterDistrictId: centre.id,
      maxTravelKm: s.maxTravelKm ?? null,
      ...(s.paused ? { acceptingNewJobs: false, isAvailableNow: false } : {}),
      lastActiveAt: new Date(),
    },
  });
  if (s.region) {
    const regionCentre =
      s.region.kind === 'RADIUS' ? await districtId(prisma, s.provinceId, s.region.centre) : null;
    await prisma.providerServiceRegion.create({
      data: {
        providerId: profile.id,
        kind: s.region.kind,
        provinceId: s.provinceId,
        ...(s.region.kind === 'RADIUS' && regionCentre
          ? {
              centerDistrictId: regionCentre.id,
              radiusKm: s.region.radiusKm,
              centerLat: regionCentre.latitude,
              centerLng: regionCentre.longitude,
            }
          : {}),
      },
    });
  }
  if (s.hours) {
    await prisma.providerWeeklyHours.createMany({
      data: s.hours.map(([weekday, start, end]) => ({
        providerId: profile.id,
        weekday,
        startMinute: minutes(start),
        endMinute: minutes(end),
      })),
      skipDuplicates: true,
    });
  }
  if (s.timeOffInDays) {
    const day = 24 * 3_600_000;
    const [from, to] = s.timeOffInDays;
    await prisma.providerTimeOff.create({
      data: {
        providerId: profile.id,
        startsAt: new Date(Date.now() + from * day),
        endsAt: new Date(Date.now() + to * day),
        note: 'DEMO: planlı izin',
      },
    });
  }
  return true;
}

export async function seedDemoMarketplace(
  prisma: PrismaClient,
  app: INestApplicationContext,
): Promise<DemoMarketplaceResult> {
  const result: DemoMarketplaceResult = {
    providersConfigured: 0,
    requests: 0,
    dispatched: 0,
    quotes: 0,
    messages: 0,
  };

  // Launch status demo: İzmir takes requests on the waitlist until opened.
  await prisma.province.updateMany({
    where: { id: IZMIR, isActive: false },
    data: { waitlistOpen: true },
  });

  for (const setup of SETUPS) {
    if (await configureProvider(prisma, setup)) result.providersConfigured += 1;
  }

  const requests = app.get(ServiceRequestsService);
  const quotes = app.get(QuotesService);
  const conversations = app.get(ConversationsService);
  const chat = app.get(ChatMessagesService);

  const ayse = await authUser(prisma, 'musteri@ustago.test');
  const zeynep = await authUser(prisma, 'demo-musteri-zeynep@ustago.test');
  const klimaUsta = await authUser(prisma, 'usta-klima@ustago.test');
  if (!ayse || !zeynep || !klimaUsta) return result;

  const [klima, elektrik] = await Promise.all(
    ['klima', 'elektrik'].map((slug) =>
      prisma.serviceCategory.findUniqueOrThrow({ where: { slug }, select: { id: true } }),
    ),
  );
  const addressOf = (userId: string) =>
    prisma.address.findFirstOrThrow({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

  const klimaRequest = await requests.create(
    ayse,
    {
      type: 'QUOTE',
      categoryId: klima!.id,
      addressId: (await addressOf(ayse.id)).id,
      title: 'Salon kliması soğutmuyor (DEMO)',
      description:
        'DEMO DATA: 12000 BTU split klima çalışıyor ama soğuk üflemiyor. Bakım ve gaz kontrolü istiyorum.',
      budgetMinor: 150_000,
      budgetMaxMinor: 250_000,
      scheduleOption: 'TODAY',
      answers: { service: 'repair', unit_count: 1 },
      photoUploadIds: [],
      publish: true,
      idempotencyKey: KLIMA_REQUEST_KEY,
    },
    null,
  );
  const elektrikRequest = await requests.create(
    zeynep,
    {
      type: 'QUOTE',
      categoryId: elektrik!.id,
      addressId: (await addressOf(zeynep.id)).id,
      title: 'Mutfakta sigorta sürekli atıyor (DEMO)',
      description:
        'DEMO DATA: Fırın ile su ısıtıcısı aynı anda çalışınca sigorta atıyor. Tesisat kontrolü gerekiyor.',
      budgetMinor: null,
      scheduleOption: 'TOMORROW',
      answers: { problem: 'breaker_trips', urgent: false },
      photoUploadIds: [],
      publish: true,
      idempotencyKey: ELEKTRIK_REQUEST_KEY,
    },
    null,
  );
  result.requests = 2;
  result.dispatched = await prisma.requestDispatch.count({
    where: { serviceRequestId: { in: [klimaRequest.id, elektrikRequest.id] } },
  });

  // One quote with the Faz 7 breakdown (₺1.500 işçilik + ₺500 malzeme + ₺200 servis).
  const klimaProfile = await prisma.providerProfile.findFirstOrThrow({
    where: { userId: klimaUsta.id },
    select: { id: true },
  });
  let quote = await prisma.quote.findFirst({
    where: { serviceRequestId: klimaRequest.id, providerId: klimaProfile.id },
    select: { id: true },
  });
  if (!quote) {
    quote = await quotes.create(
      klimaUsta,
      klimaRequest.id,
      {
        totalMinor: 220_000,
        laborMinor: 150_000,
        materialMinor: 50_000,
        materialsIncluded: true,
        serviceMinor: 20_000,
        arrivalEta: 'TODAY',
        estimatedDurationMinutes: 90,
        note: 'DEMO DATA: Gaz basıncı ve fan kontrolü dahil. Parça gerekirse önce fiyat sorarım.',
      },
      null,
    );
    result.quotes += 1;
  }

  const conversation = await conversations.open(ayse, { quoteId: quote.id });
  const existingMessages = await prisma.message.count({
    where: { conversationId: conversation.id, senderId: { not: null } },
  });
  if (existingMessages === 0) {
    await chat.send(ayse, conversation.id, {
      type: 'TEXT',
      clientMessageId: CHAT_KEYS[0],
      body: 'Merhaba, bugün öğleden sonra gelebilir misiniz? (DEMO)',
    });
    await chat.send(klimaUsta, conversation.id, {
      type: 'TEXT',
      clientMessageId: CHAT_KEYS[1],
      body: 'Merhaba, 15:00 gibi uğrayabilirim. Fiyat teklifteki gibi. (DEMO)',
    });
    result.messages = 2;
  }

  // Ayşe keeps the klima provider as a favourite.
  const customer = await prisma.customerProfile.findUniqueOrThrow({
    where: { userId: ayse.id },
    select: { id: true },
  });
  await prisma.favoriteProvider.upsert({
    where: { customerId_providerId: { customerId: customer.id, providerId: klimaProfile.id } },
    create: { customerId: customer.id, providerId: klimaProfile.id },
    update: {},
  });

  return result;
}
