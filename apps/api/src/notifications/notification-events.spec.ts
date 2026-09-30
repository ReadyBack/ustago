import { categoryOf, NotificationEvent, wantsPush } from './notification-events.js';

describe('notification events', () => {
  it('uses unique dotted keys', () => {
    const keys = Object.values(NotificationEvent);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z_]+\.[a-z_]+$/);
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
    [NotificationEvent.NOW_NEW_REQUEST, 'JOB'],
    [NotificationEvent.QUOTE_COUNTERED, 'QUOTE'],
    [NotificationEvent.NEW_OPPORTUNITY, 'QUOTE'],
  ])('%s is a %s event', (type, category) => {
    expect(categoryOf(type)).toBe(category);
  });

  it('always pushes job events; quote pushes follow the preference', () => {
    const off = { quoteUpdatesPush: false };
    expect(wantsPush(NotificationEvent.JOB_EN_ROUTE, off)).toBe(true);
    expect(wantsPush(NotificationEvent.QUOTE_COUNTERED, off)).toBe(false);
    expect(wantsPush(NotificationEvent.QUOTE_COUNTERED, { quoteUpdatesPush: true })).toBe(true);
  });
});
