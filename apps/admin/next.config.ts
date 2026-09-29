import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ustago/types', '@ustago/validation', '@ustago/ui'],
};

export default nextConfig;
