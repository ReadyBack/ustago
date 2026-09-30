import { categoryOf, NotificationEvent, wantsPush } from './notification-events.js';

describe('notification events', () => {
  it('uses unique dotted keys (Faz 6 aliases share the stored key)', () => {
    const aliases = new Set(['PAYMENT_REFUNDED', 'CASH_CONFIRMATION_REQUIRED']);
    const keys = Object.entries(NotificationEvent)
      .filter(([name]) => !aliases.has(name))
      .map(([, key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    expect(NotificationEvent.PAYMENT_REFUNDED).toBe(NotificationEvent.REFUND_COMPLETED);
    expect(NotificationEvent.CASH_CONFIRMATION_REQUIRED).toBe(
      NotificationEvent.CASH_CONFIRMATION_REQUESTED,
    );
  });

  it.each([
    [NotificationEvent.JOB_EN_ROUTE, 'JOB'],
    [NotificationEvent.JOB_ARRIVED, 'JOB'],
    [NotificationEvent.JOB_STARTED, 'JOB'],
    [NotificationEvent.CHANGE_ORDER_CREATED, 'JOB'],
    [NotificationEvent.CHANGE_ORDER_ACCEPTED, 'JOB'],
    [NotificationEvent.CHANGE_ORDER_REJECTED, 'JOB'],
    [NotificationEvent.JOB_COMPLETION_REQUESTED, 'JOB'],
    [NotificationEvent.JOB_COMPLETED, 'JOB'],
    [NotificationEvent.JOB_DISPUTED, 'JOB'],
    [NotificationEvent.JOB_CANCELLED, 'JOB'],
    [NotificationEvent.DISPUTE_RESOLVED, 'JOB'],
    [NotificationEvent.REVIEW_RECEIVED, 'JOB'],
    [NotificationEvent.REVIEW_REPLIED, 'JOB'],
    [NotificationEvent.NOW_NEW_REQUEST, 'JOB'],
    [NotificationEvent.QUOTE_COUNTERED, 'QUOTE'],
    [NotificationEvent.NEW_OPPORTUNITY, 'QUOTE'],
  ])('%s is a %s event', (type, category) => {
    expect(categoryOf(type)).toBe(category);
  });

  it('always pushes job events; quote pushes follow the preference', () => {
    const prefs = {
      quoteUpdatesPush: false,
      newMessagePush: true,
      newJobAlerts: 'ON' as const,
      quietHoursStart: null,
      quietHoursEnd: null,
    };
    const off = prefs;
    expect(wantsPush(NotificationEvent.JOB_EN_ROUTE, off)).toBe(true);
    expect(wantsPush(NotificationEvent.QUOTE_COUNTERED, off)).toBe(false);
    expect(wantsPush(NotificationEvent.QUOTE_COUNTERED, { ...prefs, quoteUpdatesPush: true })).toBe(
      true,
    );
  });
});
