import { deepLinkHref, parseDeepLink, UNAVAILABLE_ROUTE } from './deep-link';

const ID = '0190c000-0000-7000-8000-000000000001';

describe('parseDeepLink', () => {
  it.each([
    // What the API stores (apps/api notification-events.ts).
    [`/jobs/${ID}`, `/job/${ID}`],
    [`/requests/${ID}`, `/request/${ID}`],
    [`/payments/${ID}`, `/payments/${ID}`],
    [`/provider/earnings/${ID}`, `/earnings/${ID}`],
    [`/provider/payouts/${ID}`, '/payouts'],
    ['/provider/verification', '/verification'],
    // The app scheme, with or without the extra slash, query or hash.
    [`ustago://jobs/${ID}`, `/job/${ID}`],
    [`ustago:///jobs/${ID}`, `/job/${ID}`],
    [`USTAGO://quotes/${ID}?from=push`, `/quote/${ID}`],
    [`jobs/${ID}#top`, `/job/${ID}`],
    ['/me/sessions', '/sessions'],
    ['/account-deletion', '/account-deletion'],
    ['/notifications/', '/notifications'],
    // Faz 7: message.* notifications open the conversation.
    [`/messages/${ID}`, `/messages/${ID}`],
    [`ustago://messages/${ID}`, `/messages/${ID}`],
    [`/conversations/${ID}`, `/messages/${ID}`],
  ])('%s → %s', (link, href) => {
    expect(parseDeepLink(link)).toEqual({ kind: 'route', href });
  });

  it.each([
    ['https://evil.example/jobs/1'],
    ['javascript:alert(1)'],
    ['/jobs/../../admin'],
    ['/jobs/a%2Fb'],
    ['/jobs'],
    [`/jobs/${ID}/extra`],
    ['/admin/users'],
    [''],
    ['   '],
    ['ustago://'],
  ])('%s is unknown', (link) => {
    expect(parseDeepLink(link)).toEqual({ kind: 'unknown' });
  });

  it('rejects non-strings', () => {
    expect(parseDeepLink(null)).toEqual({ kind: 'unknown' });
    expect(parseDeepLink(42)).toEqual({ kind: 'unknown' });
    expect(parseDeepLink(undefined)).toEqual({ kind: 'unknown' });
  });
});

describe('deepLinkHref', () => {
  it('falls back to the unavailable screen', () => {
    expect(deepLinkHref('/something/new')).toBe(UNAVAILABLE_ROUTE);
    expect(deepLinkHref(`/jobs/${ID}`)).toBe(`/job/${ID}`);
  });
});
