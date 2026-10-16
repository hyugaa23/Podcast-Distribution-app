import type { Metadata } from 'next';
import { Breadcrumbs, Pagination } from '@podcast/ui';
import { getCategoryPage, getSite } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { pageMetadata, siteName } from '@/lib/seo';
import { EpisodeList, PageShell, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

// Category title format: Best {category} Podcasts | {site_name} (PRD §34).
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { page } = await searchParams;
  const [site, res] = await Promise.all([getSite(), orNotFound(getCategoryPage(slug, Number(page) || 1))]);
  const c = res.data.category;
  return pageMetadata(site, {
    title: `Best ${c.name} Podcasts | ${siteName(site)}`,
    description: c.description || `Discover the best ${c.name.toLowerCase()} podcasts on ${site.tenant.name}.`,
    path: `/category/${c.slug}${page && page !== '1' ? `?page=${page}` : ''}`,
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page } = await searchParams;
  const [site, res] = await Promise.all([getSite(), orNotFound(getCategoryPage(slug, Number(page) || 1))]);
  const d = res.data;
  const crumbs = [{ name: 'Home', href: '/' }, { name: 'Categories', href: '/categories' }];
  if (d.parent) crumbs.push({ name: d.parent.name, href: `/category/${d.parent.slug}` });
  crumbs.push({ name: d.category.name, href: `/category/${d.category.slug}` });
  return (
    <PageShell title={`Best ${d.category.name} Podcasts`} lead={d.category.description || `${res.meta?.total ?? d.podcasts.length} shows in ${d.category.name}`}>
      <TrackMarker />
      <Breadcrumbs items={crumbs} baseUrl={site.base_url} />
      {d.subcategories.length > 0 && (
        <ul className="pe-chips" aria-label="Subcategories">
          {d.subcategories.map((s) => <li key={s.id}><a href={`/category/${s.slug}`}>{s.name}</a></li>)}
        </ul>
      )}
      <PodcastGrid site={site} podcasts={d.podcasts} empty={`No ${d.category.name} podcasts yet.`} />
      {res.meta && <Pagination meta={res.meta} basePath={`/category/${d.category.slug}`} />}
      {d.latest_episodes.length > 0 && (
        <>
          <h2 className="pe-section-title">Latest {d.category.name} episodes</h2>
          <EpisodeList site={site} episodes={d.latest_episodes} />
        </>
      )}
    </PageShell>
  );
}
