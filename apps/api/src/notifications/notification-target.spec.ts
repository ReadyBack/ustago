import { NotificationEvent, notificationTarget } from './notification-events.js';

const ID = '0190c000-0000-7000-8000-000000000001';

describe('notification deep links (Faz 6)', () => {
  it.each([
    [NotificationEvent.PAYOUT_PAID, { payoutId: ID }, `/provider/payouts/${ID}`],
    [NotificationEvent.PAYOUT_REQUESTED, { payoutId: ID }, `/provider/payouts/${ID}`],
    [NotificationEvent.EARNING_AVAILABLE, { earningId: ID }, `/provider/earnings/${ID}`],
    [NotificationEvent.PAYMENT_RECEIVED, { jobId: ID }, `/jobs/${ID}`],
    [NotificationEvent.PAYMENT_FAILED, { paymentId: ID }, `/payments/${ID}`],
    [NotificationEvent.VERIFICATION_APPROVED, { providerId: ID }, '/provider/verification'],
    [NotificationEvent.JOB_EN_ROUTE, { jobId: ID }, `/jobs/${ID}`],
  ])('%s → %s', (type, data, link) => {
    expect(notificationTarget(type, data)?.deepLink).toBe(link);
  });

  it('never builds a link from something that is not an id', () => {
    expect(
      notificationTarget(NotificationEvent.PAYOUT_PAID, { payoutId: '../../admin' }),
    ).toBeNull();
    expect(
      notificationTarget(NotificationEvent.JOB_EN_ROUTE, { jobId: 'javascript:alert(1)' }),
    ).toBeNull();
    expect(notificationTarget('job.en_route', undefined)).toBeNull();
  });
});
