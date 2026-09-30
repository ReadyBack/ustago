import { deepLinkHref } from './deep-link';

/**
 * Where a notification (or a tapped push's data) leads. The server's
 * deepLink wins; a link the app cannot open goes to the "unavailable"
 * screen. Older notifications without a link fall back to the ids in data:
 * the job, the quote thread or the request. Null means nothing to open.
 */
export function notificationTarget(n: {
  deepLink?: string | null;
  data?: Record<string, unknown> | null;
}): string | null {
  const d = n.data ?? {};
  const link = n.deepLink ?? d.deepLink;
  if (typeof link === 'string' && link.length > 0) return deepLinkHref(link);
  const id = (key: string) => {
    const value = d[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  // Faz 7: message.* notifications carry the conversation id.
  const conversationId = id('conversationId');
  const isMessage = typeof d.type === 'string' && d.type.startsWith('message.');
  if (conversationId && isMessage) return `/messages/${conversationId}`;
  const jobId = id('jobId');
  if (jobId) return `/job/${jobId}`;
  const quoteId = id('quoteId');
  if (quoteId) return `/quote/${quoteId}`;
  const requestId = id('serviceRequestId');
  if (requestId) return `/request/${requestId}`;
  if (conversationId) return `/messages/${conversationId}`;
  return null;
}
