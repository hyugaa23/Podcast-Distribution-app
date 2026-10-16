// SEO engine (PRD §33–38): per-tenant title templates, dynamic metadata, canonical management.
import type { Metadata } from 'next';
import type { Site } from '@podcast/types';

export function siteName(site: Site): string {
  return site.seo.site_title || site.tenant.name;
}

/** Applies the tenant title template ("%s | {site_name}"). */
export function applyTemplate(site: Site, title: string): string {
  const tpl = site.seo.title_template || '%s | {site_name}';
  return tpl.replace('{site_name}', siteName(site)).replace('%s', title);
}

interface PageMeta {
  /** Final, fully formatted <title> (already templated). */
  title: string;
  description?: string;
  path: string;
  /** Absolute canonical URL (overrides base_url + path), e.g. primary tenant for syndicated content. */
  canonical?: string;
  image?: string;
  type?: 'website' | 'article' | 'music.song' | 'music.album';
  noindex?: boolean;
  publishedTime?: string | null;
  audio?: string;
}

export function pageMetadata(site: Site, m: PageMeta): Metadata {
  const canonical = m.canonical || `${site.base_url}${m.path}`;
  const image = m.image || site.seo.default_og_image || site.branding.logo_url || undefined;
  const description = (m.description || site.seo.meta_description || '').slice(0, 300);
  const noindex = m.noindex || site.seo.index_policy === 'noindex';
  return {
    title: { absolute: m.title },
    description,
    alternates: { canonical },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: m.title,
      description,
      url: canonical,
      siteName: siteName(site),
      type: m.type === 'article' ? 'article' : 'website',
      locale: site.tenant.language,
      ...(image ? { images: [{ url: image, width: 1400, height: 1400, alt: m.title }] } : {}),
      ...(m.publishedTime && m.type === 'article' ? { publishedTime: m.publishedTime } : {}),
      ...(m.audio ? { audio: [{ url: m.audio, type: 'audio/mpeg' }] } : {}),
    },
    twitter: {
      card: (site.seo.twitter_card as 'summary' | 'summary_large_image') || 'summary_large_image',
      title: m.title,
      description,
      ...(site.seo.twitter_handle ? { site: site.seo.twitter_handle } : {}),
      ...(image ? { images: [image] } : {}),
    },
  };
}

/** Plain-text excerpt for meta descriptions. */
export function excerpt(html: string | undefined | null, max = 160): string {
  const t = (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : t;
}
