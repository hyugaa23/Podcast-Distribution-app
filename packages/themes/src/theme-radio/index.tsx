// Theme 06 — Radio (PRD §41): radio-station feeling, Now Playing console, large player,
// schedule-style sections and bold condensed typography.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Episode, HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, categoryHref, collectionHref, episodeHref, episodeLabel, formatDate, formatDuration,
  hostHref, plural, podcastHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { RadioPlayer } from './Player';

/* ---------- small helpers ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Broadcast clock time (UTC, deterministic on the server). */
function airTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Decorative CSS equalizer (animation is disabled for reduced motion by the base CSS). */
function Eq({ className }: { className?: string }) {
  return (
    <span className={`tr-eq ${className ?? ''}`} aria-hidden="true">
      <i /><i /><i /><i /><i /><i /><i />
    </span>
  );
}

function SectionHead({ kicker, title, href, linkLabel = 'Full listings' }: { kicker: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="tr-sechead">
      <div>
        <p className="tr-kicker">{kicker}</p>
        <h2 className="tr-sechead__title">{title}</h2>
      </div>
      {href && <a className="tr-sechead__more" href={href}>{linkLabel} <span aria-hidden="true">→</span></a>}
    </div>
  );
}

function ExplicitBadge() {
  return <span className="tr-badge" title="Explicit"><span aria-hidden="true">E</span><span className="pe-sr-only">Explicit</span></span>;
}

/* ---------- Layout ---------- */

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  return (
    <div className="tr-shell">
      <header className="tr-header" data-nav>
        <div className="tr-header__bar">
          <a href="/" className="tr-brand" aria-label={`${name} home`}>
            <span className="tr-onair" aria-hidden="true"><span className="tr-onair__dot" />On air</span>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={name} className="tr-brand__logo" />
              : <span className="tr-brand__name">{name}</span>}
          </a>
          {site.branding.tagline && <p className="tr-header__tagline">{site.branding.tagline}</p>}
          <SearchBox className="tr-search" placeholder="Search shows, episodes, presenters…" />
          <NavToggle className="tr-navtoggle" />
        </div>
        <nav aria-label="Main" className="tr-nav">
          <ul>
            {navItems(site).map((n) => (
              <li key={n.href + n.label}>
                <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="tr-main">{children}</main>
      <footer className="tr-footer">
        <div className="tr-footer__inner">
          <div>
            <p className="tr-footer__name">{name}</p>
            {site.branding.tagline && <p className="tr-muted">{site.branding.tagline}</p>}
          </div>
          <SocialLinks links={site.branding.social_links} className="tr-footer__social" />
          <p className="tr-footer__legal">{footerText(site)}</p>
        </div>
      </footer>
      <RadioPlayer site={site} />
    </div>
  );
}

/* ---------- Cards ---------- */

/** "Line-up" card: square artwork with a channel number and a bold label strip. */
function PodcastCard({ podcast, index }: PodcastCardProps) {
  return (
    <article className="tr-show-card">
      <a href={podcastHref(podcast)} className="tr-show-card__link">
        <div className="tr-show-card__art">
          <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} />
          {typeof index === 'number' && <span className="tr-show-card__ch" aria-hidden="true">CH {pad(index + 1)}</span>}
        </div>
        <div className="tr-show-card__label">
          <h3 className="tr-show-card__title">{podcast.title}</h3>
          <p className="tr-show-card__sub">{podcast.category?.name || podcast.author}{podcast.episode_count > 0 && ` · ${plural(podcast.episode_count, 'episode')}`}</p>
        </div>
      </a>
    </article>
  );
}

/** Programme-schedule row: time column · show + title · play. */
function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  const date = formatDate(episode.published_at, 'en', 'short');
  const label = episodeLabel(episode);
  return (
    <article className="tr-slot">
      <div className="tr-slot__time">
        {episode.published_at
          ? <time dateTime={episode.published_at} className="tr-slot__date">{date}</time>
          : <span className="tr-slot__date">—</span>}
        {episode.duration > 0 && <span className="tr-slot__dur">{formatDuration(episode.duration)}</span>}
      </div>
      <div className="tr-slot__body">
        {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="tr-slot__show">{episode.podcast_title}</a>}
        <h3 className="tr-slot__title"><a href={episodeHref(episode)}>{episode.title}</a></h3>
        {(label || episode.explicit) && (
          <p className="tr-slot__meta">{episode.explicit && <ExplicitBadge />}{label}</p>
        )}
      </div>
      <EpisodePlayButton episode={episode} className="tr-slot__play" />
    </article>
  );
}

function Schedule({ episodes, showPodcast = true }: { episodes: Episode[]; showPodcast?: boolean }) {
  return (
    <div className="tr-schedule">
      {episodes.map((e) => <EpisodeCard key={e.id} episode={e} showPodcast={showPodcast} />)}
    </div>
  );
}

function Lineup({ kicker, title, href, podcasts }: { kicker: string; title: string; href?: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tr-section" aria-label={title}>
      <SectionHead kicker={kicker} title={title} href={href} linkLabel="All shows" />
      <div className="tr-lineup">
        {podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}
      </div>
    </section>
  );
}

/* ---------- Home ---------- */

function NowPlayingHero({ site, home }: HomeProps) {
  const e = home.latest_episodes[0];
  if (!e) {
    const p = home.featured[0];
    if (!p) return null;
    return (
      <section className="tr-console" aria-label="On air">
        <div className="tr-console__art"><Artwork src={p.artwork_url} alt={`${p.title} artwork`} priority /></div>
        <div className="tr-console__info">
          <p className="tr-console__label"><span className="tr-livedot" aria-hidden="true" />On air now</p>
          <h1 className="tr-console__title">{p.title}</h1>
          {p.short_description && <p className="tr-console__desc">{p.short_description}</p>}
          <a className="tr-btn tr-btn--primary" href={podcastHref(p)}>Tune in</a>
        </div>
        <Eq className="tr-console__eq" />
      </section>
    );
  }
  return (
    <section className="tr-console" aria-labelledby="tr-now-title">
      <div className="tr-console__art">
        <Artwork src={e.artwork_url || e.podcast_artwork_url} alt={`${e.title} artwork`} priority />
      </div>
      <div className="tr-console__info">
        <p className="tr-console__label"><span className="tr-livedot" aria-hidden="true" />Now playing · Latest broadcast</p>
        <h1 id="tr-now-title" className="tr-console__title"><a href={episodeHref(e)}>{e.title}</a></h1>
        <p className="tr-console__show">
          <a href={podcastHref(e.podcast_slug)}>{e.podcast_title}</a>
          {e.published_at && <> · <time dateTime={e.published_at}>{formatDate(e.published_at, site.tenant.language)}</time></>}
          {e.duration > 0 && ` · ${formatDuration(e.duration)}`}
        </p>
        {e.short_description && <p className="tr-console__desc">{e.short_description}</p>}
        <div className="tr-console__stats" aria-label="Station stats">
          <span><strong>{home.stats.podcasts.toLocaleString('en')}</strong> shows</span>
          <span><strong>{home.stats.episodes.toLocaleString('en')}</strong> episodes</span>
        </div>
      </div>
      <div className="tr-console__deck">
        <EpisodePlayButton episode={e} className="tr-megaplay" />
        <Eq className="tr-console__eq" />
      </div>
    </section>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero':
      return <NowPlayingHero site={site} home={home} />;
    case 'trending': {
      const list = sectionPodcasts(home, s.type, s.limit || 10);
      if (list.length === 0) return null;
      return (
        <section className="tr-section" aria-label={sectionTitle(s)}>
          <SectionHead kicker="Hot rotation" title={sectionTitle(s)} href="/podcasts" linkLabel="All shows" />
          <ol className="tr-chart">
            {list.map((p, i) => (
              <li key={p.id}>
                <a href={podcastHref(p)} className="tr-chart__row">
                  <span className="tr-chart__pos" aria-hidden="true">{pad(i + 1)}</span>
                  <Artwork src={p.artwork_url} alt="" className="tr-chart__art" size={56} />
                  <span className="tr-chart__body">
                    <span className="tr-chart__title">{p.title}</span>
                    <span className="tr-chart__sub">{p.author || p.category?.name}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      );
    }
    case 'featured': case 'popular': case 'editors_picks': case 'new_podcasts': {
      const kickers: Record<string, string> = { featured: 'Featured line-up', popular: 'Listener favourites', editors_picks: 'Station picks', new_podcasts: 'New on the dial' };
      return <Lineup kicker={kickers[s.type] ?? 'Our shows'} title={sectionTitle(s)} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    }
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="tr-section" aria-label={sectionTitle(s)}>
          <SectionHead kicker="Programme schedule" title={sectionTitle(s)} href="/episodes" />
          <Schedule episodes={eps} />
        </section>
      );
    }
    case 'categories':
      if (home.categories.length === 0) return null;
      return (
        <section className="tr-section" aria-label={sectionTitle(s)}>
          <SectionHead kicker="Stations & genres" title={sectionTitle(s)} href="/categories" linkLabel="All genres" />
          <ul className="tr-genres">
            {home.categories.slice(0, s.limit || 12).map((c, i) => (
              <li key={c.id}>
                <a href={categoryHref(c.slug)}>
                  <span className="tr-genres__freq" aria-hidden="true">{(88.1 + i * 1.6).toFixed(1)} FM</span>
                  <span className="tr-genres__name">{c.name}</span>
                  <span className="tr-genres__count">{plural(c.podcast_count, 'show')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'collections':
      return (
        <>
          {home.collections.map((c) => <Lineup key={c.id} kicker="Special programming" title={c.title} href={collectionHref(c.slug)} podcasts={c.podcasts} />)}
        </>
      );
    case 'newsletter':
      return (
        <section className="tr-banner" aria-label={sectionTitle(s)}>
          <div>
            <p className="tr-kicker">Stay tuned</p>
            <h2 className="tr-banner__title">{sectionTitle(s)}</h2>
            <p>{s.subtitle || `Follow ${siteName(site)} for every new broadcast.`}</p>
          </div>
          <SocialLinks links={site.branding.social_links} className="tr-banner__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="tr-banner" aria-label="Call to action">
          <div>
            <p className="tr-kicker">Don&apos;t touch that dial</p>
            <h2 className="tr-banner__title">{s.title || 'Never miss a broadcast'}</h2>
            {s.subtitle && <p>{s.subtitle}</p>}
          </div>
          <a className="tr-btn tr-btn--dark" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse shows'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  return (
    <div className="tr-home">
      {enabledSections(props.site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

/* ---------- Podcast page ---------- */

function PeopleList({ people, title }: { people: (HostRef & { tag?: string })[]; title: string }) {
  if (people.length === 0) return null;
  return (
    <section className="tr-panel" aria-label={title}>
      <h2 className="tr-panel__title">{title}</h2>
      <ul className="tr-people">
        {people.map((h) => (
          <li key={h.id}>
            <a href={hostHref(h.slug)}>
              <Artwork src={h.photo_url} alt={h.name} rounded size={48} />
              <span>
                <strong>{h.name}</strong>
                {(h.tag || h.role) && <small>{h.tag || h.role}</small>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PodcastPage({ page }: PodcastPageProps) {
  const p = page.podcast;
  const latest = page.latest_episode;
  const cats = p.categories.length > 0 ? p.categories : p.category ? [p.category] : [];
  return (
    <article className="tr-showpage">
      <header className="tr-band">
        <div className="tr-band__inner">
          <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tr-band__art" priority />
          <div className="tr-band__info">
            <p className="tr-band__kicker">
              <span className="tr-onair tr-onair--inv" aria-hidden="true"><span className="tr-onair__dot" />Show</span>
              {p.category && <a href={categoryHref(p.category.slug)}>{p.category.name}</a>}
            </p>
            <h1 className="tr-band__title">{p.title}</h1>
            <p className="tr-band__by">
              {p.hosts.length > 0
                ? <>With {p.hosts.map((h, i) => <span key={h.id}>{i > 0 && (i === p.hosts.length - 1 ? ' & ' : ', ')}<a href={hostHref(h.slug)}>{h.name}</a></span>)}</>
                : p.author}
            </p>
            <p className="tr-band__meta">
              <span>{plural(page.episodes_total, 'episode')}</span>
              {p.podcast_type === 'serial' && <span>Serial</span>}
              {p.explicit && <ExplicitBadge />}
            </p>
          </div>
        </div>
      </header>

      <div className="tr-actions">
        <SubscribeButton feedUrl={page.feed_url} className="tr-subscribe">Follow the show</SubscribeButton>
        <ShareButtons url={page.canonical_url} title={p.title} />
      </div>

      {latest && (
        <section className="tr-nextup" aria-labelledby="tr-nextup">
          <EpisodePlayButton episode={latest} className="tr-megaplay" />
          <div className="tr-nextup__info">
            <p className="tr-kicker" id="tr-nextup">Next up · Latest broadcast</p>
            <h2 className="tr-nextup__title"><a href={episodeHref(latest)}>{latest.title}</a></h2>
            <p className="tr-muted">
              {latest.published_at && <time dateTime={latest.published_at}>{formatDate(latest.published_at)}</time>}
              {latest.duration > 0 && ` · ${formatDuration(latest.duration)}`}
              {episodeLabel(latest) && ` · ${episodeLabel(latest)}`}
            </p>
          </div>
          <Eq className="tr-nextup__eq" />
        </section>
      )}

      <div className="tr-cols">
        <section aria-label="Episodes" className="tr-cols__main">
          <SectionHead kicker="Broadcast schedule" title="Episodes" />
          {page.seasons.length > 1 && (
            <p className="tr-seasons">Seasons: {page.seasons.map((n) => <span key={n}>S{n}</span>)}</p>
          )}
          <Schedule episodes={page.episodes} showPodcast={false} />
          {page.episodes_total > page.episodes.length && (
            <a className="tr-btn tr-btn--wide" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total} episodes</a>
          )}
        </section>
        <aside className="tr-cols__aside">
          <section className="tr-panel" aria-label="About the show">
            <h2 className="tr-panel__title">About the show</h2>
            <Prose html={p.description || p.short_description} />
            {cats.length > 0 && (
              <ul className="tr-cats" aria-label="Categories">
                {cats.map((c) => <li key={c.id}><a href={categoryHref(c.slug)}>{c.name}</a></li>)}
              </ul>
            )}
            <TagList tags={p.tags} />
          </section>
          <PeopleList people={p.hosts} title="Presenters" />
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tr-panel" />
        </aside>
      </div>

      <Lineup kicker="Also on air" title="Related shows" podcasts={page.related} />
    </article>
  );
}

/* ---------- Episode page ---------- */

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const lang = site.tenant.language;
  const time = airTime(e.published_at);
  const seen = new Set<number>();
  const people: (HostRef & { tag?: string })[] = [];
  for (const h of p.hosts) if (!seen.has(h.id)) { seen.add(h.id); people.push({ ...h, tag: h.role || 'Presenter' }); }
  for (const h of e.hosts) if (!seen.has(h.id)) { seen.add(h.id); people.push({ ...h, tag: h.role || 'Guest' }); }
  return (
    <article className="tr-broadcast">
      <p className="tr-crumb"><a href={podcastHref(p)}>← {p.title}</a></p>
      <header className="tr-broadcast__head">
        <p className="tr-kicker">Broadcast{episodeLabel(e) && ` · ${episodeLabel(e)}`}</p>
        <h1 className="tr-broadcast__title">{e.title}</h1>
        <dl className="tr-airinfo">
          <div><dt>Show</dt><dd><a href={podcastHref(p)}>{p.title}</a></dd></div>
          {e.published_at && (
            <div><dt>Aired</dt><dd><time dateTime={e.published_at}>{formatDate(e.published_at, lang)}{time && ` · ${time} UTC`}</time></dd></div>
          )}
          {e.duration > 0 && <div><dt>Duration</dt><dd>{formatDuration(e.duration)}</dd></div>}
          {e.explicit && <div><dt>Rating</dt><dd>Explicit</dd></div>}
        </dl>
      </header>

      <section className="tr-console tr-console--ep" aria-label="Play this broadcast">
        <div className="tr-console__art"><Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} priority /></div>
        <div className="tr-console__info">
          <p className="tr-console__label"><span className="tr-livedot" aria-hidden="true" />Ready to broadcast</p>
          <EpisodePlayButton episode={e} variant="pill" className="tr-bigpill" />
          <div className="tr-console__tools">
            <DownloadLink episode={e} className="tr-btn">Download</DownloadLink>
            <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} />
          </div>
        </div>
        <Eq className="tr-console__eq" />
      </section>

      <div className="tr-cols">
        <div className="tr-cols__main">
          <section className="tr-panel tr-panel--flat" aria-labelledby="tr-about-ep">
            <h2 id="tr-about-ep" className="tr-h2">About this episode</h2>
            <Prose html={e.description || e.short_description} />
            <Prose html={e.show_notes} className="tr-notes" />
            <TagList tags={e.tags} />
          </section>
          <KeyTopics topics={e.key_topics} />
          <Transcript episode={e} className="tr-panel" />
          <FAQ items={e.faq} />
          <Citations items={e.citations} />
        </div>
        <aside className="tr-cols__aside">
          <PeopleList people={people} title="Presenters & guests" />
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tr-panel" />
          {(page.previous || page.next) && (
            <nav className="tr-panel tr-prevnext" aria-label="Earlier and later broadcasts">
              {page.previous && (
                <a href={episodeHref(page.previous)} rel="prev">
                  <small>← Earlier</small><span>{page.previous.title}</span>
                </a>
              )}
              {page.next && (
                <a href={episodeHref(page.next)} rel="next">
                  <small>Later →</small><span>{page.next.title}</span>
                </a>
              )}
            </nav>
          )}
        </aside>
      </div>

      {page.more.length > 0 && (
        <section className="tr-section" aria-label={`More from ${p.title}`}>
          <SectionHead kicker="Coming up on this channel" title={`More from ${p.title}`} href={podcastHref(p)} linkLabel="Show page" />
          <Schedule episodes={page.more} showPodcast={false} />
        </section>
      )}
    </article>
  );
}

export const radioTheme: Theme = {
  key: 'radio',
  name: 'Radio',
  Layout,
  Player: RadioPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tr-lineup',
  episodeListClass: 'tr-schedule',
};
