import type { Metadata } from 'next';
import { Artwork, EmptyState, SearchBox } from '@podcast/ui';
import { getSite, search } from '@/lib/api';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { EpisodeList, PageShell, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { searchParams: Promise<{ q?: string; type?: string }> };

const TYPES = [
  { key: '', label: 'All' },
  { key: 'podcast', label: 'Podcasts' },
  { key: 'episode', label: 'Episodes' },
  { key: 'host', label: 'Hosts' },
  { key: 'category', label: 'Categories' },
  { key: 'tag', label: 'Tags' },
];

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const site = await getSite();
  const { q } = await searchParams;
  return pageMetadata(site, { title: applyTemplate(site, q ? `Search: ${q}` : 'Search'), path: '/search', noindex: true });
}

// Global search across podcasts, episodes, hosts, categories and tags (PRD §28).
export default async function SearchPage({ searchParams }: Props) {
  const { q = '', type = '' } = await searchParams;
  const site = await getSite();
  const r = q.trim().length >= 2 ? await search(q.trim(), type || undefined) : null;
  const total = r ? (r.podcasts?.length ?? 0) + (r.episodes?.length ?? 0) + (r.hosts?.length ?? 0) + (r.categories?.length ?? 0) + (r.tags?.length ?? 0) : 0;
  return (
    <PageShell title="Search" lead={r ? `${total} result${total === 1 ? '' : 's'} for “${q}”` : 'Search podcasts, episodes, hosts…'}>
      <TrackMarker />
      <SearchBox defaultValue={q} className="pe-search--page" />
      {r && (
        <ul className="pe-chips" aria-label="Filter results" style={{ marginTop: 16 }}>
          {TYPES.map((t) => (
            <li key={t.key}><a href={`/search?q=${encodeURIComponent(q)}${t.key ? `&type=${t.key}` : ''}`} aria-current={t.key === type ? 'page' : undefined}>{t.label}</a></li>
          ))}
        </ul>
      )}
      {r && total === 0 && <EmptyState>No results. Try a different search.</EmptyState>}
      {r?.podcasts && r.podcasts.length > 0 && (<><h2 className="pe-section-title">Podcasts</h2><PodcastGrid site={site} podcasts={r.podcasts} /></>)}
      {r?.episodes && r.episodes.length > 0 && (<><h2 className="pe-section-title">Episodes</h2><EpisodeList site={site} episodes={r.episodes} /></>)}
      {r?.hosts && r.hosts.length > 0 && (
        <>
          <h2 className="pe-section-title">Hosts</h2>
          <ul className="pe-hostgrid">
            {r.hosts.map((h) => <li key={h.id}><a href={`/host/${h.slug}`}><Artwork src={h.photo_url} alt={h.name} rounded /><span>{h.name}</span></a></li>)}
          </ul>
        </>
      )}
      {r?.categories && r.categories.length > 0 && (
        <>
          <h2 className="pe-section-title">Categories</h2>
          <ul className="pe-chips">{r.categories.map((c) => <li key={c.id}><a href={`/category/${c.slug}`}>{c.name}</a></li>)}</ul>
        </>
      )}
      {r?.tags && r.tags.length > 0 && (
        <>
          <h2 className="pe-section-title">Tags</h2>
          <ul className="pe-chips">{r.tags.map((t) => <li key={t.slug}><a href={`/tag/${t.slug}`}>#{t.name}</a></li>)}</ul>
        </>
      )}
    </PageShell>
  );
}
