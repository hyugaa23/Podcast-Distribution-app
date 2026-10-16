// Theme 10 — Premium Magazine (PRD §50): luxury masthead, full-bleed cover story,
// asymmetric "featured stories" spread, curated collection dossiers, long-form
// feature-article podcast and episode pages, and a slim elegant bottom player.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Collection, Episode, HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, categoryHref, collectionHref, episodeHref, episodeLabel, formatDate, formatDuration,
  hostHref, plural, podcastHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { MagazinePlayer } from './Player';

/* ------------------------------------------------------------------ helpers */

const pad2 = (n: number) => String(n).padStart(2, '0');

function firstSentence(text?: string | null): string {
  const t = (text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.{12,}?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
}

function HostNames({ hosts, fallback }: { hosts: HostRef[]; fallback?: string }) {
  if (hosts.length === 0) return fallback ? <>{fallback}</> : null;
  return (
    <>
      {hosts.map((h, i) => (
        <span key={h.id}>
          {i > 0 && (i === hosts.length - 1 ? ' & ' : ', ')}
          <a href={hostHref(h.slug)}>{h.name}</a>
        </span>
      ))}
    </>
  );
}

function SectionHead({ title, subtitle, href, linkLabel = 'View all', id }: { title: string; subtitle?: string; href?: string; linkLabel?: string; id?: string }) {
  return (
    <header className="tz-shead">
      <h2 id={id} className="tz-shead__title">{title}</h2>
      {subtitle && <p className="tz-shead__sub">{subtitle}</p>}
      {href && <a className="tz-shead__more" href={href}>{linkLabel} <span aria-hidden="true">→</span></a>}
    </header>
  );
}

function Explicit() {
  return <abbr className="tz-explicit" title="Explicit content">Explicit</abbr>;
}

/* ------------------------------------------------------------------ layout */

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  const today = formatDate(new Date().toISOString(), site.tenant.language || 'en');
  const items = navItems(site).filter((n) => n.enabled !== false);
  return (
    <div className="tz-shell">
      <header className="tz-mast" data-nav>
        <div className="tz-mast__top tz-wrap">
          <p className="tz-mast__issue">
            <span>The Issue of {today}</span>
            {site.branding.tagline && <span className="tz-mast__tag">{site.branding.tagline}</span>}
          </p>
          <SearchBox className="tz-search" placeholder="Search the archive…" />
          <NavToggle className="tz-navtoggle" />
        </div>
        <div className="tz-mast__brand tz-wrap">
          <a href="/" className="tz-wordmark" aria-label={`${name} — home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={name} className="tz-wordmark__logo" />
              : <span className="tz-wordmark__text">{name}</span>}
          </a>
        </div>
        <nav aria-label="Main" className="tz-nav">
          <ul className="tz-wrap">
            {items.map((n) => (
              <li key={n.href + n.label}>
                <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className="tz-main">{children}</main>

      <footer className="tz-foot">
        <div className="tz-wrap">
          <p className="tz-foot__mark">{name}</p>
          {site.branding.tagline && <p className="tz-foot__tag">{site.branding.tagline}</p>}
          <nav aria-label="Footer" className="tz-foot__nav">
            <ul>
              {items.map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <SocialLinks links={site.branding.social_links} className="tz-foot__social" />
          <p className="tz-foot__legal">{footerText(site)}</p>
        </div>
      </footer>
      <MagazinePlayer site={site} />
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function PodcastStory({ podcast, rank, eager }: { podcast: Podcast; rank?: number; eager?: boolean }) {
  return (
    <article className="tz-card">
      <a href={podcastHref(podcast)} className="tz-card__link">
        <div className="tz-card__art">
          <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} priority={eager} />
          {rank !== undefined && <span className="tz-card__rank" aria-label={`Number ${rank}`}>{pad2(rank)}</span>}
        </div>
        {podcast.category && <p className="tz-kicker">{podcast.category.name}</p>}
        <h3 className="tz-card__title">{podcast.title}</h3>
      </a>
      {podcast.short_description && <p className="tz-card__deck">{podcast.short_description}</p>}
      <p className="tz-byline">
        By <HostNames hosts={podcast.hosts} fallback={podcast.author || 'the editors'} />
      </p>
    </article>
  );
}

function PodcastCard({ podcast }: PodcastCardProps) {
  return <PodcastStory podcast={podcast} />;
}

function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  const label = episodeLabel(episode);
  return (
    <article className="tz-ep">
      <a href={episodeHref(episode)} className="tz-ep__art" tabIndex={-1} aria-hidden="true">
        <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" />
      </a>
      <div className="tz-ep__body">
        <p className="tz-kicker">
          {showPodcast ? <a href={podcastHref(episode.podcast_slug)}>{episode.podcast_title}</a> : (label || 'Episode')}
          {showPodcast && label && <span className="tz-kicker__sep"> · {label}</span>}
        </p>
        <h3 className="tz-ep__title"><a href={episodeHref(episode)}>{episode.title}</a></h3>
        {episode.short_description && <p className="tz-ep__deck">{episode.short_description}</p>}
        <p className="tz-ep__meta">
          <time dateTime={episode.published_at ?? undefined}>{formatDate(episode.published_at, 'en')}</time>
          {episode.duration > 0 && <span> · {formatDuration(episode.duration)}</span>}
          {episode.explicit && <> · <Explicit /></>}
        </p>
      </div>
      <EpisodePlayButton episode={episode} className="tz-ep__play" />
    </article>
  );
}

/* ------------------------------------------------------------------ featured stories spread */

type Story = { kind: 'podcast'; podcast: Podcast } | { kind: 'episode'; episode: Episode };

function StoryItem({ story, size }: { story: Story; size: 'lead' | 'medium' | 'small' }) {
  if (story.kind === 'podcast') {
    const p = story.podcast;
    return (
      <article className={`tz-story tz-story--${size}`}>
        <a href={podcastHref(p)} className="tz-story__art" tabIndex={-1} aria-hidden="true">
          <Artwork src={size === 'lead' ? (p.banner_url || p.artwork_url) : p.artwork_url} alt="" priority={size === 'lead'} />
        </a>
        <div className="tz-story__text">
          <p className="tz-kicker">{p.category ? <a href={categoryHref(p.category.slug)}>{p.category.name}</a> : 'The Show'}</p>
          <h3 className="tz-story__title"><a href={podcastHref(p)}>{p.title}</a></h3>
          {size !== 'small' && p.short_description && <p className="tz-story__deck">{p.short_description}</p>}
          <p className="tz-byline">By <HostNames hosts={p.hosts} fallback={p.author || 'the editors'} /> · {plural(p.episode_count, 'episode')}</p>
        </div>
      </article>
    );
  }
  const e = story.episode;
  return (
    <article className={`tz-story tz-story--${size}`}>
      <a href={episodeHref(e)} className="tz-story__art" tabIndex={-1} aria-hidden="true">
        <Artwork src={e.artwork_url || e.podcast_artwork_url} alt="" />
      </a>
      <div className="tz-story__text">
        <p className="tz-kicker"><a href={podcastHref(e.podcast_slug)}>{e.podcast_title}</a>{episodeLabel(e) && <span className="tz-kicker__sep"> · {episodeLabel(e)}</span>}</p>
        <h3 className="tz-story__title"><a href={episodeHref(e)}>{e.title}</a></h3>
        {size !== 'small' && e.short_description && <p className="tz-story__deck">{e.short_description}</p>}
        <p className="tz-byline">
          <time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, 'en')}</time>
          {e.duration > 0 && ` · ${formatDuration(e.duration)}`}
        </p>
        <EpisodePlayButton episode={e} variant="text" label="Listen" className="tz-listen" />
      </div>
    </article>
  );
}

function FeaturedSpread({ title, subtitle, podcasts, episodes }: { title: string; subtitle?: string; podcasts: Podcast[]; episodes: Episode[] }) {
  const pool: Story[] = [
    ...podcasts.map((p): Story => ({ kind: 'podcast', podcast: p })),
  ];
  const eps: Story[] = episodes.map((e): Story => ({ kind: 'episode', episode: e }));
  if (pool.length + eps.length === 0) return null;
  // One lead feature, two mediums, then small items — interleave podcasts and fresh episodes.
  const lead = pool.shift() ?? eps.shift()!;
  const mediums: Story[] = [];
  while (mediums.length < 2 && (pool.length || eps.length)) {
    const next = mediums.length === 0 ? (pool.shift() ?? eps.shift()) : (eps.shift() ?? pool.shift());
    if (next) mediums.push(next);
  }
  const smalls: Story[] = [];
  while (smalls.length < 4 && (pool.length || eps.length)) {
    const next = smalls.length % 2 === 0 ? (eps.shift() ?? pool.shift()) : (pool.shift() ?? eps.shift());
    if (next) smalls.push(next);
  }
  const key = (s: Story) => (s.kind === 'podcast' ? `p${s.podcast.id}` : `e${s.episode.id}`);
  return (
    <section className="tz-section tz-wrap" aria-labelledby="tz-featured">
      <SectionHead id="tz-featured" title={title} subtitle={subtitle || 'The stories our editors are listening to this week'} href="/podcasts" />
      <div className="tz-spread">
        <div className="tz-spread__lead"><StoryItem story={lead} size="lead" /></div>
        {mediums.length > 0 && (
          <div className="tz-spread__mediums">
            {mediums.map((s) => <StoryItem key={key(s)} story={s} size="medium" />)}
          </div>
        )}
        {smalls.length > 0 && (
          <div className="tz-spread__smalls">
            {smalls.map((s) => <StoryItem key={key(s)} story={s} size="small" />)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ dossiers & lists */

function Dossier({ c, index }: { c: Collection; index: number }) {
  if (c.podcasts.length === 0) return null;
  const dark = index % 2 === 0;
  const id = `tz-dossier-${c.id}`;
  return (
    <section className={`tz-dossier ${dark ? 'tz-dossier--dark' : 'tz-dossier--light'}`} aria-labelledby={id}>
      {c.cover_url && dark && <div className="tz-dossier__bg" style={{ backgroundImage: `url(${c.cover_url})` }} aria-hidden="true" />}
      <div className="tz-dossier__inner tz-wrap">
        <header className="tz-dossier__head">
          <p className="tz-dossier__no">Dossier N<sup>o</sup> {pad2(index + 1)} · {plural(c.podcasts.length, 'title')}</p>
          <h2 id={id} className="tz-dossier__title">{c.title}</h2>
          {c.description && <p className="tz-dossier__desc">{c.description}</p>}
          <a href={collectionHref(c.slug)} className="tz-dossier__link">Open the dossier <span aria-hidden="true">→</span></a>
        </header>
        <ol className="tz-dossier__covers">
          {c.podcasts.slice(0, 6).map((p) => (
            <li key={p.id}>
              <a href={podcastHref(p)}>
                <Artwork src={p.artwork_url} alt={`${p.title} artwork`} />
                <span className="tz-dossier__ctitle">{p.title}</span>
                {p.category && <span className="tz-dossier__ccat">{p.category.name}</span>}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PicksList({ title, subtitle, podcasts }: { title: string; subtitle?: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tz-section tz-wrap tz-picks" aria-labelledby="tz-picks">
      <SectionHead id="tz-picks" title={title} subtitle={subtitle || 'Chosen, with care, by the editors'} href="/podcasts" />
      <ol className="tz-picks__list">
        {podcasts.map((p, i) => (
          <li key={p.id} className="tz-pick">
            <span className="tz-pick__no" aria-hidden="true">{pad2(i + 1)}</span>
            <div className="tz-pick__text">
              {p.category && <p className="tz-kicker">{p.category.name}</p>}
              <h3 className="tz-pick__title"><a href={podcastHref(p)}>{p.title}</a></h3>
              {p.short_description && <p className="tz-pick__deck">{p.short_description}</p>}
              <p className="tz-byline">By <HostNames hosts={p.hosts} fallback={p.author || 'the editors'} /></p>
            </div>
            <a href={podcastHref(p)} className="tz-pick__art" tabIndex={-1} aria-hidden="true">
              <Artwork src={p.artwork_url} alt="" />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PodcastDepartment({ title, subtitle, podcasts, ranked, id, href = '/podcasts' }: { title: string; subtitle?: string; podcasts: Podcast[]; ranked?: boolean; id: string; href?: string }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tz-section tz-wrap" aria-labelledby={id}>
      <SectionHead id={id} title={title} subtitle={subtitle} href={href} />
      <div className="tz-grid">
        {podcasts.map((p, i) => <PodcastStory key={p.id} podcast={p} rank={ranked ? i + 1 : undefined} />)}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ home */

function HomeSection({ s, site, home, heroOn }: { s: HomepageSection; heroOn: boolean } & HomeProps) {
  switch (s.type) {
    case 'hero': {
      const p = home.featured[0];
      if (!p) return null;
      const lines = home.featured.slice(1, 4);
      return (
        <section className="tz-cover" aria-labelledby="tz-cover-title">
          <div className="tz-cover__media" aria-hidden="true">
            <Artwork src={p.banner_url || p.artwork_url} alt="" className="tz-cover__img" priority />
          </div>
          <div className="tz-cover__shade" aria-hidden="true" />
          <div className="tz-cover__content tz-wrap">
            <div className="tz-cover__story">
              <p className="tz-cover__kicker">The Cover Story{p.category && <> · <a href={categoryHref(p.category.slug)}>{p.category.name}</a></>}</p>
              <h2 id="tz-cover-title" className="tz-cover__title"><a href={podcastHref(p)}>{p.title}</a></h2>
              {p.short_description && <p className="tz-cover__deck">{p.short_description}</p>}
              <p className="tz-cover__by">By <HostNames hosts={p.hosts} fallback={p.author || siteName(site)} /></p>
              <a className="tz-cover__listen" href={podcastHref(p)}>Listen <span aria-hidden="true">→</span></a>
            </div>
            {lines.length > 0 && (
              <aside className="tz-cover__lines" aria-label="Also in this issue">
                <p className="tz-cover__lines-title">Also in this issue</p>
                <ul>
                  {lines.map((l) => (
                    <li key={l.id}>
                      <a href={podcastHref(l)}>
                        <span className="tz-cover__line-kicker">{l.category?.name ?? 'Podcast'}</span>
                        <span className="tz-cover__line-title">{l.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
        </section>
      );
    }
    case 'featured': {
      let pods = sectionPodcasts(home, 'featured', s.limit);
      if (heroOn && pods.length > 1) pods = pods.slice(1);
      return <FeaturedSpread title={sectionTitle(s) === 'Featured Podcasts' ? 'Featured Stories' : sectionTitle(s)} subtitle={s.subtitle} podcasts={pods} episodes={home.latest_episodes.slice(0, 4)} />;
    }
    case 'trending':
      return <PodcastDepartment id="tz-trending" title={sectionTitle(s)} subtitle={s.subtitle || 'What the readership is playing now'} podcasts={sectionPodcasts(home, 'trending', s.limit || 8)} ranked />;
    case 'popular':
      return <PodcastDepartment id="tz-popular" title={sectionTitle(s)} subtitle={s.subtitle || 'The enduring favourites'} podcasts={sectionPodcasts(home, 'popular', s.limit || 8)} />;
    case 'new_podcasts':
      return <PodcastDepartment id="tz-new" title={sectionTitle(s)} subtitle={s.subtitle || 'Fresh to the masthead'} podcasts={sectionPodcasts(home, 'new_podcasts', s.limit || 8)} />;
    case 'editors_picks':
      return <PicksList title={sectionTitle(s)} subtitle={s.subtitle} podcasts={sectionPodcasts(home, 'editors_picks', s.limit || 6)} />;
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit || 6);
      if (eps.length === 0) return null;
      return (
        <section className="tz-section tz-wrap" aria-labelledby="tz-latest">
          <SectionHead id="tz-latest" title={sectionTitle(s)} subtitle={s.subtitle || 'New dispatches from across the network'} href="/episodes" />
          <div className="tz-eplist tz-eplist--cols">{eps.map((e) => <EpisodeCard key={e.id} episode={e} />)}</div>
        </section>
      );
    }
    case 'categories': {
      const cats = home.categories.slice(0, s.limit || 12);
      if (cats.length === 0) return null;
      return (
        <section className="tz-section tz-wrap" aria-labelledby="tz-cats">
          <SectionHead id="tz-cats" title={sectionTitle(s)} subtitle={s.subtitle || 'In this issue'} href="/categories" linkLabel="All sections" />
          <ol className="tz-contents">
            {cats.map((c, i) => (
              <li key={c.id}>
                <a href={categoryHref(c.slug)}>
                  <span className="tz-contents__no" aria-hidden="true">{pad2(i + 1)}</span>
                  <span className="tz-contents__name">{c.name}</span>
                  <span className="tz-contents__dots" aria-hidden="true" />
                  <span className="tz-contents__count">{plural(c.podcast_count, 'show')}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      );
    }
    case 'collections':
      if (home.collections.length === 0) return null;
      return (
        <div className="tz-dossiers">
          {home.collections.map((c, i) => <Dossier key={c.id} c={c} index={i} />)}
        </div>
      );
    case 'newsletter':
      return (
        <section className="tz-section tz-wrap tz-letter" aria-labelledby="tz-letter">
          <p className="tz-kicker">Correspondence</p>
          <h2 id="tz-letter" className="tz-letter__title">{sectionTitle(s)}</h2>
          <p className="tz-letter__text">{s.subtitle || `Follow ${siteName(site)} for every new issue, interview and dispatch.`}</p>
          <SocialLinks links={site.branding.social_links} className="tz-letter__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="tz-section tz-wrap" aria-label={s.title || "Call to action"}>
          <div className="tz-cta">
            <h2 className="tz-cta__title">{s.title || 'Never miss an issue'}</h2>
            {s.subtitle && <p className="tz-cta__text">{s.subtitle}</p>}
            <a className="tz-btn tz-btn--solid" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse the collection'}</a>
          </div>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  const sections = enabledSections(props.site);
  const heroOn = sections.some((s) => s.type === 'hero') && props.home.featured.length > 0;
  return (
    <div className="tz-home">
      <h1 className="pe-sr-only">{siteName(props.site)}</h1>
      {sections.map((s, i) => <HomeSection key={s.type + i} s={s} heroOn={heroOn} {...props} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ podcast page */

function PodcastPage({ site, page }: PodcastPageProps) {
  const p = page.podcast;
  const lang = site.tenant.language || 'en';
  const cats = p.categories.length ? p.categories : p.category ? [p.category] : [];
  return (
    <article className="tz-show tz-wrap">
      <header className="tz-opener">
        <div className="tz-opener__art">
          <Artwork src={p.artwork_url} alt={`${p.title} artwork`} priority />
        </div>
        <div className="tz-opener__text">
          <p className="tz-kicker tz-kicker--lg">
            {cats.length > 0
              ? cats.map((c, i) => <span key={c.id}>{i > 0 && ' · '}<a href={categoryHref(c.slug)}>{c.name}</a></span>)
              : 'Podcast'}
          </p>
          <h1 className="tz-opener__title">{p.title}</h1>
          {p.short_description && <p className="tz-opener__deck">{p.short_description}</p>}
          <p className="tz-opener__by">
            {p.hosts.length > 0 ? <>Hosted by <HostNames hosts={p.hosts} /></> : <>By {p.author}</>}
          </p>
          <p className="tz-opener__meta">
            {plural(page.episodes_total, 'episode')}
            {page.latest_episode?.published_at && <> · Latest <time dateTime={page.latest_episode.published_at}>{formatDate(page.latest_episode.published_at, lang)}</time></>}
            {p.explicit && <> · <Explicit /></>}
          </p>
          <div className="tz-opener__actions">
            {page.latest_episode && <EpisodePlayButton episode={page.latest_episode} variant="pill" label="Play the latest" className="tz-btn tz-btn--solid" />}
            <SubscribeButton feedUrl={page.feed_url} className="tz-subscribe">Subscribe</SubscribeButton>
          </div>
        </div>
      </header>

      <div className="tz-cols">
        <section className="tz-index" aria-labelledby="tz-eps">
          <div className="tz-index__head">
            <h2 id="tz-eps" className="tz-h2">The Episodes</h2>
            {page.seasons.length > 1 && <p className="tz-muted">Seasons {page.seasons.join(', ')}</p>}
          </div>
          {page.latest_episode && (
            <p className="tz-index__latest">
              <span className="tz-kicker">Latest</span>{' '}
              <a href={episodeHref(page.latest_episode)}>{page.latest_episode.title}</a>
            </p>
          )}
          <ol className="tz-index__list">
            {page.episodes.map((e, i) => (
              <li key={e.id} className="tz-index__item">
                <span className="tz-index__no" aria-hidden="true">{e.episode_number ? pad2(e.episode_number) : pad2(i + 1)}</span>
                <div className="tz-index__text">
                  <p className="tz-index__meta">
                    {episodeLabel(e) && <span>{episodeLabel(e)} · </span>}
                    <time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, lang)}</time>
                    {e.duration > 0 && ` · ${formatDuration(e.duration)}`}
                    {e.explicit && <> · <Explicit /></>}
                  </p>
                  <h3 className="tz-index__title"><a href={episodeHref(e)}>{e.title}</a></h3>
                  {e.short_description && <p className="tz-index__deck">{e.short_description}</p>}
                </div>
                <EpisodePlayButton episode={e} className="tz-index__play" />
              </li>
            ))}
          </ol>
          {page.episodes_total > page.episodes.length && (
            <a className="tz-btn" href={`/episodes?podcast=${p.slug}`}>The complete index · {plural(page.episodes_total, 'episode')} <span aria-hidden="true">→</span></a>
          )}
        </section>

        <aside className="tz-side">
          <section className="tz-side__block" aria-labelledby="tz-about">
            <h2 id="tz-about" className="tz-side__title">About</h2>
            <Prose html={p.description || p.short_description} className="tz-prose" />
            <TagList tags={p.tags} className="tz-tags" />
          </section>
          {p.hosts.length > 0 && (
            <section className="tz-side__block" aria-labelledby="tz-hosts">
              <h2 id="tz-hosts" className="tz-side__title">The Hosts</h2>
              <ul className="tz-people">
                {p.hosts.map((h) => (
                  <li key={h.id}>
                    <a href={hostHref(h.slug)}>
                      <Artwork src={h.photo_url} alt={h.name} rounded size={48} />
                      <span><span className="tz-people__name">{h.name}</span>{h.role && <span className="tz-people__role">{h.role}</span>}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="tz-side__block">
            <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tz-listenon" />
          </div>
          <section className="tz-side__block" aria-labelledby="tz-sub">
            <h2 id="tz-sub" className="tz-side__title">Subscribe</h2>
            <p className="tz-side__note">Receive every new episode in the podcast app of your choosing.</p>
            <SubscribeButton feedUrl={page.feed_url} className="tz-subscribe">Follow via RSS</SubscribeButton>
          </section>
          <section className="tz-side__block" aria-labelledby="tz-share">
            <h2 id="tz-share" className="tz-side__title">Share</h2>
            <ShareButtons url={page.canonical_url} title={p.title} className="tz-share" />
          </section>
        </aside>
      </div>

      {page.related.length > 0 && (
        <section className="tz-section" aria-labelledby="tz-archive">
          <SectionHead id="tz-archive" title="From the Archive" subtitle="Further listening, hand-picked" />
          <div className="tz-grid">{page.related.map((r) => <PodcastStory key={r.id} podcast={r} />)}</div>
        </section>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ episode page */

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const lang = site.tenant.language || 'en';
  const quote = firstSentence(e.short_description) || (e.key_topics?.[0] ?? '');
  const guests = e.hosts.filter((g) => !p.hosts.some((h) => h.id === g.id));
  const people = [...p.hosts.map((h) => ({ ...h, label: h.role || 'Host' })), ...guests.map((g) => ({ ...g, label: g.role || 'Guest' }))];
  return (
    <article className="tz-feature">
      <header className="tz-feature__head tz-wrap">
        <p className="tz-kicker tz-kicker--lg">
          <a href={podcastHref(p)}>{p.title}</a>
          {episodeLabel(e) && <span className="tz-kicker__sep"> · {episodeLabel(e)}</span>}
        </p>
        <h1 className="tz-feature__title">{e.title}</h1>
        {e.short_description && <p className="tz-feature__standfirst">{e.short_description}</p>}
        <p className="tz-feature__byline">
          {people.length > 0 && <>With <HostNames hosts={people} /> · </>}
          <time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, lang)}</time>
          {e.duration > 0 && <> · {formatDuration(e.duration)}</>}
          {e.explicit && <> · <Explicit /></>}
        </p>
        <div className="tz-feature__actions">
          <EpisodePlayButton episode={e} variant="pill" className="tz-btn tz-btn--solid" />
          <DownloadLink episode={e} className="tz-btn">Download</DownloadLink>
        </div>
      </header>

      <figure className="tz-feature__fig tz-wrap">
        <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} priority className="tz-feature__img" />
        <figcaption>From <a href={podcastHref(p)}>{p.title}</a>{p.author && <> · {p.author}</>}</figcaption>
      </figure>

      <div className="tz-cols tz-wrap">
        <div className="tz-article">
          <section aria-labelledby="tz-about-ep">
            <h2 id="tz-about-ep" className="tz-h2">About this episode</h2>
            <Prose html={e.description || e.short_description} className="tz-prose tz-dropcap" />
            {quote && (
              <blockquote className="tz-pull">
                <p>{quote}</p>
              </blockquote>
            )}
            {e.show_notes && (
              <>
                <h3 className="tz-h3">Show notes</h3>
                <Prose html={e.show_notes} className="tz-prose" />
              </>
            )}
            <TagList tags={e.tags} className="tz-tags" />
          </section>
          <KeyTopics topics={e.key_topics} title="Key topics" />
          <Transcript episode={e} className="tz-transcript" />
          <FAQ items={e.faq} title="Questions & answers" />
          <Citations items={e.citations} title="Further reading" />
        </div>

        <aside className="tz-side">
          <section className="tz-side__block tz-showcard" aria-labelledby="tz-from">
            <h2 id="tz-from" className="tz-side__title">From the show</h2>
            <a href={podcastHref(p)} className="tz-showcard__link">
              <Artwork src={p.artwork_url} alt={`${p.title} artwork`} size={72} />
              <span>{p.title}</span>
            </a>
          </section>
          {people.length > 0 && (
            <section className="tz-side__block" aria-labelledby="tz-people">
              <h2 id="tz-people" className="tz-side__title">In conversation</h2>
              <ul className="tz-people">
                {people.map((h) => (
                  <li key={h.id}>
                    <a href={hostHref(h.slug)}>
                      <Artwork src={h.photo_url} alt={h.name} rounded size={48} />
                      <span><span className="tz-people__name">{h.name}</span><span className="tz-people__role">{h.label}</span></span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="tz-side__block">
            <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tz-listenon" />
          </div>
          <section className="tz-side__block" aria-labelledby="tz-share-ep">
            <h2 id="tz-share-ep" className="tz-side__title">Share</h2>
            <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tz-share" />
          </section>
        </aside>
      </div>

      {(page.previous || page.next) && (
        <nav className="tz-prevnext tz-wrap" aria-label="Previous and next episodes">
          {page.previous ? (
            <a href={episodeHref(page.previous)} className="tz-prevnext__prev">
              <span className="tz-kicker">← Previous</span>
              <span className="tz-prevnext__title">{page.previous.title}</span>
            </a>
          ) : <span />}
          {page.next && (
            <a href={episodeHref(page.next)} className="tz-prevnext__next">
              <span className="tz-kicker">Next →</span>
              <span className="tz-prevnext__title">{page.next.title}</span>
            </a>
          )}
        </nav>
      )}

      {page.more.length > 0 && (
        <section className="tz-section tz-wrap" aria-labelledby="tz-more">
          <SectionHead id="tz-more" title={`More from ${p.title}`} href={podcastHref(p)} linkLabel="The full index" />
          <div className="tz-eplist tz-eplist--cols">{page.more.map((m) => <EpisodeCard key={m.id} episode={m} showPodcast={false} />)}</div>
        </section>
      )}
    </article>
  );
}

export const magazineTheme: Theme = {
  key: 'magazine',
  name: 'Premium Magazine',
  Layout,
  Player: MagazinePlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tz-grid',
  episodeListClass: 'tz-eplist',
};
