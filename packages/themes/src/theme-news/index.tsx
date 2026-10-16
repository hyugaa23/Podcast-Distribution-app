// Theme 03 — Newsroom (PRD §43): news-portal layout, dense information, trending section,
// top stories, multiple columns. Masthead + section nav, "Latest" ticker, 3-column top stories,
// newspaper section fronts for podcasts and article layout for episodes.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Episode, HomepageSection, Podcast, Site } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, episodeHref, episodeLabel, formatDate, formatDuration, hostHref, plural, podcastHref,
  categoryHref, collectionHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { NewsPlayer } from './Player';

/* ---------- helpers ---------- */

/** Server-rendered "today" line for the utility bar, in the tenant's language/timezone. */
function today(site: Site): { iso: string; label: string } {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  try {
    return { iso, label: new Intl.DateTimeFormat(site.tenant.language || 'en', { ...opts, timeZone: site.tenant.timezone || undefined }).format(d) };
  } catch {
    try {
      return { iso, label: new Intl.DateTimeFormat('en', opts).format(d) };
    } catch {
      return { iso, label: iso };
    }
  }
}

function Explicit() {
  return <abbr className="tn-badge" title="Explicit">E</abbr>;
}

/** Timestamp line: short date · duration · explicit. */
function EpMeta({ e, lang = 'en', long }: { e: Episode; lang?: string; long?: boolean }) {
  const date = formatDate(e.published_at, lang, long ? 'long' : 'short');
  const dur = formatDuration(e.duration);
  return (
    <p className="tn-meta">
      {date && <time dateTime={e.published_at ?? undefined}>{date}</time>}
      {date && dur && <span aria-hidden="true" className="tn-sep">|</span>}
      {dur && <span>{dur}</span>}
      {e.explicit && <Explicit />}
    </p>
  );
}

function SectionHead({ title, href, more = 'More', id, sub }: { title: string; href?: string; more?: string; id?: string; sub?: string }) {
  return (
    <div className="tn-shead">
      <h2 id={id} className="tn-shead__title">{title}</h2>
      {sub && <p className="tn-shead__sub">{sub}</p>}
      {href && (
        <a className="tn-shead__more" href={href}>
          {more}<span className="pe-sr-only"> {title}</span><span aria-hidden="true"> ›</span>
        </a>
      )}
    </div>
  );
}

/* ---------- layout ---------- */

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  const date = today(site);
  const nav = navItems(site).filter((n) => n.enabled !== false);
  return (
    <div className="tn-shell">
      <header className="tn-header" data-nav>
        <div className="tn-util">
          <div className="tn-wrap tn-util__in">
            <time className="tn-util__date" dateTime={date.iso}>{date.label}</time>
            {site.branding.tagline && <span className="tn-util__tag">{site.branding.tagline}</span>}
            <SearchBox className="tn-search" placeholder="Search episodes, shows, hosts…" />
          </div>
        </div>
        <div className="tn-mast">
          <div className="tn-wrap tn-mast__in">
            <a href="/" className="tn-brand" aria-label={`${name} home`}>
              {site.branding.logo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={site.branding.logo_url} alt={name} className="tn-brand__logo" />
                : <span className="tn-brand__name">{name}</span>}
            </a>
            <NavToggle className="tn-navtoggle" label="Sections" />
          </div>
        </div>
        <nav className="tn-nav" aria-label="Sections">
          <div className="tn-wrap">
            <ul className="tn-nav__list">
              {nav.map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {n.label}{n.external && <span aria-hidden="true"> ↗</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </header>
      <main id="main" className="tn-wrap tn-main">{children}</main>
      <footer className="tn-footer">
        <div className="tn-wrap tn-footer__in">
          <div className="tn-footer__brand">
            <p className="tn-footer__name">{name}</p>
            {site.branding.tagline && <p className="tn-muted">{site.branding.tagline}</p>}
          </div>
          <nav aria-label="Footer" className="tn-footer__nav">
            <ul>
              {nav.map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <SocialLinks links={site.branding.social_links} className="tn-footer__social" />
        </div>
        <div className="tn-wrap tn-footer__legal"><p>{footerText(site)}</p></div>
      </footer>
      <NewsPlayer site={site} />
    </div>
  );
}

/* ---------- cards ---------- */

/** Dense news-list item for a show: small thumb, kicker, headline, standfirst, meta. */
function PodcastCard({ podcast: p }: PodcastCardProps) {
  return (
    <article className="tn-pc">
      <Artwork src={p.artwork_url} alt="" className="tn-pc__thumb" size={72} />
      <div className="tn-pc__body">
        {p.category && <a className="tn-kicker" href={categoryHref(p.category.slug)}>{p.category.name}</a>}
        <h3 className="tn-pc__title"><a href={podcastHref(p)}>{p.title}</a></h3>
        {p.short_description && <p className="tn-pc__sum">{p.short_description}</p>}
        <p className="tn-meta">
          <span>{plural(p.episode_count, 'episode')}</span>
          {p.latest_episode_at && (
            <>
              <span aria-hidden="true" className="tn-sep">|</span>
              <span>Updated <time dateTime={p.latest_episode_at}>{formatDate(p.latest_episode_at, p.language || 'en', 'short')}</time></span>
            </>
          )}
          {p.explicit && <Explicit />}
        </p>
      </div>
    </article>
  );
}

/** Photo-led card used for featured / editors' picks rows. */
function PhotoCard({ podcast: p }: { podcast: Podcast }) {
  return (
    <article className="tn-photo">
      <Artwork src={p.artwork_url} alt="" className="tn-photo__art" />
      {p.category && <a className="tn-kicker" href={categoryHref(p.category.slug)}>{p.category.name}</a>}
      <h3 className="tn-photo__title"><a href={podcastHref(p)}>{p.title}</a></h3>
      {p.short_description && <p className="tn-photo__sum">{p.short_description}</p>}
      {p.author && <p className="tn-meta">By {p.author}</p>}
    </article>
  );
}

function EpisodeCard({ episode: e, showPodcast = true }: EpisodeCardProps) {
  const label = episodeLabel(e);
  return (
    <article className="tn-ep">
      <Artwork src={e.artwork_url || e.podcast_artwork_url} alt="" className="tn-ep__thumb" size={64} />
      <div className="tn-ep__body">
        {showPodcast
          ? <a className="tn-kicker" href={podcastHref(e.podcast_slug)}>{e.podcast_title}</a>
          : label && <p className="tn-kicker">{label}</p>}
        <h3 className="tn-ep__title"><a href={episodeHref(e)}>{e.title}</a></h3>
        {e.short_description && <p className="tn-ep__sum">{e.short_description}</p>}
        <EpMeta e={e} />
      </div>
      <EpisodePlayButton episode={e} className="tn-ep__play" />
    </article>
  );
}

/** Numbered most-played / trending list. */
function RankList({ podcasts, className }: { podcasts: Podcast[]; className?: string }) {
  return (
    <ol className={`tn-rank ${className ?? ''}`}>
      {podcasts.map((p, i) => (
        <li key={p.id} className="tn-rank__item">
          <span className="tn-rank__n" aria-hidden="true">{i + 1}</span>
          <div className="tn-rank__body">
            {p.category && <span className="tn-kicker">{p.category.name}</span>}
            <a className="tn-rank__title" href={podcastHref(p)}>{p.title}</a>
            <span className="tn-meta">
              {typeof p.plays === 'number' && p.plays > 0
                ? `${p.plays.toLocaleString('en')} plays`
                : plural(p.episode_count, 'episode')}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- homepage ---------- */

function Ticker({ episodes }: { episodes: Episode[] }) {
  if (episodes.length === 0) return null;
  const items = (hidden: boolean) =>
    episodes.map((e) => (
      <li key={e.id}>
        <a href={episodeHref(e)} tabIndex={hidden ? -1 : undefined}>
          <span className="tn-ticker__show">{e.podcast_title}:</span> {e.title}
        </a>
      </li>
    ));
  return (
    <section className="tn-ticker" aria-label="Latest episodes">
      <h2 className="tn-ticker__label">Latest</h2>
      <div className="tn-ticker__viewport">
        <div className="tn-ticker__move" style={{ ['--tn-dur' as string]: `${Math.max(24, episodes.length * 7)}s` }}>
          <ul className="tn-ticker__list">{items(false)}</ul>
          <ul className="tn-ticker__list tn-ticker__dup" aria-hidden="true">{items(true)}</ul>
        </div>
      </div>
    </section>
  );
}

function TopStories({ site, home }: HomeProps) {
  const lang = site.tenant.language || 'en';
  const eps = home.latest_episodes;
  const lead = eps[0];
  const leadShow = !lead ? home.featured[0] : undefined;
  const secondary = eps.slice(1, 5);
  const trendingSrc = home.trending.length > 0 ? home.trending : home.popular;
  const trending = trendingSrc.slice(0, 5);
  if (!lead && !leadShow && trending.length === 0) return null;
  return (
    <section className="tn-top" aria-labelledby="tn-top-h">
      <h2 id="tn-top-h" className="tn-top__label">Top stories</h2>
      <div className="tn-top__grid">
        <div className="tn-top__lead">
          {lead && (
            <article className="tn-lead">
              <a href={episodeHref(lead)} className="tn-lead__media" tabIndex={-1} aria-hidden="true">
                <Artwork src={lead.artwork_url || lead.podcast_artwork_url} alt="" className="tn-lead__art" priority />
              </a>
              <a className="tn-kicker" href={podcastHref(lead.podcast_slug)}>{lead.podcast_title}</a>
              <h3 className="tn-lead__title"><a href={episodeHref(lead)}>{lead.title}</a></h3>
              {lead.short_description && <p className="tn-lead__sum">{lead.short_description}</p>}
              <div className="tn-lead__foot">
                <EpMeta e={lead} lang={lang} />
                <EpisodePlayButton episode={lead} variant="pill" label="Listen" className="tn-btn-play" />
              </div>
            </article>
          )}
          {leadShow && (
            <article className="tn-lead">
              <div className="tn-lead__media">
                <Artwork src={leadShow.banner_url || leadShow.artwork_url} alt="" className="tn-lead__art" priority />
              </div>
              {leadShow.category && <a className="tn-kicker" href={categoryHref(leadShow.category.slug)}>{leadShow.category.name}</a>}
              <h3 className="tn-lead__title"><a href={podcastHref(leadShow)}>{leadShow.title}</a></h3>
              {leadShow.short_description && <p className="tn-lead__sum">{leadShow.short_description}</p>}
              <p className="tn-meta">{plural(leadShow.episode_count, 'episode')}{leadShow.author && ` · By ${leadShow.author}`}</p>
            </article>
          )}
        </div>
        {secondary.length > 0 && (
          <div className="tn-top__second">
            <ul className="tn-stack">
              {secondary.map((e) => (
                <li key={e.id} className="tn-stack__item">
                  <a className="tn-kicker" href={podcastHref(e.podcast_slug)}>{e.podcast_title}</a>
                  <h3 className="tn-stack__title"><a href={episodeHref(e)}>{e.title}</a></h3>
                  <div className="tn-stack__foot">
                    <EpMeta e={e} lang={lang} />
                    <EpisodePlayButton episode={e} className="tn-ep__play" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {trending.length > 0 && (
          <aside className="tn-top__rail" aria-labelledby="tn-trend-h">
            <h3 id="tn-trend-h" className="tn-rail__title">{home.trending.length > 0 ? 'Trending' : 'Most played'}</h3>
            <RankList podcasts={trending} />
            <a className="tn-shead__more" href="/podcasts">All shows<span aria-hidden="true"> ›</span></a>
          </aside>
        )}
      </div>
    </section>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  const title = sectionTitle(s);
  switch (s.type) {
    case 'hero':
      return <TopStories site={site} home={home} />;
    case 'featured': case 'editors_picks': {
      const list = sectionPodcasts(home, s.type, s.limit || 4);
      if (list.length === 0) return null;
      return (
        <section className="tn-sec" aria-label={title}>
          <SectionHead title={title} href="/podcasts" sub={s.subtitle} />
          <div className="tn-photos">{list.map((p) => <PhotoCard key={p.id} podcast={p} />)}</div>
        </section>
      );
    }
    case 'trending': {
      const list = sectionPodcasts(home, s.type, s.limit || 10);
      if (list.length === 0) return null;
      return (
        <section className="tn-sec" aria-label={title}>
          <SectionHead title={title} href="/podcasts" sub={s.subtitle} />
          <RankList podcasts={list} className="tn-rank--cols" />
        </section>
      );
    }
    case 'popular': case 'new_podcasts': {
      const list = sectionPodcasts(home, s.type, s.limit || 6);
      if (list.length === 0) return null;
      return (
        <section className="tn-sec" aria-label={title}>
          <SectionHead title={title} href="/podcasts" sub={s.subtitle} />
          <div className="tn-grid">{list.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}</div>
        </section>
      );
    }
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit || 9);
      if (eps.length === 0) return null;
      return (
        <section className="tn-sec" aria-label={title}>
          <SectionHead title={title} href="/episodes" sub={s.subtitle} />
          <div className="tn-eplist tn-eplist--cols">{eps.map((e, i) => <EpisodeCard key={e.id} episode={e} index={i} />)}</div>
        </section>
      );
    }
    case 'categories': {
      const cats = home.categories.slice(0, s.limit || 16);
      if (cats.length === 0) return null;
      return (
        <section className="tn-sec" aria-label={title}>
          <SectionHead title={title} href="/categories" more="All sections" sub={s.subtitle} />
          <ul className="tn-dir">
            {cats.map((c) => (
              <li key={c.id}>
                <a href={categoryHref(c.slug)}>
                  <span className="tn-dir__name">{c.name}</span>
                  <span className="tn-dir__count">{plural(c.podcast_count, 'show')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    case 'collections': {
      const cols = home.collections.filter((c) => c.podcasts.length > 0);
      if (cols.length === 0) return null;
      return (
        <>
          {cols.map((c) => (
            <section key={c.id} className="tn-sec" aria-label={c.title}>
              <SectionHead title={c.title} href={collectionHref(c.slug)} sub={c.description} />
              <div className="tn-grid">{c.podcasts.slice(0, s.limit || 6).map((p) => <PodcastCard key={p.id} podcast={p} />)}</div>
            </section>
          ))}
        </>
      );
    }
    case 'newsletter':
      return (
        <section className="tn-follow" aria-labelledby={`tn-follow-${s.type}`}>
          <h2 id={`tn-follow-${s.type}`} className="tn-follow__title">{title || 'Stay informed'}</h2>
          <p className="tn-follow__text">{s.subtitle || `Follow ${siteName(site)} for breaking episodes and daily briefings.`}</p>
          <SocialLinks links={site.branding.social_links} className="tn-follow__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="tn-cta" aria-label={s.title || 'Call to action'}>
          <div>
            <h2 className="tn-cta__title">{s.title || 'Never miss a story'}</h2>
            {s.subtitle && <p className="tn-cta__text">{s.subtitle}</p>}
          </div>
          <a className="tn-btn tn-btn--primary" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  const { site, home } = props;
  return (
    <div className="tn-home">
      <h1 className="pe-sr-only">{siteName(site)}</h1>
      <Ticker episodes={home.latest_episodes.slice(0, 8)} />
      {enabledSections(site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

/* ---------- podcast page (section front) ---------- */

function HostLinks({ hosts, fallback }: { hosts: { id: number; name: string; slug: string }[]; fallback?: string }) {
  if (hosts.length === 0) return fallback ? <>{fallback}</> : null;
  return <>{hosts.map((h, i) => <span key={h.id}>{i > 0 && (i === hosts.length - 1 ? ' and ' : ', ')}<a href={hostHref(h.slug)}>{h.name}</a></span>)}</>;
}

function EpisodeRow({ e, lang }: { e: Episode; lang: string }) {
  const label = episodeLabel(e);
  const dur = formatDuration(e.duration);
  return (
    <li className="tn-row">
      <div className="tn-row__date">
        {e.published_at && <time dateTime={e.published_at}>{formatDate(e.published_at, lang, 'short')}</time>}
      </div>
      <div className="tn-row__body">
        {label && <p className="tn-kicker">{label}{e.explicit && <Explicit />}</p>}
        <h3 className="tn-row__title"><a href={episodeHref(e)}>{e.title}</a></h3>
        {e.short_description && <p className="tn-row__sum">{e.short_description}</p>}
      </div>
      <div className="tn-row__side">
        {dur && <span className="tn-row__dur">{dur}</span>}
        <EpisodePlayButton episode={e} className="tn-ep__play" />
      </div>
    </li>
  );
}

function PodcastPage({ site, page }: PodcastPageProps) {
  const p = page.podcast;
  const lang = site.tenant.language || 'en';
  const latest = page.latest_episode;
  const cats = p.categories.length > 0 ? p.categories : p.category ? [p.category] : [];
  return (
    <article className="tn-front">
      <header className="tn-front__head">
        <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tn-front__art" priority />
        <div className="tn-front__info">
          <p className="tn-kicker">
            {p.category ? <a href={categoryHref(p.category.slug)}>{p.category.name}</a> : 'Podcast'}
            {p.explicit && <Explicit />}
          </p>
          <h1 className="tn-front__title">{p.title}</h1>
          <p className="tn-byline">
            {(p.hosts.length > 0 || p.author) && <>With <HostLinks hosts={p.hosts} fallback={p.author} /><span aria-hidden="true" className="tn-sep">|</span></>}
            <span>{plural(page.episodes_total, 'episode')}</span>
            {latest?.published_at && (
              <><span aria-hidden="true" className="tn-sep">|</span><span>Latest <time dateTime={latest.published_at}>{formatDate(latest.published_at, lang)}</time></span></>
            )}
          </p>
          <div className="tn-front__actions">
            {latest && <EpisodePlayButton episode={latest} variant="pill" label="Play latest" className="tn-btn-play" />}
            <SubscribeButton feedUrl={page.feed_url}>Subscribe</SubscribeButton>
          </div>
        </div>
      </header>

      <div className="tn-cols">
        <div className="tn-cols__main">
          {latest && (
            <section className="tn-latest" aria-labelledby="tn-latest-h">
              <h2 id="tn-latest-h" className="tn-latest__label">Latest episode</h2>
              <h3 className="tn-latest__title"><a href={episodeHref(latest)}>{latest.title}</a></h3>
              {latest.short_description && <p className="tn-latest__sum">{latest.short_description}</p>}
              <EpMeta e={latest} lang={lang} long />
            </section>
          )}
          <section aria-labelledby="tn-eps-h">
            <SectionHead title="All episodes" id="tn-eps-h" sub={page.seasons.length > 1 ? `Seasons ${page.seasons.join(', ')}` : undefined} />
            {page.episodes.length > 0
              ? <ol className="tn-rows">{page.episodes.map((e) => <EpisodeRow key={e.id} e={e} lang={lang} />)}</ol>
              : <p className="tn-muted">No episodes published yet.</p>}
            {page.episodes_total > page.episodes.length && (
              <a className="tn-btn" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total} episodes ›</a>
            )}
          </section>
        </div>

        <aside className="tn-rail">
          <section className="tn-box" aria-labelledby="tn-about-h">
            <h2 id="tn-about-h" className="tn-rail__title">About</h2>
            <Prose html={p.description || p.short_description} />
            {cats.length > 0 && (
              <p className="tn-box__cats">
                {cats.map((c) => <a key={c.id} className="tn-kicker" href={categoryHref(c.slug)}>{c.name}</a>)}
              </p>
            )}
            <TagList tags={p.tags} />
          </section>
          {p.hosts.length > 0 && (
            <section className="tn-box" aria-labelledby="tn-hosts-h">
              <h2 id="tn-hosts-h" className="tn-rail__title">Hosts</h2>
              <ul className="tn-people">
                {p.hosts.map((h) => (
                  <li key={h.id}><a href={hostHref(h.slug)}><Artwork src={h.photo_url} alt="" rounded size={36} /><span>{h.name}{h.role && <small>{h.role}</small>}</span></a></li>
                ))}
              </ul>
            </section>
          )}
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tn-box" compact />
          <section className="tn-box" aria-labelledby="tn-sub-h">
            <h2 id="tn-sub-h" className="tn-rail__title">Subscribe &amp; share</h2>
            <SubscribeButton feedUrl={page.feed_url}>Get the feed</SubscribeButton>
            <ShareButtons url={page.canonical_url} title={p.title} className="tn-share" />
          </section>
          {page.related.length > 0 && (
            <section className="tn-box" aria-labelledby="tn-rel-h">
              <h2 id="tn-rel-h" className="tn-rail__title">Related shows</h2>
              <RankList podcasts={page.related.slice(0, 6)} />
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

/* ---------- episode page (article) ---------- */

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const lang = site.tenant.language || 'en';
  const label = episodeLabel(e);
  const dur = formatDuration(e.duration);
  return (
    <article className="tn-article">
      <div className="tn-cols">
        <div className="tn-cols__main">
          <header className="tn-article__head">
            <p className="tn-kicker">
              <a href={podcastHref(p)}>{p.title}</a>
              {label && <><span aria-hidden="true" className="tn-sep">/</span>{label}</>}
              {e.explicit && <Explicit />}
            </p>
            <h1 className="tn-article__title">{e.title}</h1>
            {e.short_description && <p className="tn-article__dek">{e.short_description}</p>}
            <p className="tn-byline">
              {(p.hosts.length > 0 || p.author) && <>By <HostLinks hosts={p.hosts} fallback={p.author} /><span aria-hidden="true" className="tn-sep">|</span></>}
              {e.published_at && <time dateTime={e.published_at}>{formatDate(e.published_at, lang)}</time>}
              {dur && <><span aria-hidden="true" className="tn-sep">|</span><span>{dur}</span></>}
            </p>
          </header>

          <div className="tn-playbar">
            <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} className="tn-playbar__art" size={72} priority />
            <div className="tn-playbar__main">
              <EpisodePlayButton episode={e} variant="pill" className="tn-btn-play" />
              <span className="tn-playbar__dur">{dur ? `Listen · ${dur}` : 'Listen'}</span>
            </div>
            <div className="tn-playbar__tools">
              <DownloadLink episode={e} className="tn-btn tn-btn--sm">Download</DownloadLink>
              <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tn-share" />
            </div>
          </div>

          <section className="tn-article__body" aria-labelledby="tn-about-ep">
            <h2 id="tn-about-ep" className="tn-h2">About this episode</h2>
            <Prose html={e.description || e.short_description} />
            <Prose html={e.show_notes} className="tn-notes" />
            <TagList tags={e.tags} />
          </section>

          <div className="tn-inbox"><KeyTopics topics={e.key_topics} title="In this episode" /></div>

          {(e.hosts.length > 0 || p.hosts.length > 0) && (
            <section className="tn-article__people" aria-labelledby="tn-people-h">
              <h2 id="tn-people-h" className="tn-h2">Hosts &amp; guests</h2>
              <ul className="tn-people tn-people--row">
                {[...p.hosts, ...e.hosts.filter((g) => !p.hosts.some((h) => h.id === g.id))].map((h) => (
                  <li key={h.id}><a href={hostHref(h.slug)}><Artwork src={h.photo_url} alt="" rounded size={36} /><span>{h.name}{h.role && <small>{h.role}</small>}</span></a></li>
                ))}
              </ul>
            </section>
          )}

          <Transcript episode={e} className="tn-transcript" />
          <div className="tn-faq"><FAQ items={e.faq} /></div>
          <div className="tn-sources"><Citations items={e.citations} title="Sources" /></div>

          {(page.previous || page.next) && (
            <nav className="tn-prevnext" aria-label="Previous and next episodes">
              {page.previous && (
                <a href={episodeHref(page.previous)} className="tn-prevnext__prev">
                  <span className="tn-kicker">‹ Previous</span><span>{page.previous.title}</span>
                </a>
              )}
              {page.next && (
                <a href={episodeHref(page.next)} className="tn-prevnext__next">
                  <span className="tn-kicker">Next ›</span><span>{page.next.title}</span>
                </a>
              )}
            </nav>
          )}
        </div>

        <aside className="tn-rail">
          <section className="tn-box tn-showbox" aria-labelledby="tn-show-h">
            <h2 id="tn-show-h" className="tn-rail__title">From the show</h2>
            <a href={podcastHref(p)} className="tn-showbox__link">
              <Artwork src={p.artwork_url} alt="" size={56} />
              <span>
                <strong>{p.title}</strong>
                <small>{plural(p.episode_count, 'episode')}</small>
              </span>
            </a>
            <SubscribeButton feedUrl={page.feed_url}>Subscribe</SubscribeButton>
          </section>
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tn-box" compact />
          {page.more.length > 0 && (
            <section className="tn-box" aria-labelledby="tn-more-h">
              <h2 id="tn-more-h" className="tn-rail__title">Related episodes</h2>
              <ol className="tn-mini">
                {page.more.map((m) => (
                  <li key={m.id}>
                    <a href={episodeHref(m)} className="tn-mini__title">{m.title}</a>
                    <EpMeta e={m} lang={lang} />
                  </li>
                ))}
              </ol>
              <a className="tn-shead__more" href={podcastHref(p)}>All episodes<span aria-hidden="true"> ›</span></a>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

export const newsTheme: Theme = {
  key: 'news',
  name: 'Newsroom',
  Layout,
  Player: NewsPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tn-grid',
  episodeListClass: 'tn-eplist',
};
