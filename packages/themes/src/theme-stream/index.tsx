// Theme 01 — Stream Dark (PRD §41): dark UI, large artwork, horizontal content rows,
// persistent bottom player, compact navigation.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { HomepageSection, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, episodeHref, episodeLabel, formatDate, formatDuration, hostHref, plural, podcastHref,
  categoryHref, collectionHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { StreamPlayer } from './Player';

const NAV_ICON: Record<string, string> = { home: '⌂', podcasts: '◎', episodes: '▶', categories: '▦', hosts: '☺', collections: '★', about: 'ⓘ', search: '⌕', custom: '↗' };

function Layout({ site, children }: LayoutProps) {
  return (
    <div className="ts-shell">
      <aside className="ts-side" data-nav>
        <div className="ts-side__top">
          <a href="/" className="ts-brand" aria-label={`${siteName(site)} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={siteName(site)} className="ts-brand__logo" />
              : <span className="ts-brand__mark" aria-hidden="true">{siteName(site).slice(0, 1)}</span>}
            <span className="ts-brand__name">{siteName(site)}</span>
          </a>
          <NavToggle />
        </div>
        <nav aria-label="Main" className="ts-nav">
          <ul>
            {navItems(site).map((n) => (
              <li key={n.href + n.label}>
                <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  <span className="ts-nav__icon" aria-hidden="true">{NAV_ICON[n.type] ?? '•'}</span>
                  <span>{n.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ts-side__foot">
          <SocialLinks links={site.branding.social_links} />
          <p>{footerText(site)}</p>
        </div>
      </aside>
      <div className="ts-main">
        <header className="ts-topbar">
          <SearchBox className="ts-search" />
        </header>
        <main id="main">{children}</main>
        <footer className="ts-footer">
          <p>{footerText(site)}</p>
          {site.branding.tagline && <p className="ts-muted">{site.branding.tagline}</p>}
        </footer>
      </div>
      <StreamPlayer site={site} />
    </div>
  );
}

function PodcastCard({ podcast }: PodcastCardProps) {
  return (
    <article className="ts-card">
      <a href={podcastHref(podcast)} className="ts-card__link">
        <div className="ts-card__art">
          <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} />
        </div>
        <h3 className="ts-card__title">{podcast.title}</h3>
        <p className="ts-card__sub">{podcast.author || podcast.category?.name}</p>
      </a>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  return (
    <article className="ts-ep">
      <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" className="ts-ep__art" size={64} />
      <div className="ts-ep__body">
        <a href={episodeHref(episode)} className="ts-ep__title">{episode.title}</a>
        {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="ts-ep__podcast">{episode.podcast_title}</a>}
        <p className="ts-ep__meta">
          {episode.explicit && <span className="ts-badge" title="Explicit">E</span>}
          {[episodeLabel(episode), formatDate(episode.published_at, 'en', 'short'), formatDuration(episode.duration)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <EpisodePlayButton episode={episode} className="ts-ep__play" />
    </article>
  );
}

function Row({ title, href, podcasts }: { title: string; href?: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="ts-row" aria-label={title}>
      <div className="ts-row__head">
        <h2>{title}</h2>
        {href && <a href={href}>Show all</a>}
      </div>
      <div className="ts-row__track">
        {podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}
      </div>
    </section>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero': {
      const p = home.featured[0];
      if (!p) return null;
      return (
        <section className="ts-hero" style={{ ['--hero-img' as string]: `url(${p.banner_url || p.artwork_url})` }} aria-label="Featured">
          <div className="ts-hero__bg" aria-hidden="true" />
          <div className="ts-hero__content">
            <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="ts-hero__art" priority />
            <div>
              <p className="ts-eyebrow">Featured podcast</p>
              <h1 className="ts-hero__title">{p.title}</h1>
              <p className="ts-hero__desc">{p.short_description}</p>
              <div className="ts-hero__actions">
                <a className="ts-btn ts-btn--primary" href={podcastHref(p)}>Listen now</a>
                <a className="ts-btn" href="/podcasts">Browse all</a>
              </div>
            </div>
          </div>
        </section>
      );
    }
    case 'featured': case 'trending': case 'popular': case 'editors_picks': case 'new_podcasts':
      return <Row title={sectionTitle(s)} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="ts-row" aria-label={sectionTitle(s)}>
          <div className="ts-row__head"><h2>{sectionTitle(s)}</h2><a href="/episodes">Show all</a></div>
          <div className="ts-eplist ts-eplist--grid">{eps.map((e) => <EpisodeCard key={e.id} episode={e} />)}</div>
        </section>
      );
    }
    case 'categories':
      if (home.categories.length === 0) return null;
      return (
        <section className="ts-row" aria-label={sectionTitle(s)}>
          <div className="ts-row__head"><h2>{sectionTitle(s)}</h2><a href="/categories">Show all</a></div>
          <ul className="ts-cats">
            {home.categories.slice(0, s.limit || 12).map((c, i) => (
              <li key={c.id} style={{ ['--hue' as string]: `${(i * 53) % 360}` }}>
                <a href={categoryHref(c.slug)}><span>{c.name}</span><small>{plural(c.podcast_count, 'show')}</small></a>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'collections':
      return (
        <>
          {home.collections.map((c) => <Row key={c.id} title={c.title} href={collectionHref(c.slug)} podcasts={c.podcasts} />)}
        </>
      );
    case 'newsletter':
      return (
        <section className="ts-banner" aria-label={sectionTitle(s)}>
          <h2>{sectionTitle(s)}</h2>
          <p>{s.subtitle || `Follow ${siteName(site)} on social media for every new release.`}</p>
          <SocialLinks links={site.branding.social_links} className="ts-banner__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="ts-banner" aria-label="Call to action">
          <h2>{s.title || 'Never miss an episode'}</h2>
          {s.subtitle && <p>{s.subtitle}</p>}
          <a className="ts-btn ts-btn--primary" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  return (
    <div className="ts-home">
      {enabledSections(props.site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

function PodcastPage({ site, page }: PodcastPageProps) {
  const p = page.podcast;
  return (
    <article className="ts-show">
      <header className="ts-show__head">
        <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="ts-show__art" priority />
        <div className="ts-show__info">
          <p className="ts-eyebrow">Podcast{p.category && <> · <a href={categoryHref(p.category.slug)}>{p.category.name}</a></>}</p>
          <h1 className="ts-show__title">{p.title}</h1>
          <p className="ts-show__by">
            {p.hosts.length > 0
              ? p.hosts.map((h, i) => <span key={h.id}>{i > 0 && ', '}<a href={hostHref(h.slug)}>{h.name}</a></span>)
              : p.author}
            {' · '}{plural(page.episodes_total, 'episode')}{p.explicit && <span className="ts-badge" title="Explicit">E</span>}
          </p>
        </div>
      </header>
      <div className="ts-show__actions">
        {page.latest_episode && <EpisodePlayButton episode={page.latest_episode} variant="pill" label="Play latest" className="ts-bigplay" />}
        <SubscribeButton feedUrl={page.feed_url}>Follow</SubscribeButton>
        <ShareButtons url={page.canonical_url} title={p.title} />
      </div>
      <div className="ts-show__grid">
        <section aria-labelledby="eps">
          <h2 id="eps" className="ts-h2">All episodes</h2>
          {page.seasons.length > 1 && (
            <p className="ts-muted">Seasons: {page.seasons.map((n) => `S${n}`).join(', ')}</p>
          )}
          <div className="ts-eplist">
            {page.episodes.map((e) => <EpisodeCard key={e.id} episode={e} showPodcast={false} />)}
          </div>
          {page.episodes_total > page.episodes.length && (
            <a className="ts-btn" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total} episodes</a>
          )}
        </section>
        <aside className="ts-show__aside">
          <section className="ts-panel">
            <h2 className="ts-h3">About</h2>
            <Prose html={p.description} />
            <TagList tags={p.tags} />
          </section>
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="ts-panel" />
          {p.hosts.length > 0 && (
            <section className="ts-panel">
              <h2 className="ts-h3">Hosts</h2>
              <ul className="ts-hosts">
                {p.hosts.map((h) => (
                  <li key={h.id}><a href={hostHref(h.slug)}><Artwork src={h.photo_url} alt={h.name} rounded size={44} /><span>{h.name}</span></a></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      <Row title="You might also like" podcasts={page.related} />
    </article>
  );
}

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  return (
    <article className="ts-episode">
      <header className="ts-show__head">
        <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} className="ts-show__art" priority />
        <div className="ts-show__info">
          <p className="ts-eyebrow">Episode{episodeLabel(e) && ` · ${episodeLabel(e)}`}</p>
          <h1 className="ts-show__title ts-show__title--ep">{e.title}</h1>
          <p className="ts-show__by"><a href={podcastHref(p)}>{p.title}</a></p>
          <p className="ts-muted">
            <time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, site.tenant.language)}</time>
            {e.duration > 0 && ` · ${formatDuration(e.duration)}`}{e.explicit && <span className="ts-badge" title="Explicit">E</span>}
          </p>
        </div>
      </header>
      <div className="ts-show__actions">
        <EpisodePlayButton episode={e} variant="pill" className="ts-bigplay" />
        <DownloadLink episode={e} className="ts-btn">Download</DownloadLink>
        <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} />
      </div>
      <div className="ts-show__grid">
        <div>
          <section className="ts-panel" aria-labelledby="about-ep">
            <h2 id="about-ep" className="ts-h2">About this episode</h2>
            <Prose html={e.description} />
            <Prose html={e.show_notes} className="ts-notes" />
            <TagList tags={e.tags} />
          </section>
          <KeyTopics topics={e.key_topics} />
          <Transcript episode={e} className="ts-panel" />
          <FAQ items={e.faq} />
          <Citations items={e.citations} />
        </div>
        <aside className="ts-show__aside">
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="ts-panel" />
          {e.hosts.length > 0 && (
            <section className="ts-panel">
              <h2 className="ts-h3">Guests</h2>
              <ul className="ts-hosts">{e.hosts.map((h) => <li key={h.id}><a href={hostHref(h.slug)}><Artwork src={h.photo_url} alt={h.name} rounded size={44} /><span>{h.name}</span></a></li>)}</ul>
            </section>
          )}
          <nav className="ts-panel ts-prevnext" aria-label="More episodes">
            {page.previous && <a href={episodeHref(page.previous)}>← {page.previous.title}</a>}
            {page.next && <a href={episodeHref(page.next)}>{page.next.title} →</a>}
          </nav>
        </aside>
      </div>
      {page.more.length > 0 && (
        <section className="ts-row" aria-label="More from this show">
          <div className="ts-row__head"><h2>More from {p.title}</h2><a href={podcastHref(p)}>See all</a></div>
          <div className="ts-eplist ts-eplist--grid">{page.more.map((m) => <EpisodeCard key={m.id} episode={m} showPodcast={false} />)}</div>
        </section>
      )}
    </article>
  );
}

export const streamTheme: Theme = {
  key: 'stream',
  name: 'Stream Dark',
  Layout,
  Player: StreamPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'ts-grid',
  episodeListClass: 'ts-eplist',
};
