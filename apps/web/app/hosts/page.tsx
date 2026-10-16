import type { Metadata } from 'next';
import { Artwork, EmptyState } from '@podcast/ui';
import { getSite, listHosts } from '@/lib/api';
import { applyTemplate, pageMetadata } from '@/lib/seo';
import { PageShell } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return pageMetadata(site, { title: applyTemplate(site, 'Hosts'), description: `Meet the hosts of ${site.tenant.name}.`, path: '/hosts' });
}

export default async function HostsPage() {
  const [site, hosts] = await Promise.all([getSite(), listHosts()]);
  return (
    <PageShell title="Hosts" lead={`The voices behind ${site.tenant.name}.`}>
      <TrackMarker />
      {hosts.length === 0 ? <EmptyState>No hosts yet.</EmptyState> : (
        <ul className="pe-hostgrid">
          {hosts.map((h) => (
            <li key={h.id}><a href={`/host/${h.slug}`}><Artwork src={h.photo_url} alt={h.name} rounded /><span>{h.name}</span></a></li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
