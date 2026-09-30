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
    type.startsWith('payout.')
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
