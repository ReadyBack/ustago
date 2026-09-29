/**
 * Only same-site relative paths may be used as a post-login destination
 * ("/providers/123"), never "//evil.com" or "https://evil.com".
 */
export function safeNextPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}
