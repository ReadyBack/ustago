import type { NextConfig } from 'next';

/** Admin pages are never framed, sniffed or leaked through the referrer. */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ustago/types', '@ustago/validation', '@ustago/ui'],
  headers() {
    return Promise.resolve([
      // Documents set their own, stricter CSP (sandbox) in the route handler.
      {
        source: '/((?!verifications/[^/]+/document$).*)',
        headers: [
          ...securityHeaders,
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      { source: '/verifications/:id/document', headers: securityHeaders },
    ]);
  },
};

export default nextConfig;
