// Theme 09 — Entertainment (PRD §49): bold, large imagery, colourful, trending-first,
// high visual energy. Loud top bar with gradient underline, giant "Trending now" hero,
// poster grids, numbered top charts, neon category blocks and a floating pill player.
import type { CSSProperties } from 'react';
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Collection, Episode, HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, categoryHref, collectionHref, episodeHref, episodeLabel, formatDate, formatDuration,
  hostHref, plural, podcastHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { EntertainmentPlayer } from './Player';

/** Three-colour cycle used to make cards/tiles loud and varied. */
const TONES = ['var(--c-primary)', 'var(--c-secondary)', 'var(--c-accent)'];
const tone = (i = 0): CSSProperties => ({ ['--tx-tone' as string]: TONES[i % TONES.length] });
const bgImage = (src?: string | null): CSSProperties => (src ? { ['--tx-img' as string]: `url("${src}")` } : {});

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  return (
    <div className="tx-shell">
      <header className="tx-top" data-nav>
        <div className="tx-top__bar">
          <a href="/" className="tx-logo" aria-label={`${name} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={name} className="tx-logo__img" />
              : <><span className="tx-logo__star" aria-hidden="true">★</span><span className="tx-logo__text">{name}</span></>}
          </a>
          <nav aria-label="Main" className="tx-nav">
            <ul>
              {navItems(site).map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <SearchBox className="tx-search" placeholder="Search shows, episodes, hosts…" />
          <NavToggle className="tx-navtoggle" />
        </div>
        <div className="tx-top__stripe" aria-hidden="true" />
      </header>
      <main id="main" className="tx-main">{children}</main>
      <footer className="tx-foot">
        <div className="tx-foot__inner">
          <p className="tx-foot__name" aria-hidden="true">{name}</p>
          {site.branding.tagline && <p className="tx-foot__tag">{site.branding.tagline}</p>}
          <SocialLinks links={site.branding.social_links} className="tx-foot__social" />
          <p className="tx-foot__legal">{footerText(site)}</p>
        </div>
      </footer>
      <EntertainmentPlayer site={site} />
    </div>
  );
}

/* ---------- Cards ---------- */

function PodcastCard({ podcast, index = 0 }: PodcastCardProps) {
  return (
    <article className="tx-poster" style={tone(index)}>
      <a href={podcastHref(podcast)} className="tx-poster__link">
        <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} className="tx-poster__art" />
        <span className="tx-poster__shade" aria-hidden="true" />
        <div className="tx-poster__body">
          {podcast.category && <span className="tx-pill tx-pill--tone">{podcast.category.name}</span>}
          <h3 className="tx-poster__title">{podcast.title}</h3>
          <span className="tx-poster__sub">{podcast.author || plural(podcast.episode_count, 'episode')}</span>
        </div>
        {podcast.explicit && <span className="tx-poster__e" title="Explicit">E<span className="pe-sr-only">xplicit</span></span>}
      </a>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true, index = 0 }: EpisodeCardProps) {
  const meta = [episodeLabel(episode), formatDuration(episode.duration)].filter(Boolean).join(' · ');
  return (
    <article className="tx-tile" style={tone(index)}>
      <div className="tx-tile__media">
        <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" className="tx-tile__art" />
        <EpisodePlayButton episode={episode} className="tx-tile__play" />
      </div>
      <div className="tx-tile__body">
        {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="tx-tile__show">{episode.podcast_title}</a>}
        <h3 className="tx-tile__title"><a href={episodeHref(episode)}>{episode.title}</a></h3>
        {episode.short_description && <p className="tx-tile__desc">{episode.short_description}</p>}
        <p className="tx-tile__meta">
          {episode.published_at && <time dateTime={episode.published_at}>{formatDate(episode.published_at, 'en', 'short')}</time>}
          {meta && <span>{meta}</span>}
          {episode.explicit && <span className="tx-badge-e" title="Explicit">E<span className="pe-sr-only">xplicit</span></span>}
        </p>
      </div>
    </article>
  );
}

/* ---------- Building blocks ---------- */

function SectionHead({ title, href, linkLabel = 'See all', kicker }: { title: string; href?: string; linkLabel?: string; kicker?: string }) {
  return (
    <div className="tx-head">
      <div>
        {kicker && <p className="tx-kicker">{kicker}</p>}
        <h2 className="tx-head__title">{title}</h2>
      </div>
      {href && <a className="tx-head__more" href={href}>{linkLabel} <span aria-hidden="true">→</span></a>}
    </div>
  );
}

function PosterGrid({ title, href, podcasts, lead, kicker }: { title: string; href?: string; podcasts: Podcast[]; lead?: boolean; kicker?: string }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tx-sec" aria-label={title}>
      <SectionHead title={title} href={href} kicker={kicker} />
      <div className={`tx-posters ${lead ? 'tx-posters--lead' : ''}`}>
        {podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}
      </div>
    </section>
  );
}

function TopChart({ title, podcasts }: { title: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tx-sec" aria-label={title}>
      <SectionHead title={title} href="/podcasts" kicker="The chart" />
      <ol className="tx-chart">
        {podcasts.map((p, i) => (
          <li key={p.id} className="tx-chart__item" style={tone(i)}>
            <a href={podcastHref(p)} className="tx-chart__link">
              <span className="tx-chart__num" aria-hidden="true">{i + 1}</span>
              <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tx-chart__art" size={88} />
              <span className="tx-chart__info">
                <span className="tx-chart__title">{p.title}</span>
                <span className="tx-chart__sub">{[p.category?.name, p.author].filter(Boolean).join(' · ')}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TrendingHero({ site, home }: HomeProps) {
  const list = home.trending.length > 0 ? home.trending : home.featured;
  const top = list[0];
  if (!top) return null;
  const rest = list.slice(1, 5);
  return (
    <section className="tx-trend" aria-labelledby="tx-trend-title">
      <p className="tx-trend__label" aria-hidden="true"><span>Trending</span> <span>now</span></p>
      <div className={`tx-trend__grid${rest.length < 3 ? ' tx-trend__grid--wide' : ''}`}>
        <article className="tx-trend__top" style={bgImage(top.banner_url || top.artwork_url)}>
          <div className="tx-trend__bg" aria-hidden="true" />
          <span className="tx-trend__rank" aria-hidden="true">#1</span>
          <div className="tx-trend__content">
            <Artwork src={top.artwork_url} alt={`${top.title} artwork`} className="tx-trend__art" priority />
            <div className="tx-trend__text">
              <p className="tx-kicker tx-kicker--light">
                <span className="pe-sr-only">Trending number 1 · </span>
                {top.category ? <a href={categoryHref(top.category.slug)} className="tx-pill tx-pill--hot">{top.category.name}</a> : <span className="tx-pill tx-pill--hot">#1 on {siteName(site)}</span>}
              </p>
              <h1 id="tx-trend-title" className="tx-trend__title">{top.title}</h1>
              {top.short_description && <p className="tx-trend__desc">{top.short_description}</p>}
              <div className="tx-actions">
                <a className="tx-btn tx-btn--mega" href={podcastHref(top)}>
                  <span className="tx-btn__icon" aria-hidden="true">▶</span> Listen now
                </a>
                <a className="tx-btn tx-btn--ghost" href="/podcasts">Browse all</a>
              </div>
            </div>
          </div>
        </article>
        {rest.length > 0 && (
          <ol className="tx-trend__rest" start={2} aria-label="Also trending">
            {rest.map((p, i) => (
              <li key={p.id} style={tone(i + 1)}>
                <a href={podcastHref(p)} className="tx-runner">
                  <span className="tx-runner__num" aria-hidden="true">{i + 2}</span>
                  <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tx-runner__art" />
                  <span className="tx-runner__info">
                    <span className="tx-runner__title">{p.title}</span>
                    <span className="tx-runner__sub">{p.category?.name || p.author}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
      {(home.stats.podcasts > 0 || home.stats.episodes > 0) && (
        <ul className="tx-stats" aria-label="Catalogue">
          <li><strong>{home.stats.podcasts.toLocaleString('en')}</strong> shows</li>
          <li><strong>{home.stats.episodes.toLocaleString('en')}</strong> episodes</li>
        </ul>
      )}
    </section>
  );
}

function CollectionBanner({ c, index }: { c: Collection; index: number }) {
  const cover = c.cover_url || c.podcasts[0]?.banner_url || c.podcasts[0]?.artwork_url;
  return (
    <article className="tx-banner" style={{ ...tone(index), ...bgImage(cover) }}>
      <div className="tx-banner__bg" aria-hidden="true" />
      <div className="tx-banner__content">
        <p className="tx-kicker tx-kicker--light">Collection · {plural(c.podcasts.length, 'show')}</p>
        <h3 className="tx-banner__title"><a href={collectionHref(c.slug)}>{c.title}</a></h3>
        {c.description && <p className="tx-banner__desc">{c.description}</p>}
        <a className="tx-btn tx-btn--light" href={collectionHref(c.slug)} aria-label={`Open collection ${c.title}`}>Open collection</a>
      </div>
      {c.podcasts.length > 0 && (
        <ul className="tx-banner__stack" aria-label={`Shows in ${c.title}`}>
          {c.podcasts.slice(0, 4).map((p) => (
            <li key={p.id}><a href={podcastHref(p)}><Artwork src={p.artwork_url} alt={p.title} /></a></li>
          ))}
        </ul>
      )}
    </article>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero':
      return <TrendingHero site={site} home={home} />;
    case 'trending':
      return <TopChart title={sectionTitle(s)} podcasts={sectionPodcasts(home, s.type, s.limit || 10)} />;
    case 'featured':
      return <PosterGrid title={sectionTitle(s)} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)} lead kicker="Spotlight" />;
    case 'popular': case 'editors_picks': case 'new_podcasts':
      return (
        <PosterGrid
          title={sectionTitle(s)} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)}
          kicker={s.type === 'popular' ? 'Fan favourites' : s.type === 'editors_picks' ? 'Hand-picked' : 'Fresh drops'}
        />
      );
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="tx-sec" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} href="/episodes" kicker="Just dropped" />
          <div className="tx-tiles">{eps.map((e, i) => <EpisodeCard key={e.id} episode={e} index={i} />)}</div>
        </section>
      );
    }
    case 'categories':
      if (home.categories.length === 0) return null;
      return (
        <section className="tx-sec" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} href="/categories" kicker="Pick a vibe" />
          <ul className="tx-cats">
            {home.categories.slice(0, s.limit || 12).map((c, i) => (
              <li key={c.id} style={{ ['--hue' as string]: `${(i * 67 + 300) % 360}` }}>
                <a href={categoryHref(c.slug)}>
                  <span className="tx-cats__name">{c.name}</span>
                  <span className="tx-cats__count">{plural(c.podcast_count, 'show')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'collections':
      if (home.collections.length === 0) return null;
      return (
        <section className="tx-sec" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} kicker="Binge-worthy" />
          <div className="tx-banners">
            {home.collections.slice(0, s.limit || home.collections.length).map((c, i) => <CollectionBanner key={c.id} c={c} index={i} />)}
          </div>
        </section>
      );
    case 'newsletter':
      return (
        <section className="tx-shout" aria-label={sectionTitle(s)}>
          <h2 className="tx-shout__title">{sectionTitle(s)}</h2>
          <p>{s.subtitle || `Follow ${siteName(site)} for every new drop, first.`}</p>
          <SocialLinks links={site.branding.social_links} className="tx-shout__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="tx-shout tx-shout--cta" aria-label="Call to action">
          <h2 className="tx-shout__title">{s.title || 'Press play on something new'}</h2>
          {s.subtitle && <p>{s.subtitle}</p>}
          <a className="tx-btn tx-btn--dark" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  return (
    <div className="tx-home">
      {enabledSections(props.site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

/* ---------- Podcast page ---------- */

function HostList({ hosts, title }: { hosts: HostRef[]; title: string }) {
  if (hosts.length === 0) return null;
  return (
    <section className="tx-card" aria-label={title}>
      <h2 className="tx-card__title">{title}</h2>
      <ul className="tx-hosts">
        {hosts.map((h) => (
          <li key={h.id}>
            <a href={hostHref(h.slug)}>
              <Artwork src={h.photo_url} alt={h.name} rounded size={52} />
              <span><strong>{h.name}</strong>{h.role && <small>{h.role}</small>}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PodcastPage({ site, page }: PodcastPageProps) {
  const p = page.podcast;
  const cats = p.categories.length > 0 ? p.categories : p.category ? [p.category] : [];
  const latest = page.latest_episode;
  return (
    <article className="tx-show">
      <header className="tx-stage" style={bgImage(p.banner_url || p.artwork_url)}>
        <div className="tx-stage__bg" aria-hidden="true" />
        <div className="tx-stage__inner">
          <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tx-stage__art" priority />
          <div className="tx-stage__text">
            {cats.length > 0 && (
              <ul className="tx-pills" aria-label="Categories">
                {cats.map((c, i) => (
                  <li key={c.id} style={tone(i)}><a className="tx-pill tx-pill--tone" href={categoryHref(c.slug)}>{c.name}</a></li>
                ))}
              </ul>
            )}
            <h1 className="tx-stage__title">{p.title}</h1>
            <p className="tx-stage__by">
              {p.hosts.length > 0
                ? <>Hosted by {p.hosts.map((h, i) => <span key={h.id}>{i > 0 && ', '}<a href={hostHref(h.slug)}>{h.name}</a></span>)}</>
                : p.author}
            </p>
            <ul className="tx-badges" aria-label="Show stats">
              <li><strong>{page.episodes_total}</strong> {page.episodes_total === 1 ? 'episode' : 'episodes'}</li>
              {page.seasons.length > 1 && <li><strong>{page.seasons.length}</strong> seasons</li>}
              {p.latest_episode_at && <li>Latest <time dateTime={p.latest_episode_at}>{formatDate(p.latest_episode_at, site.tenant.language, 'short')}</time></li>}
              <li>{p.podcast_type === 'serial' ? 'Serial' : 'Episodic'}</li>
              {p.explicit && <li className="tx-badges__e">Explicit</li>}
            </ul>
            <div className="tx-actions">
              {latest && <EpisodePlayButton episode={latest} variant="pill" label="Play latest" className="tx-megaplay" />}
              <SubscribeButton feedUrl={page.feed_url} className="tx-sub">Follow</SubscribeButton>
            </div>
          </div>
        </div>
      </header>

      <div className="tx-split">
        <div className="tx-split__main">
          {latest && (
            <section className="tx-sec tx-sec--tight" aria-labelledby="tx-latest">
              <h2 id="tx-latest" className="tx-head__title tx-head__title--sm">Latest drop</h2>
              <div className="tx-tiles tx-tiles--list tx-tiles--hero"><EpisodeCard episode={latest} showPodcast={false} index={2} /></div>
            </section>
          )}
          <section className="tx-sec" aria-labelledby="tx-eps">
            <div className="tx-head">
              <h2 id="tx-eps" className="tx-head__title">All episodes</h2>
              {page.seasons.length > 1 && <p className="tx-muted">Seasons {page.seasons.join(', ')}</p>}
            </div>
            <div className="tx-tiles tx-tiles--list">
              {page.episodes.map((e, i) => <EpisodeCard key={e.id} episode={e} showPodcast={false} index={i} />)}
            </div>
            {page.episodes_total > page.episodes.length && (
              <p className="tx-center"><a className="tx-btn tx-btn--grad" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total} episodes</a></p>
            )}
          </section>
        </div>
        <aside className="tx-split__aside">
          <section className="tx-card" aria-labelledby="tx-about">
            <h2 id="tx-about" className="tx-card__title">About the show</h2>
            <Prose html={p.description || p.short_description} />
            <TagList tags={p.tags} className="tx-tags" />
          </section>
          <HostList hosts={p.hosts} title="Hosts" />
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tx-card" />
          <section className="tx-card" aria-labelledby="tx-share">
            <h2 id="tx-share" className="tx-card__title">Share the show</h2>
            <ShareButtons url={page.canonical_url} title={p.title} className="tx-share" />
          </section>
        </aside>
      </div>

      <PosterGrid title="More like this" podcasts={page.related} kicker="If you liked this" />
    </article>
  );
}

/* ---------- Episode page ---------- */

function UpNext({ ep, label }: { ep: Episode; label: string }) {
  return (
    <a href={episodeHref(ep)} className="tx-upnext" style={bgImage(ep.artwork_url || ep.podcast_artwork_url)}>
      <span className="tx-upnext__bg" aria-hidden="true" />
      <span className="tx-upnext__label">{label}</span>
      <span className="tx-upnext__title">{ep.title}</span>
      <span className="tx-upnext__meta">{[episodeLabel(ep), formatDuration(ep.duration)].filter(Boolean).join(' · ')}</span>
    </a>
  );
}

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const guestIds = new Set(e.hosts.map((h) => h.id));
  const showHosts = p.hosts.filter((h) => !guestIds.has(h.id));
  const label = episodeLabel(e);
  return (
    <article className="tx-epi">
      <header className="tx-stage tx-stage--ep" style={bgImage(e.artwork_url || p.banner_url || p.artwork_url)}>
        <div className="tx-stage__bg" aria-hidden="true" />
        <div className="tx-stage__inner">
          <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} className="tx-stage__art tx-stage__art--poster" priority />
          <div className="tx-stage__text">
            <ul className="tx-pills" aria-label="Episode">
              <li style={tone(0)}><a className="tx-pill tx-pill--tone" href={podcastHref(p)}>{p.title}</a></li>
              {label && <li><span className="tx-pill">{label}</span></li>}
              {p.category && <li style={tone(2)}><a className="tx-pill tx-pill--tone" href={categoryHref(p.category.slug)}>{p.category.name}</a></li>}
            </ul>
            <h1 className="tx-stage__title tx-stage__title--ep">{e.title}</h1>
            <ul className="tx-badges" aria-label="Episode details">
              <li><time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, site.tenant.language)}</time></li>
              {e.duration > 0 && <li>{formatDuration(e.duration)}</li>}
              {e.explicit && <li className="tx-badges__e">Explicit</li>}
            </ul>
            <div className="tx-actions">
              <EpisodePlayButton episode={e} variant="pill" className="tx-megaplay" />
              <DownloadLink episode={e} className="tx-btn tx-btn--ghost">Download</DownloadLink>
            </div>
          </div>
        </div>
      </header>

      <div className="tx-split">
        <div className="tx-split__main">
          <section className="tx-card tx-card--big" aria-labelledby="tx-about-ep">
            <h2 id="tx-about-ep" className="tx-card__title">About this episode</h2>
            <Prose html={e.description || e.short_description} />
            {e.show_notes && (
              <div className="tx-notes">
                <h3 className="tx-notes__title">Show notes</h3>
                <Prose html={e.show_notes} />
              </div>
            )}
            <TagList tags={e.tags} className="tx-tags" />
          </section>
          <div className="tx-topics"><KeyTopics topics={e.key_topics} /></div>
          <Transcript episode={e} className="tx-card" />
          <div className="tx-card tx-card--plain"><FAQ items={e.faq} /></div>
          <div className="tx-card tx-card--plain"><Citations items={e.citations} /></div>
        </div>
        <aside className="tx-split__aside">
          {page.next && <UpNext ep={page.next} label="Up next" />}
          {page.previous && <UpNext ep={page.previous} label="Previously" />}
          <HostList hosts={e.hosts} title="On this episode" />
          <HostList hosts={showHosts} title="Hosts" />
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tx-card" />
          <section className="tx-card" aria-labelledby="tx-share-ep">
            <h2 id="tx-share-ep" className="tx-card__title">Share</h2>
            <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tx-share" />
          </section>
          <a className="tx-btn tx-btn--grad tx-btn--block" href={podcastHref(p)}>All episodes of {p.title}</a>
        </aside>
      </div>

      {page.more.length > 0 && (
        <section className="tx-sec" aria-label={`More from ${p.title}`}>
          <SectionHead title={`More from ${p.title}`} href={podcastHref(p)} kicker="Keep listening" />
          <div className="tx-tiles">{page.more.map((m, i) => <EpisodeCard key={m.id} episode={m} showPodcast={false} index={i} />)}</div>
        </section>
      )}
    </article>
  );
}

export const entertainmentTheme: Theme = {
  key: 'entertainment',
  name: 'Entertainment',
  Layout,
  Player: EntertainmentPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tx-posters',
  episodeListClass: 'tx-tiles',
};
