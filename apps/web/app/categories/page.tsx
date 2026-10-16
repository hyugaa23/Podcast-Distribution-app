import type { Metadata } from 'next';
import { plural } from '@podcast/ui';
import { getSite, listCategories } from '@/lib/api';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { PageShell } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return pageMetadata(site, { title: applyTemplate(site, 'Podcast Categories'), description: `Browse podcasts by category on ${site.tenant.name}.`, path: '/categories' });
}

export default async function CategoriesPage() {
  const [site, cats] = await Promise.all([getSite(), listCategories()]);
  return (
    <PageShell title="Categories" lead={`Explore ${site.tenant.name} by topic.`}>
      <TrackMarker />
      <ul className="pe-catgrid">
        {cats.map((c) => (
          <li key={c.id}>
            <a href={`/category/${c.slug}`}>
              <strong>{c.name}</strong>
              <span>{plural(c.podcast_count, 'podcast')}</span>
            </a>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
