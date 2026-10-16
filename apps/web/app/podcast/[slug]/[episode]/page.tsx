import type { Metadata } from 'next';
import { getTheme } from '@podcast/themes';
import { Breadcrumbs, JsonLd, faqLd, podcastEpisodeLd } from '@podcast/ui';
import { getEpisodePage, getSite } from '@/lib/api';
import { orNotFound } from '@/lib/guard';
import { excerpt, pageMetadata } from '@/lib/seo';
import { TrackMarker } from '@/components/TrackMarker';

type Props = { params: Promise<{ slug: string; episode: string }> };

// Episode title format: {episode_title} – {podcast_title} (PRD §34); SEO title/meta/canonical overrides per episode.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, episode } = await params;
  const [site, page] = await Promise.all([getSite(), orNotFound(getEpisodePage(slug, episode))]);
  const e = page.episode;
  return pageMetadata(site, {
    title: e.seo_title || `${e.title} – ${page.podcast.title}`,
    description: e.meta_description || e.short_description || excerpt(e.description),
    path: `/podcast/${slug}/${e.slug}`,
    canonical: page.canonical_url,
    image: e.artwork_url || page.podcast.artwork_url,
    type: 'article',
    publishedTime: e.published_at,
    audio: e.audio_url,
  });
}

export default async function EpisodePage({ params }: Props) {
  const { slug, episode } = await params;
  const [site, page] = await Promise.all([getSite(), orNotFound(getEpisodePage(slug, episode))]);
  const theme = getTheme(site.theme.key);
  const e = page.episode;
  return (
    <>
      <TrackMarker podcastId={page.podcast.id} episodeId={e.id} />
      <div className="pe-wrap pe-crumbs-wrap">
        <Breadcrumbs
          baseUrl={site.base_url}
          items={[
            { name: 'Home', href: '/' },
            { name: page.podcast.title, href: `/podcast/${page.podcast.slug}` },
            { name: e.title, href: `/podcast/${page.podcast.slug}/${e.slug}` },
          ]}
        />
      </div>
      <theme.EpisodePage site={site} page={page} />
      <JsonLd data={podcastEpisodeLd(page, site)} />
      {e.faq && e.faq.length > 0 && <JsonLd data={faqLd(e.faq)} />}
    </>
  );
}
