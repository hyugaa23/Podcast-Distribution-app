import type { Metadata } from 'next';
import { Artwork, Breadcrumbs, JsonLd, Prose, SocialLinks, personLd } from '@podcast/ui';
import { getHostPage, getSite } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { applyTemplate, excerpt, pageMetadata } from '@/lib/seo';
import { EpisodeList, PodcastGrid } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [site, d] = await Promise.all([getSite(), orNotFound(getHostPage(slug))]);
  return pageMetadata(site, {
    title: applyTemplate(site, `${d.host.name} — Host`),
    description: excerpt(d.host.bio) || `Podcasts and episodes with ${d.host.name}.`,
    path: `/host/${d.host.slug}`,
    image: d.host.photo_url,
  });
}

// Host profile (PRD §31): name, photo, biography, social links, website, podcasts, episodes.
export default async function HostPage({ params }: Props) {
  const { slug } = await params;
  const [site, d] = await Promise.all([getSite(), orNotFound(getHostPage(slug))]);
  const h = d.host;
  return (
    <div className="pe-wrap pe-page pe-hostpage">
      <TrackMarker />
      <Breadcrumbs baseUrl={site.base_url} items={[{ name: 'Home', href: '/' }, { name: 'Hosts', href: '/hosts' }, { name: h.name, href: `/host/${h.slug}` }]} />
      <header className="pe-hostpage__head">
        <Artwork src={h.photo_url} alt={`Photo of ${h.name}`} rounded className="pe-hostpage__photo" priority />
        <div>
          <p className="pe-page__eyebrow">Host</p>
          <h1 className="pe-page__title">{h.name}</h1>
          <Prose html={h.bio} />
          {h.website_url && <p><a href={h.website_url} rel="noopener me" target="_blank">{h.website_url.replace(/^https?:\/\//, '')}</a></p>}
          <SocialLinks links={h.social_links} />
        </div>
      </header>
      <h2 className="pe-section-title">Podcasts</h2>
      <PodcastGrid site={site} podcasts={d.podcasts} />
      {d.episodes.length > 0 && (
        <>
          <h2 className="pe-section-title">Episodes</h2>
          <EpisodeList site={site} episodes={d.episodes} />
        </>
      )}
      <JsonLd data={personLd(h, site, d.podcasts)} />
    </div>
  );
}
