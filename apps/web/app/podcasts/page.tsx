import type { Metadata } from 'next';
import { Pagination } from '@podcast/ui';
import { getSite, listPodcasts } from '@/lib/api';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { PageShell, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { searchParams: Promise<{ page?: string; sort?: string }> };

const SORTS = [
  { key: '', label: 'Recently updated' },
  { key: 'new', label: 'New' },
  { key: 'title', label: 'A–Z' },
];

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const site = await getSite();
  const { page } = await searchParams;
  return pageMetadata(site, {
    title: applyTemplate(site, 'All Podcasts'),
    description: `Browse every podcast on ${site.tenant.name}.`,
    path: page && page !== '1' ? `/podcasts?page=${page}` : '/podcasts',
  });
}

export default async function PodcastsPage({ searchParams }: Props) {
  const { page = '1', sort = '' } = await searchParams;
  const [site, res] = await Promise.all([getSite(), listPodcasts(Number(page) || 1, sort)]);
  return (
    <PageShell title="Podcasts" lead={`${res.meta?.total ?? res.data.length} shows on ${site.tenant.name}`}>
      <TrackMarker />
      <ul className="pe-chips" aria-label="Sort podcasts">
        {SORTS.map((s) => (
          <li key={s.key}><a href={s.key ? `/podcasts?sort=${s.key}` : '/podcasts'} aria-current={s.key === sort ? 'page' : undefined}>{s.label}</a></li>
        ))}
      </ul>
      <PodcastGrid site={site} podcasts={res.data} />
      {res.meta && <Pagination meta={res.meta} basePath="/podcasts" query={sort ? { sort } : {}} />}
    </PageShell>
  );
}
