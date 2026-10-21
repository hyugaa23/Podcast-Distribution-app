// JSON-LD builders (PRD §35): PodcastSeries, PodcastEpisode, Person, Organization, WebSite + SearchAction.
import type { EpisodePageData, HostDetail, Podcast, PodcastPageData, Site } from '@podcast/types';
import { isoDuration } from './format';

const strip = (html?: string) => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function organizationLd(site: Site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.base_url}/#organization`,
    name: site.seo.organization_name || site.tenant.name,
    url: site.base_url,
    ...(site.seo.organization_logo || site.branding.logo_url ? { logo: site.seo.organization_logo || site.branding.logo_url } : {}),
    sameAs: Object.values(site.branding.social_links ?? {}).filter(Boolean),
  };
}

export function websiteLd(site: Site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site.base_url}/#website`,
    name: site.seo.site_title || site.tenant.name,
    url: site.base_url,
    inLanguage: site.tenant.language,
    publisher: { '@id': `${site.base_url}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.base_url}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

function seriesRef(p: Podcast, site: Site, url?: string) {
  return {
    '@type': 'PodcastSeries',
    name: p.title,
    url: url ?? `${site.base_url}/podcast/${p.slug}`,
  };
}

export function podcastSeriesLd(page: PodcastPageData, site: Site) {
  const p = page.podcast;
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    '@id': `${page.canonical_url}#series`,
    name: p.title,
    description: strip(p.description) || p.short_description,
    url: page.canonical_url,
    image: p.artwork_url || undefined,
    inLanguage: p.language,
    webFeed: page.feed_url,
    genre: p.categories.map((c) => c.name),
    keywords: p.tags.join(', ') || undefined,
    author: p.hosts.length
      ? p.hosts.map((h) => ({ '@type': 'Person', name: h.name, url: `${site.base_url}/host/${h.slug}` }))
      : { '@type': 'Person', name: p.author },
    publisher: { '@id': `${site.base_url}/#organization` },
    sameAs: page.listen_on.map((l) => l.url),
    ...(page.latest_episode?.published_at ? { dateModified: page.latest_episode.published_at } : {}),
  };
}

export function podcastEpisodeLd(page: EpisodePageData, site: Site) {
  const e = page.episode;
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    '@id': `${page.canonical_url}#episode`,
    name: e.title,
    url: page.canonical_url,
    description: strip(e.description) || e.short_description,
    datePublished: e.published_at ?? undefined,
    dateModified: e.updated_at,
    timeRequired: e.duration ? isoDuration(e.duration) : undefined,
    episodeNumber: e.episode_number ?? undefined,
    ...(e.season_number ? { partOfSeason: { '@type': 'PodcastSeason', seasonNumber: e.season_number } } : {}),
    image: e.artwork_url || e.podcast_artwork_url || undefined,
    inLanguage: page.podcast.language,
    keywords: (e.key_topics ?? e.tags).join(', ') || undefined,
    associatedMedia: {
      '@type': 'MediaObject',
      contentUrl: e.audio_url,
      encodingFormat: e.audio_mime || 'audio/mpeg',
      ...(e.duration ? { duration: isoDuration(e.duration) } : {}),
      ...(e.audio_size ? { contentSize: String(e.audio_size) } : {}),
    },
    partOfSeries: seriesRef(page.podcast, site),
    ...(e.hosts.length || page.podcast.hosts.length
      ? { actor: [...page.podcast.hosts, ...e.hosts].map((h) => ({ '@type': 'Person', name: h.name, url: `${site.base_url}/host/${h.slug}` })) }
      : {}),
    ...(e.transcript ? { transcript: strip(e.transcript).slice(0, 5000) } : {}),
  };
}

export function faqLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  };
}

export function personLd(host: HostDetail, site: Site, podcasts: Podcast[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: host.name,
    url: `${site.base_url}/host/${host.slug}`,
    image: host.photo_url || undefined,
    description: strip(host.bio) || undefined,
    sameAs: [host.website_url, ...Object.values(host.social_links ?? {})].filter(Boolean),
    ...(podcasts.length ? { subjectOf: podcasts.map((p) => seriesRef(p, site)) } : {}),
  };
}
