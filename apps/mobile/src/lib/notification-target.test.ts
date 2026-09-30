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

  it('follows the server deep link before the ids', () => {
    expect(notificationTarget({ deepLink: '/payments/p1', data: { jobId: 'j1' } })).toBe(
      '/payments/p1',
    );
    // A tapped push carries the link inside its data.
    expect(notificationTarget({ data: { deepLink: '/provider/verification' } })).toBe(
      '/verification',
    );
  });

  it('opens the fallback screen for a link the app does not know', () => {
    expect(notificationTarget({ deepLink: '/brand-new-feature/1', data: { jobId: 'j1' } })).toBe(
      '/unavailable',
    );
    expect(notificationTarget({ deepLink: 'https://example.com' })).toBe('/unavailable');
  });

  it('uses the ids when the link is empty', () => {
    expect(notificationTarget({ deepLink: '', data: { jobId: 'j1' } })).toBe('/job/j1');
    expect(notificationTarget({ deepLink: null, data: null })).toBeNull();
  });
});
