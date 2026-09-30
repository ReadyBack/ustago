/**
 * Notification deep links (Faz 6). The API stores links such as
 * "/jobs/<id>" or "/provider/payouts/<id>"; a push or an OS link may also
 * arrive as "ustago://jobs/<id>". This maps them onto the app's own routes.
 * Anything else (other hosts, web links, odd ids, unknown paths) is
 * "unknown" and opens the "Bu içerik artık mevcut değil" screen. The target
 * screen still loads through the API, which checks ownership, so a link
 * never grants access by itself.
 */

export type DeepLinkResult = { kind: 'route'; href: string } | { kind: 'unknown' };

/** Where unknown or broken links land. */
export const UNAVAILABLE_ROUTE = '/unavailable';

const SCHEME = 'ustago:';
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Rule = { pattern: readonly string[]; to: (id: string) => string };

/** ":id" matches one safe id segment; everything else must match literally. */
const RULES: readonly Rule[] = [
  { pattern: ['jobs', ':id'], to: (id) => `/job/${id}` },
  { pattern: ['job', ':id'], to: (id) => `/job/${id}` },
  { pattern: ['requests', ':id'], to: (id) => `/request/${id}` },
  { pattern: ['request', ':id'], to: (id) => `/request/${id}` },
  { pattern: ['quotes', ':id'], to: (id) => `/quote/${id}` },
  { pattern: ['quote', ':id'], to: (id) => `/quote/${id}` },
  { pattern: ['payments', ':id'], to: (id) => `/payments/${id}` },
  { pattern: ['payments'], to: () => '/payments' },
  { pattern: ['provider', 'earnings', ':id'], to: (id) => `/earnings/${id}` },
  { pattern: ['earnings', ':id'], to: (id) => `/earnings/${id}` },
  { pattern: ['provider', 'earnings'], to: () => '/provider/earnings' },
  // There is no payout detail screen: the payout list shows each payout's state.
  { pattern: ['provider', 'payouts', ':id'], to: () => '/payouts' },
  { pattern: ['provider', 'payouts'], to: () => '/payouts' },
  { pattern: ['payouts'], to: () => '/payouts' },
  { pattern: ['provider', 'verification'], to: () => '/verification' },
  { pattern: ['verification'], to: () => '/verification' },
  { pattern: ['usta', ':id'], to: (id) => `/usta/${id}` },
  { pattern: ['notifications'], to: () => '/notifications' },
  { pattern: ['me', 'sessions'], to: () => '/sessions' },
  { pattern: ['sessions'], to: () => '/sessions' },
  { pattern: ['account-deletion'], to: () => '/account-deletion' },
];

/** Path segments of an in-app link, or null when the link points outside the app. */
function segmentsOf(raw: string): string[] | null {
  let rest = raw.trim();
  if (rest.length === 0 || rest.length > 512) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) {
    // Only our own scheme; http(s), javascript: and friends are never followed.
    if (rest.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return null;
    rest = rest.slice(SCHEME.length).replace(/^\/+/, '');
  }
  rest = rest.split(/[?#]/, 1)[0] ?? '';
  const segments = rest.split('/').filter((s) => s.length > 0);
  return segments.length > 0 ? segments : null;
}

export function parseDeepLink(raw: unknown): DeepLinkResult {
  if (typeof raw !== 'string') return { kind: 'unknown' };
  const segments = segmentsOf(raw);
  if (!segments) return { kind: 'unknown' };
  for (const rule of RULES) {
    if (rule.pattern.length !== segments.length) continue;
    let id = '';
    const ok = rule.pattern.every((part, i) => {
      const seg = segments[i] ?? '';
      if (part === ':id') {
        id = seg;
        return ID.test(seg);
      }
      return seg.toLowerCase() === part;
    });
    if (ok) return { kind: 'route', href: rule.to(id) };
  }
  return { kind: 'unknown' };
}

/** The route to open for a link: the mapped screen or the "unavailable" fallback. */
export function deepLinkHref(raw: unknown): string {
  const result = parseDeepLink(raw);
  return result.kind === 'route' ? result.href : UNAVAILABLE_ROUTE;
}
