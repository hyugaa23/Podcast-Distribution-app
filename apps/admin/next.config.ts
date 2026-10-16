import type { NextConfig } from 'next';
import path from 'node:path';

const API = process.env.API_INTERNAL_URL || 'http://localhost:8080';

const nextConfig: NextConfig = {
  transpilePackages: ['@podcast/types', '@podcast/config'],
  turbopack: { root: path.join(__dirname, '../..') },
  poweredByHeader: false,
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Same-origin API proxy so the httpOnly refresh cookie (path /api/auth) works for the admin app.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/media/:path*', destination: `${API}/media/:path*` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};

export default nextConfig;
