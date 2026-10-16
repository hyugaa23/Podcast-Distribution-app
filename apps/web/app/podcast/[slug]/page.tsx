import type { Metadata } from 'next';
import { getTheme } from '@podcast/themes';
import { Breadcrumbs, JsonLd, podcastSeriesLd } from '@podcast/ui';
import { getPodcastPage, getSite } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { excerpt, pageMetadata, siteName } from '@/lib/seo';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { params: Promise<{ slug: string }> };

// Podcast title format: {podcast_title} | {site_name} (PRD §34), with per-tenant SEO overrides (PRD §91).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [site, page] = await Promise.all([getSite(), orNotFound(getPodcastPage(slug))]);
  const p = page.podcast;
  const meta = pageMetadata(site, {
    title: p.seo_title || `${p.title} | ${siteName(site)}`,
    description: p.meta_description || p.short_description || excerpt(p.description),
    path: `/podcast/${p.slug}`,
    canonical: page.canonical_url,
    image: p.artwork_url,
  });
  return { ...meta, alternates: { ...meta.alternates, types: { 'application/rss+xml': [{ url: page.feed_url, title: p.title }] } } };
}

export default async function PodcastPage({ params }: Props) {
  const { slug } = await params;
  const [site, page] = await Promise.all([getSite(), orNotFound(getPodcastPage(slug))]);
  const theme = getTheme(site.theme.key);
  const crumbs = [{ name: 'Home', href: '/' }, { name: 'Podcasts', href: '/podcasts' }];
  if (page.podcast.category) crumbs.push({ name: page.podcast.category.name, href: `/category/${page.podcast.category.slug}` });
  crumbs.push({ name: page.podcast.title, href: `/podcast/${page.podcast.slug}` });
  return (
    <>
      <TrackMarker podcastId={page.podcast.id} />
      <div className="pe-wrap pe-crumbs-wrap"><Breadcrumbs items={crumbs} baseUrl={site.base_url} /></div>
      <theme.PodcastPage site={site} page={page} />
      <JsonLd data={podcastSeriesLd(page, site)} />
    </>
  );
}
