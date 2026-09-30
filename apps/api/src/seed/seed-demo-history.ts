import type { PrismaClient } from '../generated/prisma/client.js';
import { QualityRepository } from '../quality/quality.repository.js';
import { writeQualitySnapshots } from '../quality/quality-snapshots.js';

/**
 * DEMO DATA (development only, never in production; see main.ts): a short,
 * realistic job history for "Demo Klima Ustası" so the public profile,
 * quote cards and admin quality page show real aggregates from real rows
 * (three completed jobs, reviews 5 / 4 / 5). Every row is created through
 * the same tables the app writes, marked "(DEMO)" in its text.
 *
 * Idempotent: each demo request has a fixed idempotency key, so a second
 * run finds it and writes nothing.
 */
export const DEMO_PROVIDER_EMAIL = 'usta-klima@ustago.test';

interface DemoJob {
  customerEmail: string;
  idempotencyKey: string;
  title: string;
  description: string;
  priceMinor: bigint;
  daysAgo: number;
  review: {
    rating: number;
    quality: number;
    communication: number;
    punctuality: number;
    value: number;
    comment: string;
  };
}

export const DEMO_JOBS: readonly DemoJob[] = [
  {
    customerEmail: 'demo-musteri-zeynep@ustago.test',
    idempotencyKey: '0190c000-0000-7000-8000-00000000d001',
    title: 'Klima bakımı ve filtre temizliği (DEMO)',
    description: 'DEMO DATA: salondaki split klimanın yıllık bakımı ve filtre temizliği.',
    priceMinor: 120000n,
    daysAgo: 42,
    review: {
      rating: 5,
      quality: 5,
      communication: 5,
      punctuality: 5,
      value: 4,
      comment: 'Zamanında geldi, bakımı özenle yaptı ve ne yaptığını tek tek anlattı. (DEMO)',
    },
  },
  {
    customerEmail: 'demo-musteri-ali@ustago.test',
    idempotencyKey: '0190c000-0000-7000-8000-00000000d002',
    title: 'Klima gaz dolumu (DEMO)',
    description: 'DEMO DATA: yatak odası kliması soğutmuyor, gaz kontrolü ve dolum.',
    priceMinor: 180000n,
    daysAgo: 27,
    review: {
      rating: 4,
      quality: 4,
      communication: 4,
      punctuality: 3,
      value: 4,
      comment: 'İş temiz, klima artık iyi soğutuyor. Yarım saat kadar geç geldi. (DEMO)',
    },
  },
  {
    customerEmail: 'demo-musteri-elif@ustago.test',
    idempotencyKey: '0190c000-0000-7000-8000-00000000d003',
    title: 'Klima montajı (DEMO)',
    description: 'DEMO DATA: yeni alınan 12000 BTU klimanın montajı.',
    priceMinor: 250000n,
    daysAgo: 11,
    review: {
      rating: 5,
      quality: 5,
      communication: 5,
      punctuality: 5,
      value: 5,
      comment: 'Montaj çok düzgün oldu, borular ve kablolar toplu. Tavsiye ederim. (DEMO)',
    },
  },
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function seedDemoHistory(prisma: PrismaClient, now = new Date()): Promise<number> {
  const provider = await prisma.providerProfile.findFirst({
    where: { user: { email: DEMO_PROVIDER_EMAIL } },
    select: { id: true, userId: true },
  });
  const category = await prisma.serviceCategory.findUnique({
    where: { slug: 'klima' },
    select: { id: true },
  });
  if (!provider || !category) return 0;

  let created = 0;
  for (const demo of DEMO_JOBS) {
    const customer = await prisma.customerProfile.findFirst({
      where: { user: { email: demo.customerEmail } },
      select: { id: true, userId: true },
    });
    if (!customer) continue;
    const exists = await prisma.serviceRequest.findUnique({
      where: {
        customerId_idempotencyKey: {
          customerId: customer.id,
          idempotencyKey: demo.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (exists) continue;
    const address = await prisma.address.findFirst({
      where: { userId: customer.userId, deletedAt: null },
      select: { id: true, provinceId: true, districtId: true },
    });
    if (!address) continue;

    const agreedAt = new Date(now.getTime() - demo.daysAgo * DAY);
    const at = (hours: number) => new Date(agreedAt.getTime() + hours * HOUR);
    await prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.create({
        data: {
          customerId: customer.id,
          categoryId: category.id,
          addressId: address.id,
          provinceId: address.provinceId,
          districtId: address.districtId,
          type: 'QUOTE',
          status: 'COMPLETED',
          title: demo.title,
          description: demo.description,
          budgetMinor: demo.priceMinor,
          publishedAt: at(-6),
          idempotencyKey: demo.idempotencyKey,
          createdAt: at(-6),
        },
      });
      const job = await tx.job.create({
        data: {
          serviceRequestId: request.id,
          customerId: customer.id,
          providerId: provider.id,
          categoryId: category.id,
          status: 'COMPLETED',
          agreedPriceMinor: demo.priceMinor,
          currentTotalMinor: demo.priceMinor,
          scheduledStartAt: at(20),
          createdAt: agreedAt,
          enRouteAt: at(19.5),
          arrivedAt: at(20),
          startedAt: at(20.2),
          completionRequestedAt: at(22),
          completedAt: at(22.5),
        },
      });
      await tx.jobStatusHistory.create({
        data: {
          jobId: job.id,
          fromStatus: null,
          toStatus: 'COMPLETED',
          reason: 'demo_seed',
          metadata: { demo: true },
          createdAt: at(22.5),
        },
      });
      await tx.review.create({
        data: {
          jobId: job.id,
          direction: 'CUSTOMER_TO_PROVIDER',
          authorId: customer.userId,
          targetId: provider.userId,
          rating: demo.review.rating,
          qualityRating: demo.review.quality,
          communicationRating: demo.review.communication,
          punctualityRating: demo.review.punctuality,
          priceRating: demo.review.value,
          comment: demo.review.comment,
          createdAt: at(26),
        },
      });
    });
    created += 1;
  }
  return created;
}

/** Real UstaScore snapshots for every provider (replaces any placeholder). */
export async function recalculateAllScores(prisma: PrismaClient, now = new Date()): Promise<number> {
  const providers = await prisma.providerProfile.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  await writeQualitySnapshots(
    prisma,
    new QualityRepository(),
    providers.map((p) => p.id),
    now,
  );
  return providers.length;
}
