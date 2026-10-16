import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Shared workspace packages are TypeScript sources.
  transpilePackages: ['@podcast/ui', '@podcast/player', '@podcast/themes', '@podcast/types', '@podcast/config'],
  turbopack: { root: path.join(__dirname, '../..') },
  // Tenant domains in development (*.localhost) load dev assets cross-origin.
  allowedDevOrigins: ['*.localhost', '*.test'],
  poweredByHeader: false,
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
