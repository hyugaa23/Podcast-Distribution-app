import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './refresh.css';
import { AuthProvider } from '@/lib/auth';
import { Shell } from '@/components/Shell';
import { ToastProvider } from '@/components/ui';

// The admin is an authenticated client application: never prerender it at build time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Podcast Engine Admin', template: '%s · Podcast Engine Admin' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>
        <ToastProvider>
          <AuthProvider>
            <Shell>{children}</Shell>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
