import type { Metadata } from 'next';
import { getSite, getTag } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { EpisodeList, PageShell, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [site, d] = await Promise.all([getSite(), orNotFound(getTag(slug))]);
  return pageMetadata(site, { title: applyTemplate(site, `#${d.tag.name} podcasts & episodes`), description: `Discover podcasts and episodes tagged #${d.tag.name} on ${site.tenant.name}.`, path: `/tag/${d.tag.slug}` });
}

export default async function TagPage({ params }: Props) {
  const { slug } = await params;
  const [site, d] = await Promise.all([getSite(), orNotFound(getTag(slug))]);
  return (
    <PageShell eyebrow="Tag" title={`#${d.tag.name}`}>
      <TrackMarker />
      {d.podcasts.length > 0 && (
        <>
          <h2 className="pe-section-title">Podcasts</h2>
          <PodcastGrid site={site} podcasts={d.podcasts} />
        </>
      )}
      {d.episodes.length > 0 && <h2 className="pe-section-title">Episodes</h2>}
      {d.episodes.length > 0 && <EpisodeList site={site} episodes={d.episodes.slice(0, 50)} />}
      {d.episodes.length > 50 && <p className="pe-page__lead" style={{ marginTop: 12 }}>Showing 50 of {d.episodes.length} episodes.</p>}
    </PageShell>
  );
}
