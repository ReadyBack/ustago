import type {
  AdminCashSettlement,
  AdminFinanceSummary,
  AdminPaymentDetail,
  AdminPaymentListItem,
  AdminPayout,
  AdminRefund,
  CashSettlement,
  JobPaymentSummary,
  LedgerEntryView,
  LedgerTransactionView,
  MyPaymentDetail,
  MyPaymentListItem,
  Payment,
  PaymentAttempt,
  Payout,
  PayoutDestination,
  ProviderEarning,
  ReconciliationReport,
  Wallet,
  WalletLine,
  WalletStatement,
} from '@ustago/types';
import { z } from 'zod';

import { plainTextSchema } from './lifecycle.js';
import { MAX_PRICE_MINOR, moneySchema } from './money.js';

/**
 * Payments, cash settlements, wallet, payouts, refunds and ledger (Faz 5,
 * docs/adr/0018-0020). Clients never send a payment amount: the server
 * computes it from the job. Refund and payout amounts are checked on the
 * server against what is refundable / withdrawable.
 */

export const paymentMethodChoiceSchema = z.enum(['IN_APP', 'CASH']);
export const paymentStatusSchema = z.enum([
  'PENDING',
  'AUTHORIZED',
  'SUCCEEDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
  'DISPUTED',
  'SETTLED_OFFLINE',
]);
export const paymentAttemptStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const cashSettlementStatusSchema = z.enum([
  'AWAITING_CONFIRMATION',
  'CUSTOMER_CONFIRMED',
  'PROVIDER_CONFIRMED',
  'CONFIRMED',
  'DISPUTED',
  'RESOLVED_UNPAID',
]);
export const refundStatusSchema = z.enum(['REQUESTED', 'SUCCEEDED', 'FAILED']);
export const refundReasonSchema = z.enum([
  'JOB_CANCELLED',
  'DISPUTE_RESOLUTION',
  'SERVICE_ISSUE',
  'CUSTOMER_REQUEST',
  'DUPLICATE_PAYMENT',
  'OTHER',
]);
/** Reasons an admin can pick by hand; the other two are set by the system. */
export const adminRefundReasonSchema = z.enum([
  'SERVICE_ISSUE',
  'CUSTOMER_REQUEST',
  'DUPLICATE_PAYMENT',
  'OTHER',
]);
export const providerEarningStatusSchema = z.enum(['PENDING', 'HELD', 'AVAILABLE', 'REVERSED']);
export const payoutStatusSchema = z.enum([
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'CANCELLED',
]);
export const ledgerAccountTypeSchema = z.enum([
  'PROVIDER_PENDING',
  'PROVIDER_AVAILABLE',
  'PROVIDER_RESERVED',
  'PLATFORM_CLEARING',
  'PLATFORM_FEE_REVENUE',
  'REFUND_LIABILITY',
  'PROVIDER_PLATFORM_DEBT',
]);
export const ledgerTransactionTypeSchema = z.enum([
  'PAYMENT_CAPTURED',
  'EARNING_RELEASED',
  'CASH_FEE_ASSESSED',
  'REFUND_REQUESTED',
  'REFUND_COMPLETED',
  'PAYOUT_RESERVED',
  'PAYOUT_PAID',
  'PAYOUT_RELEASED',
  'REVERSAL',
  'ADJUSTMENT',
]);
export const mockPaymentOutcomeSchema = z.enum([
  'SUCCESS',
  'CARD_DECLINED',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'CANCELLED',
]);
export const financeRangeSchema = z.enum(['today', '7d', '30d']);
export const disputeFinancialActionTypeSchema = z.enum([
  'NO_FINANCIAL_ACTION',
  'FULL_CUSTOMER_REFUND',
  'PARTIAL_CUSTOMER_REFUND',
  'RELEASE_PROVIDER_FUNDS',
]);

/** Positive integer kuruş within the marketplace ceiling. */
export const positiveMinorSchema = z
  .number({ message: 'Tutar kuruş cinsinden tam sayı olmalı.' })
  .int('Tutar kuruş cinsinden tam sayı olmalı.')
  .min(1, 'Tutar sıfırdan büyük olmalı.')
  .max(MAX_PRICE_MINOR, 'Tutar çok yüksek.');

/**
 * `Idempotency-Key` header: the same key always returns the first result
 * and never moves money twice. Clients generate a random one per user
 * action (UUID recommended).
 */
export const idempotencyKeySchema = z
  .string({ message: 'Idempotency-Key başlığı gerekli.' })
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,80}$/, 'Idempotency-Key 8-80 karakter (harf, rakam, - _) olmalı.');

// ---------------------------------------------------------------------------
// IBAN (payout destination). Only format and checksum are verified; a real
// payout provider verifies ownership.
// ---------------------------------------------------------------------------

/** Removes spaces and upper-cases: "tr33 0006 1005..." → "TR330006...". */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 mod-97 check for a Turkish IBAN (26 characters). */
export function isValidTrIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^TR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** "TR** **** **** **** **** **12 34": country and the last four digits only. */
export function maskIban(value: string): string {
  const iban = normalizeIban(value);
  const last4 = iban.slice(-4);
  return `${iban.slice(0, 2)}** **** **** **** **** **${last4.slice(0, 2)} ${last4.slice(2)}`;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const choosePaymentMethodSchema = z
  .object({ method: paymentMethodChoiceSchema })
  .strict();
export type ChoosePaymentMethod = z.infer<typeof choosePaymentMethodSchema>;

export const cashDisputeSchema = z
  .object({ note: plainTextSchema(10, 1000, 'Lütfen durumu en az 10 karakterle açıklayın.') })
  .strict();
export type CashDispute = z.infer<typeof cashDisputeSchema>;

export const simulatePaymentSchema = z.object({ outcome: mockPaymentOutcomeSchema }).strict();
export type SimulatePayment = z.infer<typeof simulatePaymentSchema>;

export const payoutRequestSchema = z.object({ amountMinor: positiveMinorSchema }).strict();
export type PayoutRequest = z.infer<typeof payoutRequestSchema>;

export const payoutDestinationRequestSchema = z
  .object({
    holderName: z.string().trim().min(3, 'Hesap sahibinin adını yazın.').max(120),
    iban: z
      .string()
      .transform(normalizeIban)
      .refine(isValidTrIban, 'Geçerli bir TR IBAN girin (TR + 24 rakam).'),
  })
  .strict();
export type PayoutDestinationRequest = z.infer<typeof payoutDestinationRequestSchema>;

export const adminRefundSchema = z
  .object({
    amountMinor: positiveMinorSchema,
    reason: adminRefundReasonSchema,
    note: plainTextSchema(3, 1000, 'İç not zorunludur (en az 3 karakter).'),
    /**
     * The refundable amount the admin saw on the confirm screen. If it
     * changed in the meantime the request is refused (no stale refunds).
     */
    expectedRefundableMinor: z.number().int().min(0),
  })
  .strict();
export type AdminRefundRequest = z.infer<typeof adminRefundSchema>;

export const adminPayoutDecisionSchema = z
  .object({ note: plainTextSchema(3, 500, 'Kısa bir not yazın.').optional() })
  .strict();
export type AdminPayoutDecision = z.infer<typeof adminPayoutDecisionSchema>;

export const adminCashResolveSchema = z
  .object({
    outcome: z.enum(['CONFIRM_PAID', 'MARK_UNPAID']),
    note: plainTextSchema(3, 1000, 'Karar notu en az 3 karakter olmalı.'),
  })
  .strict();
export type AdminCashResolve = z.infer<typeof adminCashResolveSchema>;

export const disputeFinancialActionSchema = z
  .object({
    type: disputeFinancialActionTypeSchema,
    /** Only for PARTIAL_CUSTOMER_REFUND. */
    refundAmountMinor: positiveMinorSchema.optional(),
  })
  .strict()
  .refine(
    (a) => (a.type === 'PARTIAL_CUSTOMER_REFUND') === (a.refundAmountMinor !== undefined),
    { message: 'Kısmi iade tutarı yalnızca kısmi iadede ve zorunlu olarak verilir.' },
  );
export type DisputeFinancialAction = z.infer<typeof disputeFinancialActionSchema>;

const cursorQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
};

export const listMyPaymentsQuerySchema = z.object({ ...cursorQuery });
export type ListMyPaymentsQuery = z.infer<typeof listMyPaymentsQuerySchema>;

export const listWalletQuerySchema = z.object({ ...cursorQuery });
export type ListWalletQuery = z.infer<typeof listWalletQuerySchema>;

export const financeSummaryQuerySchema = z.object({ range: financeRangeSchema.default('30d') });
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

export const listAdminPaymentsQuerySchema = z.object({
  ...cursorQuery,
  status: paymentStatusSchema.optional(),
  method: paymentMethodChoiceSchema.optional(),
  gateway: z.string().trim().min(1).max(40).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ListAdminPaymentsQuery = z.infer<typeof listAdminPaymentsQuerySchema>;

export const listAdminLedgerQuerySchema = z.object({
  ...cursorQuery,
  type: ledgerTransactionTypeSchema.optional(),
  paymentId: z.uuid().optional(),
  providerId: z.uuid().optional(),
});
export type ListAdminLedgerQuery = z.infer<typeof listAdminLedgerQuerySchema>;

export const listAdminPayoutsQuerySchema = z.object({
  ...cursorQuery,
  status: payoutStatusSchema.optional(),
});
export type ListAdminPayoutsQuery = z.infer<typeof listAdminPayoutsQuerySchema>;

export const listAdminCashQuerySchema = z.object({
  ...cursorQuery,
  status: cashSettlementStatusSchema.optional(),
});
export type ListAdminCashQuery = z.infer<typeof listAdminCashQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const date = z.iso.datetime();
const nullableDate = date.nullable();

export const paymentAttemptSchema = z.object({
  id: z.uuid(),
  attemptNumber: z.number().int().min(1),
  status: paymentAttemptStatusSchema,
  failureCode: z.string().nullable(),
  createdAt: date,
  completedAt: nullableDate,
}) satisfies z.ZodType<PaymentAttempt>;

export const paymentSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  method: paymentMethodChoiceSchema,
  status: paymentStatusSchema,
  amount: moneySchema,
  refunded: moneySchema,
  net: moneySchema,
  testMode: z.boolean(),
  lastFailureCode: z.string().nullable(),
  createdAt: date,
  succeededAt: nullableDate,
  attempts: z.array(paymentAttemptSchema),
}) satisfies z.ZodType<Payment>;

export const cashSettlementSchema = z.object({
  id: z.uuid(),
  status: cashSettlementStatusSchema,
  amount: moneySchema,
  customerConfirmedAt: nullableDate,
  providerConfirmedAt: nullableDate,
  confirmedAt: nullableDate,
  disputedAt: nullableDate,
}) satisfies z.ZodType<CashSettlement>;

export const jobPaymentSummarySchema = z.object({
  jobId: z.uuid(),
  viewerRole: z.enum(['CUSTOMER', 'PROVIDER']),
  method: paymentMethodChoiceSchema.nullable(),
  total: moneySchema,
  paid: moneySchema,
  refunded: moneySchema,
  netPaid: moneySchema,
  outstanding: moneySchema,
  inFlight: paymentSchema.nullable(),
  payments: z.array(paymentSchema),
  cash: cashSettlementSchema.nullable(),
  testMode: z.boolean(),
  onlineEnabled: z.boolean(),
  cashEnabled: z.boolean(),
  actions: z.object({
    canChooseMethod: z.boolean(),
    canPayOnline: z.boolean(),
    canConfirmCash: z.boolean(),
    canDisputeCash: z.boolean(),
  }),
  providerBreakdown: z
    .object({
      gross: moneySchema,
      platformFee: moneySchema,
      net: moneySchema,
      feeBps: z.number().int().min(0).max(10000),
      developmentPolicy: z.boolean(),
    })
    .nullable(),
}) satisfies z.ZodType<JobPaymentSummary>;

export const myPaymentListItemSchema = z.object({
  kind: z.enum(['ONLINE', 'CASH']),
  id: z.uuid(),
  jobId: z.uuid(),
  title: z.string(),
  amount: moneySchema,
  refunded: moneySchema,
  method: paymentMethodChoiceSchema,
  status: z.union([paymentStatusSchema, cashSettlementStatusSchema]),
  createdAt: date,
}) satisfies z.ZodType<MyPaymentListItem>;

export const myPaymentDetailSchema = myPaymentListItemSchema.extend({
  providerName: z.string(),
  jobTotal: moneySchema,
  net: moneySchema,
  completedAt: nullableDate,
  testMode: z.boolean(),
  attempts: z.array(paymentAttemptSchema),
}) satisfies z.ZodType<MyPaymentDetail>;

export const payoutDestinationSchema = z.object({
  id: z.uuid(),
  holderName: z.string(),
  maskedIban: z.string(),
  isTest: z.boolean(),
}) satisfies z.ZodType<PayoutDestination>;

export const payoutSchema = z.object({
  id: z.uuid(),
  amount: moneySchema,
  status: payoutStatusSchema,
  destination: payoutDestinationSchema,
  failureCode: z.string().nullable(),
  createdAt: date,
  paidAt: nullableDate,
  cancelledAt: nullableDate,
  failedAt: nullableDate,
}) satisfies z.ZodType<Payout>;

export const walletStatementSchema = z.object({
  period: z.enum(['THIS_MONTH', 'LAST_30_DAYS']),
  from: date,
  to: date,
  grossJobValue: moneySchema,
  platformFees: moneySchema,
  netEarnings: moneySchema,
  paidOut: moneySchema,
}) satisfies z.ZodType<WalletStatement>;

export const walletLineSchema = z.object({
  transactionId: z.uuid(),
  type: ledgerTransactionTypeSchema,
  label: z.string(),
  jobTitle: z.string().nullable(),
  createdAt: date,
  changes: z.array(
    z.object({
      bucket: z.enum(['PENDING', 'AVAILABLE', 'RESERVED', 'PLATFORM_DEBT']),
      amount: moneySchema,
    }),
  ),
}) satisfies z.ZodType<WalletLine>;

export const walletSchema = z.object({
  balances: z.object({
    pending: moneySchema,
    held: moneySchema,
    available: moneySchema,
    reserved: moneySchema,
    platformDebt: moneySchema,
    withdrawable: moneySchema,
    paidOut: moneySchema,
  }),
  statements: z.array(walletStatementSchema),
  nextReleaseAt: nullableDate,
  minPayout: moneySchema,
  payoutsEnabled: z.boolean(),
  testMode: z.boolean(),
  destination: payoutDestinationSchema.nullable(),
  recent: z.array(walletLineSchema),
  pendingPayouts: z.array(payoutSchema),
}) satisfies z.ZodType<Wallet>;

export const providerEarningSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobTitle: z.string(),
  categoryName: z.string(),
  gross: moneySchema,
  platformFee: moneySchema,
  net: moneySchema,
  refunded: moneySchema,
  feeBps: z.number().int().min(0).max(10000),
  status: providerEarningStatusSchema,
  holdUntil: nullableDate,
  releasedAt: nullableDate,
  createdAt: date,
}) satisfies z.ZodType<ProviderEarning>;

export const adminFinanceSummarySchema = z.object({
  range: financeRangeSchema,
  from: date,
  to: date,
  onlineVolume: moneySchema,
  onlineCount: z.number().int().min(0),
  cashVolume: moneySchema,
  cashCount: z.number().int().min(0),
  platformFees: moneySchema,
  providerPayable: moneySchema,
  providerDebt: moneySchema,
  pendingRefunds: z.object({ count: z.number().int().min(0), amount: moneySchema }),
  pendingPayouts: z.object({ count: z.number().int().min(0), amount: moneySchema }),
  openCashDisputes: z.number().int().min(0),
  testMode: z.boolean(),
}) satisfies z.ZodType<AdminFinanceSummary>;

export const adminPaymentListItemSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobTitle: z.string(),
  customerName: z.string(),
  providerName: z.string(),
  amount: moneySchema,
  refunded: moneySchema,
  method: paymentMethodChoiceSchema,
  gateway: z.string().nullable(),
  status: paymentStatusSchema,
  createdAt: date,
}) satisfies z.ZodType<AdminPaymentListItem>;

export const adminRefundViewSchema = z.object({
  id: z.uuid(),
  amount: moneySchema,
  feePortion: moneySchema,
  providerPortion: moneySchema,
  status: refundStatusSchema,
  reason: refundReasonSchema,
  internalNote: z.string().nullable(),
  requestedBy: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: date,
  completedAt: nullableDate,
}) satisfies z.ZodType<AdminRefund>;

export const ledgerEntryViewSchema = z.object({
  accountType: ledgerAccountTypeSchema,
  owner: z.string(),
  direction: z.enum(['DEBIT', 'CREDIT']),
  amount: moneySchema,
}) satisfies z.ZodType<LedgerEntryView>;

export const ledgerTransactionViewSchema = z.object({
  id: z.uuid(),
  type: ledgerTransactionTypeSchema,
  sourceKey: z.string(),
  description: z.string().nullable(),
  createdAt: date,
  jobId: z.uuid().nullable(),
  paymentId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  payoutId: z.uuid().nullable(),
  cashSettlementId: z.uuid().nullable(),
  earningId: z.uuid().nullable(),
  reversesId: z.uuid().nullable(),
  entries: z.array(ledgerEntryViewSchema),
  totalDebit: moneySchema,
  totalCredit: moneySchema,
  imbalance: moneySchema,
}) satisfies z.ZodType<LedgerTransactionView>;

export const adminPaymentDetailSchema = adminPaymentListItemSchema.extend({
  platformFee: moneySchema,
  feeBps: z.number().int().nullable(),
  gatewayReference: z.string().nullable(),
  refundable: moneySchema,
  testMode: z.boolean(),
  job: z.object({ status: z.string(), agreedPrice: moneySchema, currentTotal: moneySchema }),
  attempts: z.array(paymentAttemptSchema),
  earning: providerEarningSchema.nullable(),
  refunds: z.array(adminRefundViewSchema),
  ledger: z.array(ledgerTransactionViewSchema),
  audit: z.array(
    z.object({ action: z.string(), entityType: z.string().nullable(), at: date }),
  ),
}) satisfies z.ZodType<AdminPaymentDetail>;

export const adminPayoutSchema = payoutSchema.extend({
  providerId: z.uuid(),
  providerName: z.string(),
  statusNote: z.string().nullable(),
}) satisfies z.ZodType<AdminPayout>;

export const adminCashSettlementSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobTitle: z.string(),
  providerName: z.string(),
  customerName: z.string(),
  amount: moneySchema,
  fee: moneySchema,
  status: cashSettlementStatusSchema,
  customerConfirmedAt: nullableDate,
  providerConfirmedAt: nullableDate,
  disputedAt: nullableDate,
  disputeNote: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: date,
}) satisfies z.ZodType<AdminCashSettlement>;

export const reconciliationReportSchema = z.object({
  generatedAt: date,
  checked: z.object({
    payments: z.number().int().min(0),
    refunds: z.number().int().min(0),
    payouts: z.number().int().min(0),
    cashSettlements: z.number().int().min(0),
    earnings: z.number().int().min(0),
    ledgerTransactions: z.number().int().min(0),
  }),
  totals: z.object({ debit: moneySchema, credit: moneySchema }),
  ledgerBalanced: z.boolean(),
  mismatches: z.array(
    z.object({
      kind: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      message: z.string(),
    }),
  ),
}) satisfies z.ZodType<ReconciliationReport>;

/** Turkish labels shared by the apps (the API sends codes). */
export const PAYMENT_STATUS_LABELS: Record<z.infer<typeof paymentStatusSchema>, string> = {
  PENDING: 'Bekliyor',
  AUTHORIZED: 'Onaylandı',
  SUCCEEDED: 'Başarılı',
  PARTIALLY_REFUNDED: 'Kısmi iade',
  REFUNDED: 'İade edildi',
  FAILED: 'Başarısız',
  CANCELLED: 'İptal edildi',
  DISPUTED: 'İtirazlı',
  SETTLED_OFFLINE: 'Doğrudan ödendi',
};

export const CASH_STATUS_LABELS: Record<z.infer<typeof cashSettlementStatusSchema>, string> = {
  AWAITING_CONFIRMATION: 'Onay bekliyor',
  CUSTOMER_CONFIRMED: 'Müşteri onayladı',
  PROVIDER_CONFIRMED: 'Usta onayladı',
  CONFIRMED: 'Onaylandı',
  DISPUTED: 'Anlaşmazlık',
  RESOLVED_UNPAID: 'Ödenmedi olarak kaydedildi',
};

export const PAYOUT_STATUS_LABELS: Record<z.infer<typeof payoutStatusSchema>, string> = {
  REQUESTED: 'Talep edildi',
  APPROVED: 'Onaylandı',
  PROCESSING: 'İşleniyor',
  PAID: 'Ödendi',
  FAILED: 'Başarısız',
  CANCELLED: 'İptal edildi',
};

export const EARNING_STATUS_LABELS: Record<z.infer<typeof providerEarningStatusSchema>, string> = {
  PENDING: 'Beklemede',
  HELD: 'Sorun incelemesinde',
  AVAILABLE: 'Kullanılabilir',
  REVERSED: 'İade edildi',
};

/** "%15" / "%12,5" from basis points. */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return `%${whole}${frac === 0 ? '' : `,${String(frac).padStart(2, '0').replace(/0$/, '')}`}`;
}
