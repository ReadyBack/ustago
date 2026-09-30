import { notificationTarget } from './notification-target';

describe('notificationTarget', () => {
  it('prefers the job, then the quote, then the request', () => {
    expect(notificationTarget({ data: { jobId: 'j1', quoteId: 'q1' } })).toBe('/job/j1');
    expect(notificationTarget({ data: { quoteId: 'q1', serviceRequestId: 'r1' } })).toBe(
      '/quote/q1',
    );
    expect(notificationTarget({ data: { serviceRequestId: 'r1' } })).toBe('/request/r1');
  });

  it('ignores empty or non-string payloads', () => {
    expect(notificationTarget({ data: null })).toBeNull();
    expect(notificationTarget({ data: { jobId: '' } })).toBeNull();
    expect(notificationTarget({ data: { jobId: 42 } })).toBeNull();
  });
});
