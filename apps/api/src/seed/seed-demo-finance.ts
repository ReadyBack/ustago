import type { INestApplicationContext } from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { AdminFinanceService } from '../finance/admin-finance.service.js';
import { CashService } from '../finance/cash.service.js';
import { PaymentsService } from '../finance/payments.service.js';
import { PayoutsService } from '../finance/payouts.service.js';
import { MockPaymentProvider } from '../finance/providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER } from '../finance/providers/payment-provider.js';
import { WebhooksService } from '../finance/webhooks.service.js';
import type { PrismaClient, Role } from '../generated/prisma/client.js';

/**
 * DEMO finance history (development only, TEST money; see main.ts) for
 * "Demo Elektrik Ustası", so the wallet, admin finance pages and the
 * reconciliation report have real rows to show. The demo klima provider
 * used by the scripted A–F scenarios is left untouched, so its numbers
 * start from zero.
 *
 * Every money step goes through the real services (mock provider, signed
 * webhook, ledger), never through hand-written ledger rows. Idempotent:
 * fixed request ids and Idempotency-Keys, so a second run writes nothing.
 */
export const DEMO_FINANCE_PROVIDER_EMAIL = 'usta-elektrik@ustago.test';
const ADMIN_EMAIL = 'admin@ustago.test';
const DEMO_IBAN = 'TR330006100519786457841326'; // the public example IBAN; TEST only

interface DemoFinanceJob {
  key: string;
  customerEmail: string;
  title: string;
  priceMinor: bigint;
  daysAgo: number;
  method: 'IN_APP' | 'CASH';
}

const JOBS: readonly DemoFinanceJob[] = [
  {
    key: '0190c000-0000-7000-8000-00000000f001',
    customerEmail: 'demo-musteri-zeynep@ustago.test',
    title: 'Sigorta panosu yenileme (DEMO)',
    priceMinor: 300000n,
    daysAgo: 9,
    method: 'IN_APP',
  },
  {
    key: '0190c000-0000-7000-8000-00000000f002',
    customerEmail: 'demo-musteri-ali@ustago.test',
    title: 'Avize montajı (DEMO)',
    priceMinor: 80000n,
    daysAgo: 5,
    method: 'CASH',
  },
  {
    key: '0190c000-0000-7000-8000-00000000f003',
    customerEmail: 'demo-musteri-elif@ustago.test',
    title: 'Priz ve anahtar değişimi (DEMO)',
    priceMinor: 120000n,
    daysAgo: 2,
    method: 'IN_APP',
  },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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

export interface DemoFinanceResult {
  jobs: number;
  payments: number;
  cash: number;
  refunds: number;
  payouts: number;
}

export async function seedDemoFinance(
  prisma: PrismaClient,
  app: INestApplicationContext,
  now = new Date(),
): Promise<DemoFinanceResult> {
  const result: DemoFinanceResult = { jobs: 0, payments: 0, cash: 0, refunds: 0, payouts: 0 };
  const provider = await prisma.providerProfile.findFirst({
    where: { user: { email: DEMO_FINANCE_PROVIDER_EMAIL } },
    select: { id: true, userId: true },
  });
  const category = await prisma.serviceCategory.findUnique({
    where: { slug: 'elektrik' },
    select: { id: true },
  });
  const providerUser = await authUser(prisma, DEMO_FINANCE_PROVIDER_EMAIL);
  const admin = await authUser(prisma, ADMIN_EMAIL);
  const mock = app.get<unknown>(PAYMENT_PROVIDER);
  if (!provider || !category || !providerUser || !admin || !(mock instanceof MockPaymentProvider)) {
    return result;
  }
  const payments = app.get(PaymentsService);
  const cash = app.get(CashService);
  const webhooks = app.get(WebhooksService);
  const adminFinance = app.get(AdminFinanceService);
  const payouts = app.get(PayoutsService);

  const paymentIds: string[] = [];
  for (const demo of JOBS) {
    const customer = await prisma.customerProfile.findFirst({
      where: { user: { email: demo.customerEmail } },
      select: { id: true, userId: true },
    });
    const customerUser = await authUser(prisma, demo.customerEmail);
    if (!customer || !customerUser) continue;
    const jobId = await ensureCompletedJob(prisma, demo, customer, provider, category.id, now);
    if (!jobId) continue;
    result.jobs += 1;

    if (demo.method === 'CASH') {
      await payments.chooseMethod(customerUser, jobId, 'CASH', null);
      await cash.confirm(customerUser, jobId, null);
      await cash.confirm(providerUser, jobId, null);
      result.cash += 1;
      continue;
    }
    const payment = await payments.create(customerUser, jobId, `seed-demo-pay-${demo.key}`, null);
    if (payment.status === 'PENDING') {
      const { attempt } = await payments.pendingAttemptForPayer(customerUser.id, payment.id);
      const event = mock.simulate(
        attempt.gatewayTransactionId ?? '',
        'SUCCESS',
        BigInt(payment.amount.amountMinor),
      );
      await webhooks.handle(mock.name, event.rawBody, event.headers);
    }
    paymentIds.push(payment.id);
    result.payments += 1;
  }

  // A partial refund on the first job (TEST): 250 TL for a missing part.
  const first = paymentIds[0];
  if (first) {
    const detail = await adminFinance.payment(first);
    const already = detail.refunds.length > 0;
    if (!already && detail.refundable.amountMinor > 25000) {
      await adminFinance.refund(
        admin.id,
        first,
        {
          amountMinor: 25000,
          reason: 'SERVICE_ISSUE',
          note: 'DEMO: bir sigorta eksik takıldı, 250 TL iade edildi.',
          expectedRefundableMinor: detail.refundable.amountMinor,
        },
        'seed-demo-refund-f001',
        null,
      );
    }
    result.refunds += 1;
  }

  // One TEST payout of 1.000 TL, paid.
  let destination = await payouts.destination(providerUser.id);
  destination ??= await payouts.setDestination(
    providerUser,
    { holderName: 'Hakan Demo (TEST)', iban: DEMO_IBAN },
    null,
  );
  // Faz 6: a finance admin verifies every destination before payouts.
  if (destination.verificationStatus !== 'VERIFIED') {
    await payouts.verifyDestination(
      admin.id,
      destination.id,
      'DEMO: TEST hesabı doğrulandı.',
      null,
    );
  }
  const payout = await payouts.request(providerUser, 100000, 'seed-demo-payout-0001', null);
  if (payout.status === 'REQUESTED') await payouts.approve(admin.id, payout.id, null);
  const current = await payouts.view(payout.id);
  if (current.status === 'PROCESSING') await payouts.markTestPaid(admin.id, payout.id, null);
  result.payouts += 1;
  return result;
}

/** A completed DEMO job (request + job + history), written once. */
async function ensureCompletedJob(
  prisma: PrismaClient,
  demo: DemoFinanceJob,
  customer: { id: string; userId: string },
  provider: { id: string },
  categoryId: string,
  now: Date,
): Promise<string | null> {
  const existing = await prisma.serviceRequest.findUnique({
    where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey: demo.key } },
    select: { job: { select: { id: true } } },
  });
  if (existing) return existing.job?.id ?? null;
  const address = await prisma.address.findFirst({
    where: { userId: customer.userId, deletedAt: null },
    select: { id: true, provinceId: true, districtId: true },
  });
  const policy = await prisma.platformFeePolicy.findFirst({
    where: { currency: 'TRY', effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });
  if (!address) return null;
  const agreedAt = new Date(now.getTime() - demo.daysAgo * DAY);
  const at = (hours: number) => new Date(agreedAt.getTime() + hours * HOUR);
  return prisma.$transaction(async (tx) => {
    const request = await tx.serviceRequest.create({
      data: {
        customerId: customer.id,
        categoryId,
        addressId: address.id,
        provinceId: address.provinceId,
        districtId: address.districtId,
        type: 'QUOTE',
        status: 'COMPLETED',
        title: demo.title,
        description: `DEMO DATA: ${demo.title} — test ödemeli örnek iş.`,
        budgetMinor: demo.priceMinor,
        publishedAt: at(-6),
        idempotencyKey: demo.key,
        createdAt: at(-6),
      },
    });
    const job = await tx.job.create({
      data: {
        serviceRequestId: request.id,
        customerId: customer.id,
        providerId: provider.id,
        categoryId,
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
        ...(policy ? { platformFeePolicyId: policy.id, platformFeeBps: policy.bps } : {}),
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
    return job.id;
  });
}
