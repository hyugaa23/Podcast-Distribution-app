import type { Metadata } from 'next';
import { Breadcrumbs, JsonLd } from '@podcast/ui';
import { getCollection, getSite } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { PageShell, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [site, c] = await Promise.all([getSite(), orNotFound(getCollection(slug))]);
  return pageMetadata(site, {
    title: applyTemplate(site, c.title),
    description: c.description || `${c.title}: a curated list of podcasts on ${site.tenant.name}.`,
    path: `/collection/${c.slug}`,
    image: c.cover_url || c.podcasts[0]?.artwork_url,
  });
}

// Podcast collections for discovery and SEO (PRD §92), e.g. /collection/best-marketing-podcasts.
export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const [site, c] = await Promise.all([getSite(), orNotFound(getCollection(slug))]);
  return (
    <PageShell eyebrow="Collection" title={c.title} lead={c.description}>
      <TrackMarker />
      <Breadcrumbs baseUrl={site.base_url} items={[{ name: 'Home', href: '/' }, { name: 'Collections', href: '/collections' }, { name: c.title, href: `/collection/${c.slug}` }]} />
      <PodcastGrid site={site} podcasts={c.podcasts} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: c.title,
          itemListElement: c.podcasts.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site.base_url}/podcast/${p.slug}`, name: p.title })),
        }}
      />
    </PageShell>
  );
}
