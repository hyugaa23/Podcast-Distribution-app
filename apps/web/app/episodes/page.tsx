import type { Metadata } from 'next';
import { Pagination } from '@podcast/ui';
import { getPodcastPage, getSite, listEpisodes, listPodcastEpisodes } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { EpisodeList, PageShell } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { searchParams: Promise<{ page?: string; podcast?: string; season?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const site = await getSite();
  const { podcast } = await searchParams;
  if (podcast) {
    const p = await orNotFound(getPodcastPage(podcast));
    return pageMetadata(site, { title: `All episodes – ${p.podcast.title}`, path: `/episodes?podcast=${podcast}`, canonical: p.canonical_url, noindex: true });
  }
  return pageMetadata(site, { title: applyTemplate(site, 'Latest Episodes'), description: `New podcast episodes on ${site.tenant.name}.`, path: '/episodes' });
}

export default async function EpisodesPage({ searchParams }: Props) {
  const { page = '1', podcast, season } = await searchParams;
  const site = await getSite();
  const n = Number(page) || 1;
  if (podcast) {
    const [pp, res] = await Promise.all([orNotFound(getPodcastPage(podcast)), orNotFound(listPodcastEpisodes(podcast, n, Number(season) || undefined))]);
    return (
      <PageShell eyebrow={<a href={`/podcast/${podcast}`}>← {pp.podcast.title}</a>} title="All episodes" lead={`${res.meta?.total ?? 0} episodes`}>
        <TrackMarker podcastId={pp.podcast.id} />
        {pp.seasons.length > 1 && (
          <ul className="pe-chips" aria-label="Seasons">
            <li><a href={`/episodes?podcast=${podcast}`} aria-current={!season ? 'page' : undefined}>All seasons</a></li>
            {pp.seasons.map((s) => (
              <li key={s}><a href={`/episodes?podcast=${podcast}&season=${s}`} aria-current={String(s) === season ? 'page' : undefined}>Season {s}</a></li>
            ))}
          </ul>
        )}
        <EpisodeList site={site} episodes={res.data} showPodcast={false} />
        {res.meta && <Pagination meta={res.meta} basePath="/episodes" query={{ podcast, ...(season ? { season } : {}) }} />}
      </PageShell>
    );
  }
  const res = await listEpisodes(n);
  return (
    <PageShell title="Latest episodes" lead={`Fresh episodes from every show on ${site.tenant.name}.`}>
      <TrackMarker />
      <EpisodeList site={site} episodes={res.data} />
      {res.meta && <Pagination meta={res.meta} basePath="/episodes" />}
    </PageShell>
  );
}
