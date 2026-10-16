import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { getTheme } from '@podcast/themes';
import { googleFontsHref, themeCssVars } from '@podcast/config';
import { JsonLd, SkipLink, organizationLd, websiteLd } from '@podcast/ui';
import '@podcast/ui/base.css';
import '@podcast/ui/motion.css';
import '@podcast/themes/all.css';
import { getSite } from '@/lib/api';
import { siteName } from '@/lib/seo';
import { Providers } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const name = siteName(site);
  return {
    metadataBase: new URL(site.base_url),
    title: { default: name, template: site.seo.title_template.replace('{site_name}', name) },
    description: site.seo.meta_description,
    applicationName: name,
    icons: site.branding.favicon_url ? { icon: site.branding.favicon_url } : undefined,
    robots: site.seo.index_policy === 'noindex' ? { index: false, follow: false } : undefined,
    openGraph: { siteName: name, type: 'website', images: site.seo.default_og_image ? [site.seo.default_og_image] : undefined },
    twitter: { card: (site.seo.twitter_card as 'summary_large_image') || 'summary_large_image', site: site.seo.twitter_handle || undefined },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const site = await getSite();
  return { themeColor: site.theme_config.background, width: 'device-width', initialScale: 1 };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const site = await getSite();
  const theme = getTheme(site.theme.key);
  const fonts = googleFontsHref(site.theme_config);
  const vars = themeCssVars(site.theme_config) as CSSProperties;
  const mode = site.theme_config.mode ?? 'light';
  return (
    <html lang={site.tenant.language || 'en'} data-theme={theme.key} style={{ colorScheme: mode === 'dark' ? 'dark' : 'light' }}>
      <head>
        {fonts && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            {/* eslint-disable-next-line @next/next/no-page-custom-font */}
            <link rel="stylesheet" href={fonts} />
          </>
        )}
      </head>
      <body>
        <Providers>
          <div className={`pe-root t-${theme.key}`} style={vars} data-mode={mode}>
            <SkipLink />
            <theme.Layout site={site}>{children}</theme.Layout>
          </div>
        </Providers>
        <JsonLd data={organizationLd(site)} />
        <JsonLd data={websiteLd(site)} />
      </body>
    </html>
  );
}
