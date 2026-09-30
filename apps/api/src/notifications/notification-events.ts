/**
 * Notification event keys (docs/adr/0017). The stored `type` is the dotted
 * key; the constant names are the event names used in documents
 * (JOB_EN_ROUTE, CHANGE_ORDER_CREATED, ...).
 */
export const NotificationEvent = {
  // Faz 3: requests and negotiation
  NOW_NEW_REQUEST: 'now.new_request',
  NEW_OPPORTUNITY: 'service_request.new_opportunity',
  QUOTE_CREATED: 'quote.created',
  QUOTE_COUNTERED: 'quote.countered',
  QUOTE_ACCEPTED: 'quote.accepted',
  QUOTE_REJECTED: 'quote.rejected',
  QUOTE_WITHDRAWN: 'quote.withdrawn',
  // Faz 4: job lifecycle
  JOB_EN_ROUTE: 'job.en_route',
  JOB_ARRIVED: 'job.arrived',
  JOB_STARTED: 'job.started',
  CHANGE_ORDER_CREATED: 'change_order.created',
  CHANGE_ORDER_ACCEPTED: 'change_order.accepted',
  CHANGE_ORDER_REJECTED: 'change_order.rejected',
  CHANGE_ORDER_CANCELLED: 'change_order.cancelled',
  JOB_COMPLETION_REQUESTED: 'job.completion_requested',
  JOB_COMPLETED: 'job.completed',
  JOB_DISPUTED: 'job.disputed',
  JOB_CANCELLED: 'job.cancelled',
  DISPUTE_RESOLVED: 'dispute.resolved',
  REVIEW_RECEIVED: 'review.received',
  // Faz 5: money
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_RECEIVED: 'payment.received',
  REFUND_COMPLETED: 'payment.refunded',
  CASH_CONFIRMATION_REQUESTED: 'cash.confirmation_requested',
  // Faz 6: names used by the Faz 6 prompt (same stored keys where they exist)
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  CASH_CONFIRMATION_REQUIRED: 'cash.confirmation_requested',
  PAYOUT_REQUESTED: 'payout.requested',
  PAYOUT_APPROVED: 'payout.approved',
  PAYOUT_NEEDS_RECONCILIATION: 'payout.needs_reconciliation',
  // Faz 6: provider verification and account status
  VERIFICATION_SUBMITTED: 'provider.verification.submitted',
  VERIFICATION_UNDER_REVIEW: 'provider.verification.under_review',
  VERIFICATION_NEEDS_REVISION: 'provider.verification.needs_revision',
  VERIFICATION_APPROVED: 'provider.verification.approved',
  VERIFICATION_REJECTED: 'provider.verification.rejected',
  ACCOUNT_SUSPENDED: 'provider.account.suspended',
  ACCOUNT_REINSTATED: 'provider.account.reinstated',
  CASH_CONFIRMED: 'cash.confirmed',
  CASH_DISPUTED: 'cash.disputed',
  CASH_RESOLVED: 'cash.resolved',
  EARNING_AVAILABLE: 'earning.available',
  PAYOUT_PAID: 'payout.paid',
  PAYOUT_FAILED: 'payout.failed',
} as const;

export type NotificationEventKey = (typeof NotificationEvent)[keyof typeof NotificationEvent];

/**
 * JOB: about an agreed job or an emergency call. Transactional: always in
 * the app and always pushed, because someone is coming to (or waiting at)
 * a door. QUOTE: offers and negotiation; the user may turn the push off.
 * The in-app row is written in every case.
 */
export type NotificationCategory = 'JOB' | 'QUOTE';

export function categoryOf(type: string): NotificationCategory {
  if (
    type.startsWith('job.') ||
    type.startsWith('change_order.') ||
    type.startsWith('dispute.') ||
    type.startsWith('review.') ||
    type.startsWith('now.') ||
    type.startsWith('payment.') ||
    type.startsWith('cash.') ||
    type.startsWith('earning.') ||
    type.startsWith('payout.') ||
    type.startsWith('provider.')
  ) {
    return 'JOB';
  }
  return 'QUOTE';
}

export interface PushPreferences {
  quoteUpdatesPush: boolean;
}

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = { quoteUpdatesPush: true };

/** Whether an event should also go out as a push for this user. */
export function wantsPush(type: string, prefs: PushPreferences): boolean {
  return categoryOf(type) === 'JOB' || prefs.quoteUpdatesPush;
}

export interface NotificationTarget {
  entityType: string;
  entityId: string;
  deepLink: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The record a notification is about and the in-app route that opens it
 * (Faz 6). Only ids from the notification's own data are used, and the
 * route's endpoint checks ownership again, so a link never grants access:
 * someone else's id just shows "bulunamadı".
 */
export function notificationTarget(
  type: string,
  data: Record<string, string> | undefined,
): NotificationTarget | null {
  const id = (key: string) => {
    const v = data?.[key];
    return v && UUID.test(v) ? v : null;
  };
  if (type.startsWith('payout.')) {
    const payoutId = id('payoutId');
    return payoutId
      ? { entityType: 'PAYOUT', entityId: payoutId, deepLink: `/provider/payouts/${payoutId}` }
      : null;
  }
  if (type === 'earning.available') {
    const earningId = id('earningId');
    return earningId
      ? { entityType: 'EARNING', entityId: earningId, deepLink: `/provider/earnings/${earningId}` }
      : null;
  }
  if (type === 'payment.received') {
    const jobId = id('jobId');
    return jobId ? { entityType: 'JOB', entityId: jobId, deepLink: `/jobs/${jobId}` } : null;
  }
  if (type.startsWith('payment.')) {
    const paymentId = id('paymentId');
    if (paymentId) {
      return { entityType: 'PAYMENT', entityId: paymentId, deepLink: `/payments/${paymentId}` };
    }
  }
  if (type.startsWith('provider.')) {
    const providerId = id('providerId');
    return providerId
      ? { entityType: 'PROVIDER', entityId: providerId, deepLink: '/provider/verification' }
      : null;
  }
  const jobId = id('jobId');
  if (jobId) return { entityType: 'JOB', entityId: jobId, deepLink: `/jobs/${jobId}` };
  const requestId = id('requestId') ?? id('serviceRequestId');
  if (requestId) {
    return {
      entityType: 'SERVICE_REQUEST',
      entityId: requestId,
      deepLink: `/requests/${requestId}`,
    };
  }
  return null;
}
