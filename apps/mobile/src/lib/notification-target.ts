/** Where a notification leads: the job, the quote thread or the request. */
export function notificationTarget(n: { data?: Record<string, unknown> | null }): string | null {
  const d = n.data ?? {};
  const id = (key: string) => {
    const value = d[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const jobId = id('jobId');
  if (jobId) return `/job/${jobId}`;
  const quoteId = id('quoteId');
  if (quoteId) return `/quote/${quoteId}`;
  const requestId = id('serviceRequestId');
  if (requestId) return `/request/${requestId}`;
  return null;
}
