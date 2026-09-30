import type { AdminAuditLine } from './lifecycle.js';
import type { Money } from './money.js';

/**
 * Payments, cash settlements, provider wallet, payouts, refunds and the
 * ledger (Faz 5, docs/adr/0018-0020). Every amount is minor units (kuruş).
 */

/** IN_APP = "Uygulamadan öde", CASH = "Ustaya doğrudan öde". */
export type PaymentMethodChoice = 'IN_APP' | 'CASH';
export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'SUCCEEDED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DISPUTED'
  | 'SETTLED_OFFLINE';
export type PaymentAttemptStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type CashSettlementStatus =
  | 'AWAITING_CONFIRMATION'
  | 'CUSTOMER_CONFIRMED'
  | 'PROVIDER_CONFIRMED'
  | 'CONFIRMED'
  | 'DISPUTED'
  | 'RESOLVED_UNPAID';
export type RefundStatus = 'REQUESTED' | 'SUCCEEDED' | 'FAILED';
export type RefundReason =
  | 'JOB_CANCELLED'
  | 'DISPUTE_RESOLUTION'
  | 'SERVICE_ISSUE'
  | 'CUSTOMER_REQUEST'
  | 'DUPLICATE_PAYMENT'
  | 'OTHER';
export type ProviderEarningStatus = 'PENDING' | 'HELD' | 'AVAILABLE' | 'REVERSED';
export type PayoutStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  /** Faz 6: the provider's answer was lost; money stays reserved until checked. */
  | 'NEEDS_RECONCILIATION';
export type LedgerAccountType =
  | 'PROVIDER_PENDING'
  | 'PROVIDER_AVAILABLE'
  | 'PROVIDER_RESERVED'
  | 'PLATFORM_CLEARING'
  | 'PLATFORM_FEE_REVENUE'
  | 'REFUND_LIABILITY'
  | 'PROVIDER_PLATFORM_DEBT';
export type LedgerTransactionType =
  | 'PAYMENT_CAPTURED'
  | 'EARNING_RELEASED'
  | 'CASH_FEE_ASSESSED'
  | 'REFUND_REQUESTED'
  | 'REFUND_COMPLETED'
  | 'PAYOUT_RESERVED'
  | 'PAYOUT_PAID'
  | 'PAYOUT_RELEASED'
  | 'REVERSAL'
  | 'ADJUSTMENT';
/** Outcomes the test payment screen can ask the mock provider for. */
export type MockPaymentOutcome =
  'SUCCESS' | 'CARD_DECLINED' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'CANCELLED';

export interface PaymentAttempt {
  id: string;
  attemptNumber: number;
  status: PaymentAttemptStatus;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** An online payment as its payer sees it (no provider internals). */
export interface Payment {
  id: string;
  jobId: string;
  method: PaymentMethodChoice;
  status: PaymentStatus;
  amount: Money;
  refunded: Money;
  /** amount − refunded. */
  net: Money;
  /** True when the payment provider is the test (mock) provider. */
  testMode: boolean;
  lastFailureCode: string | null;
  createdAt: string;
  succeededAt: string | null;
  attempts: PaymentAttempt[];
}

export interface CashSettlement {
  id: string;
  status: CashSettlementStatus;
  amount: Money;
  customerConfirmedAt: string | null;
  providerConfirmedAt: string | null;
  confirmedAt: string | null;
  disputedAt: string | null;
}

/** What the provider earns from the job (never sent to the customer). */
export interface ProviderPaymentBreakdown {
  gross: Money;
  platformFee: Money;
  net: Money;
  feeBps: number;
  /** The fee policy is a development default, not a commercial price. */
  developmentPolicy: boolean;
}

export interface JobPaymentActions {
  canChooseMethod: boolean;
  canPayOnline: boolean;
  canConfirmCash: boolean;
  canDisputeCash: boolean;
}

/**
 * GET /jobs/:id/payment-summary. All amounts computed by the server:
 * paid = captured online payments + cash confirmed by both sides;
 * outstanding = job total − paid (an in-flight payment is shown separately).
 */
export interface JobPaymentSummary {
  jobId: string;
  viewerRole: 'CUSTOMER' | 'PROVIDER';
  method: PaymentMethodChoice | null;
  total: Money;
  paid: Money;
  refunded: Money;
  netPaid: Money;
  outstanding: Money;
  inFlight: Payment | null;
  payments: Payment[];
  cash: CashSettlement | null;
  testMode: boolean;
  onlineEnabled: boolean;
  cashEnabled: boolean;
  actions: JobPaymentActions;
  providerBreakdown: ProviderPaymentBreakdown | null;
}

/** "Ödemelerim" row: an online payment or a confirmed-or-pending cash settlement. */
export interface MyPaymentListItem {
  kind: 'ONLINE' | 'CASH';
  id: string;
  jobId: string;
  title: string;
  amount: Money;
  refunded: Money;
  method: PaymentMethodChoice;
  status: PaymentStatus | CashSettlementStatus;
  createdAt: string;
}

/** Ödeme Özeti. Not an invoice or any legal document. */
export interface MyPaymentDetail extends MyPaymentListItem {
  providerName: string;
  jobTotal: Money;
  net: Money;
  completedAt: string | null;
  testMode: boolean;
  attempts: PaymentAttempt[];
}

export interface WalletBalances {
  /** Earnings waiting for completion / the hold period (includes held). */
  pending: Money;
  /** Part of pending frozen by an open dispute. */
  held: Money;
  available: Money;
  reserved: Money;
  /** What the provider owes the platform (e.g. cash job fees). */
  platformDebt: Money;
  /** max(0, available − platformDebt): what can be requested now. */
  withdrawable: Money;
  paidOut: Money;
}

export interface WalletStatement {
  period: 'THIS_MONTH' | 'LAST_30_DAYS';
  from: string;
  to: string;
  grossJobValue: Money;
  platformFees: Money;
  netEarnings: Money;
  paidOut: Money;
}

export type WalletBucket = 'PENDING' | 'AVAILABLE' | 'RESERVED' | 'PLATFORM_DEBT';

export interface WalletLine {
  transactionId: string;
  type: LedgerTransactionType;
  label: string;
  jobTitle: string | null;
  createdAt: string;
  /** Signed change per bucket from the provider's point of view. */
  changes: { bucket: WalletBucket; amount: Money }[];
}

export interface PayoutDestination {
  id: string;
  holderName: string;
  /** "TR** **** **** **** **** **12 34": the full IBAN is never stored. */
  maskedIban: string;
  isTest: boolean;
  /**
   * Payouts need VERIFIED. Faz 6 verifies manually (finance admin); a real
   * account-ownership check is a provider decision (docs/decisions).
   */
  verificationStatus: 'UNVERIFIED' | 'PENDING_VERIFICATION' | 'VERIFIED';
}

export interface Payout {
  id: string;
  amount: Money;
  status: PayoutStatus;
  destination: PayoutDestination;
  failureCode: string | null;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
}

export interface Wallet {
  balances: WalletBalances;
  statements: WalletStatement[];
  /** Earliest time a pending earning becomes available, if known. */
  nextReleaseAt: string | null;
  minPayout: Money;
  payoutsEnabled: boolean;
  testMode: boolean;
  destination: PayoutDestination | null;
  recent: WalletLine[];
  pendingPayouts: Payout[];
}

export interface ProviderEarning {
  id: string;
  jobId: string;
  jobTitle: string;
  categoryName: string;
  gross: Money;
  platformFee: Money;
  net: Money;
  /** Provider part of refunds on this payment. */
  refunded: Money;
  feeBps: number;
  status: ProviderEarningStatus;
  holdUntil: string | null;
  releasedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminFinanceSummary {
  range: 'today' | '7d' | '30d';
  from: string;
  to: string;
  onlineVolume: Money;
  onlineCount: number;
  cashVolume: Money;
  cashCount: number;
  /** Net platform fee revenue booked in the range (fees − fee refunds). */
  platformFees: Money;
  /** Current balance owed to providers (pending + available + reserved). */
  providerPayable: Money;
  providerDebt: Money;
  pendingRefunds: { count: number; amount: Money };
  pendingPayouts: { count: number; amount: Money };
  openCashDisputes: number;
  testMode: boolean;
}

export interface AdminPaymentListItem {
  id: string;
  jobId: string;
  jobTitle: string;
  customerName: string;
  providerName: string;
  amount: Money;
  refunded: Money;
  method: PaymentMethodChoice;
  gateway: string | null;
  status: PaymentStatus;
  createdAt: string;
}

export interface AdminRefund {
  id: string;
  amount: Money;
  feePortion: Money;
  providerPortion: Money;
  status: RefundStatus;
  reason: RefundReason;
  internalNote: string | null;
  requestedBy: string | null;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface LedgerEntryView {
  accountType: LedgerAccountType;
  /** "Platform" or the provider's display name. */
  owner: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: Money;
}

export interface LedgerTransactionView {
  id: string;
  type: LedgerTransactionType;
  sourceKey: string;
  description: string | null;
  createdAt: string;
  jobId: string | null;
  paymentId: string | null;
  refundId: string | null;
  payoutId: string | null;
  cashSettlementId: string | null;
  earningId: string | null;
  reversesId: string | null;
  entries: LedgerEntryView[];
  totalDebit: Money;
  totalCredit: Money;
  /** totalDebit − totalCredit; always 0 for a valid transaction. */
  imbalance: Money;
}

export interface AdminPaymentDetail extends AdminPaymentListItem {
  platformFee: Money;
  feeBps: number | null;
  /** Payment provider's reference of the successful attempt. */
  gatewayReference: string | null;
  refundable: Money;
  testMode: boolean;
  job: { status: string; agreedPrice: Money; currentTotal: Money };
  attempts: PaymentAttempt[];
  earning: ProviderEarning | null;
  refunds: AdminRefund[];
  ledger: LedgerTransactionView[];
  audit: AdminAuditLine[];
}

export interface AdminPayout extends Payout {
  providerId: string;
  providerName: string;
  statusNote: string | null;
}

export interface AdminCashSettlement {
  id: string;
  jobId: string;
  jobTitle: string;
  providerName: string;
  customerName: string;
  amount: Money;
  fee: Money;
  status: CashSettlementStatus;
  customerConfirmedAt: string | null;
  providerConfirmedAt: string | null;
  disputedAt: string | null;
  disputeNote: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface ReconciliationMismatch {
  kind: string;
  entityType: string;
  entityId: string;
  message: string;
}

/** Read-only report; nothing is fixed automatically. */
export interface ReconciliationReport {
  generatedAt: string;
  checked: {
    payments: number;
    refunds: number;
    payouts: number;
    cashSettlements: number;
    earnings: number;
    ledgerTransactions: number;
  };
  totals: { debit: Money; credit: Money };
  ledgerBalanced: boolean;
  mismatches: ReconciliationMismatch[];
}
