import { randomUUID } from 'node:crypto';

import type {
  AdminPaymentDetail,
  JobPaymentSummary,
  MockPaymentOutcome,
  Payment,
  Wallet,
} from '@ustago/types';
import {
  adminPaymentDetailSchema,
  jobPaymentSummarySchema,
  paymentSchema,
  reconciliationReportSchema,
  walletSchema,
} from '@ustago/validation';
import { expect } from 'vitest';

import { MockPaymentProvider } from '../src/finance/providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER } from '../src/finance/providers/payment-provider.js';
import { ReconciliationService } from '../src/finance/reconciliation.service.js';
import { asActor, type Actor } from './provider-helpers.js';
import { bearer, createStaffUser, type TestContext } from './helpers.js';

/** A fresh, valid Idempotency-Key. */
export const idemKey = () => `e2e_${randomUUID().replaceAll('-', '')}`;

export async function adminActor(ctx: TestContext): Promise<Actor> {
  return asActor(await createStaffUser(ctx, ['ADMIN']));
}

export function mockProvider(ctx: TestContext): MockPaymentProvider {
  const provider = ctx.app.get<unknown>(PAYMENT_PROVIDER);
  if (!(provider instanceof MockPaymentProvider))
    throw new Error('Finance e2e needs the mock provider');
  return provider;
}

export async function summaryOf(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
): Promise<JobPaymentSummary> {
  const res = await ctx
    .http()
    .get(`/api/v1/jobs/${jobId}/payment-summary`)
    .set('Authorization', bearer(actor))
    .expect(200);
  return jobPaymentSummarySchema.parse(res.body);
}

export function chooseMethod(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
  method: 'IN_APP' | 'CASH',
) {
  return ctx
    .http()
    .put(`/api/v1/jobs/${jobId}/payment-method`)
    .set('Authorization', bearer(actor))
    .send({ method });
}

export function createPayment(ctx: TestContext, actor: Actor, jobId: string, key = idemKey()) {
  return ctx
    .http()
    .post(`/api/v1/jobs/${jobId}/payments`)
    .set('Authorization', bearer(actor))
    .set('Idempotency-Key', key)
    .send();
}

export function simulate(
  ctx: TestContext,
  actor: Actor,
  paymentId: string,
  outcome: MockPaymentOutcome,
) {
  return ctx
    .http()
    .post(`/api/v1/dev/payments/${paymentId}/simulate`)
    .set('Authorization', bearer(actor))
    .send({ outcome });
}

/** "Uygulamadan Öde" → TEST ÖDEMESİ decided by the mock provider. */
export async function payOnline(
  ctx: TestContext,
  customer: Actor,
  jobId: string,
  outcome: MockPaymentOutcome = 'SUCCESS',
): Promise<Payment> {
  const created = await createPayment(ctx, customer, jobId).expect(200);
  const payment = paymentSchema.parse(created.body);
  const res = await simulate(ctx, customer, payment.id, outcome).expect(200);
  return paymentSchema.parse(res.body);
}

export function confirmCash(ctx: TestContext, actor: Actor, jobId: string) {
  return ctx
    .http()
    .post(`/api/v1/jobs/${jobId}/cash/confirm`)
    .set('Authorization', bearer(actor))
    .send();
}

export async function walletOf(ctx: TestContext, provider: Actor): Promise<Wallet> {
  const res = await ctx
    .http()
    .get('/api/v1/me/wallet')
    .set('Authorization', bearer(provider))
    .expect(200);
  return walletSchema.parse(res.body);
}

export function setDestination(
  ctx: TestContext,
  provider: Actor,
  iban = 'TR330006100519786457841326',
) {
  return ctx
    .http()
    .put('/api/v1/me/payout-destination')
    .set('Authorization', bearer(provider))
    .send({ holderName: 'Test Usta', iban });
}

export function requestPayout(
  ctx: TestContext,
  provider: Actor,
  amountMinor: number,
  key = idemKey(),
) {
  return ctx
    .http()
    .post('/api/v1/me/payouts')
    .set('Authorization', bearer(provider))
    .set('Idempotency-Key', key)
    .send({ amountMinor });
}

export async function adminPayment(
  ctx: TestContext,
  admin: Actor,
  paymentId: string,
): Promise<AdminPaymentDetail> {
  const res = await ctx
    .http()
    .get(`/api/v1/admin/finance/payments/${paymentId}`)
    .set('Authorization', bearer(admin))
    .expect(200);
  return adminPaymentDetailSchema.parse(res.body);
}

export function adminRefund(
  ctx: TestContext,
  admin: Actor,
  paymentId: string,
  body: { amountMinor: number; expectedRefundableMinor: number; reason?: string; note?: string },
  key = idemKey(),
) {
  return ctx
    .http()
    .post(`/api/v1/admin/finance/payments/${paymentId}/refunds`)
    .set('Authorization', bearer(admin))
    .set('Idempotency-Key', key)
    .send({ reason: 'SERVICE_ISSUE', note: 'E2E test iadesi', ...body });
}

/**
 * The ledger invariants every finance test ends with: total debit =
 * total credit, no unbalanced transaction, and the reconciliation report
 * finds nothing for this run's rows.
 */
export async function expectLedgerConsistent(
  ctx: TestContext,
  jobIds: string[] = [],
): Promise<void> {
  const unbalanced = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM ledger_transactions t
    LEFT JOIN ledger_entries e ON e.journal_id = t.id
    GROUP BY t.id
    HAVING COUNT(e.id) < 2
       OR SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END) <> 0`;
  expect(unbalanced).toEqual([]);
  const report = reconciliationReportSchema.parse(
    JSON.parse(JSON.stringify(await ctx.app.get(ReconciliationService).run())),
  );
  expect(report.ledgerBalanced).toBe(true);
  expect(report.totals.debit.amountMinor).toBe(report.totals.credit.amountMinor);
  if (jobIds.length > 0) {
    const related = await relatedIds(ctx, jobIds);
    const mine = report.mismatches.filter((m) => related.has(m.entityId));
    expect(mine).toEqual([]);
  }
}

async function relatedIds(ctx: TestContext, jobIds: string[]): Promise<Set<string>> {
  const [payments, refunds, earnings, cash, jobs] = await Promise.all([
    ctx.prisma.payment.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } }),
    ctx.prisma.refund.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } }),
    ctx.prisma.providerEarning.findMany({
      where: { jobId: { in: jobIds } },
      select: { id: true, providerId: true },
    }),
    ctx.prisma.cashSettlement.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } }),
    ctx.prisma.job.findMany({ where: { id: { in: jobIds } }, select: { providerId: true } }),
  ]);
  const payouts = await ctx.prisma.payout.findMany({
    where: { providerId: { in: jobs.map((j) => j.providerId) } },
    select: { id: true },
  });
  return new Set([
    ...jobIds,
    ...payments.map((x) => x.id),
    ...refunds.map((x) => x.id),
    ...earnings.map((x) => x.id),
    ...earnings.map((x) => x.providerId),
    ...cash.map((x) => x.id),
    ...payouts.map((x) => x.id),
  ]);
}
