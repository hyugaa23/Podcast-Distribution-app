import type { Metadata } from 'next';
import { EmptyState } from '@podcast/ui';
import { getSite, listCollections } from '@/lib/api';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { PageShell, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return pageMetadata(site, { title: applyTemplate(site, 'Collections'), description: `Curated podcast collections from ${site.tenant.name}.`, path: '/collections' });
}

export default async function CollectionsPage() {
  const [site, cols] = await Promise.all([getSite(), listCollections()]);
  return (
    <PageShell title="Collections" lead={`Curated podcast collections from ${site.tenant.name}.`}>
      <TrackMarker />
      {cols.length === 0 && <EmptyState>No collections yet.</EmptyState>}
      {cols.map((c) => (
        <section key={c.id} aria-labelledby={`col-${c.id}`}>
          <h2 id={`col-${c.id}`} className="pe-section-title"><a href={`/collection/${c.slug}`}>{c.title}</a></h2>
          {c.description && <p className="pe-page__lead">{c.description}</p>}
          <PodcastGrid site={site} podcasts={c.podcasts.slice(0, 6)} />
          {c.podcasts.length > 6 && <p style={{ marginTop: 8 }}><a href={`/collection/${c.slug}`}>View all {c.podcasts.length} podcasts →</a></p>}
        </section>
      ))}
    </PageShell>
  );
}
