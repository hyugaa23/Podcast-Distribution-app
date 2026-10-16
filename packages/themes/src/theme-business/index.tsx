// Theme 08 — Business (PRD §41): professional, clean, corporate typography, blue/neutral
// defaults and featured industry topics. White top navigation, SaaS-style split hero with
// KPI stats, bordered cards and table-like episode lists, report-style episode pages and a
// floating, centred player dock.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { CategorySummary, Episode, HomeData, HomepageSection, HostRef, Podcast, Site } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, episodeHref, episodeLabel, formatDate, formatDuration, hostHref, plural, podcastHref,
  categoryHref, collectionHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { BusinessPlayer } from './Player';

/* ------------------------------------------------------------------ helpers */

function languageName(code: string | undefined, uiLang: string): string {
  if (!code) return '';
  try {
    const dn = new Intl.DisplayNames([uiLang || 'en'], { type: 'language' });
    return dn.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function extLink(external?: boolean) {
  return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

function Arrow() {
  return <span className="tb-arrow" aria-hidden="true">→</span>;
}

function SectionHead({ title, subtitle, href, linkLabel = 'View all', id }: { title: string; subtitle?: string; href?: string; linkLabel?: string; id?: string }) {
  return (
    <div className="tb-sechead">
      <div>
        <h2 className="tb-h2" id={id}>{title}</h2>
        {subtitle && <p className="tb-sechead__sub">{subtitle}</p>}
      </div>
      {href && <a className="tb-textlink" href={href}>{linkLabel} <Arrow /></a>}
    </div>
  );
}

function HostList({ hosts }: { hosts: HostRef[] }) {
  return (
    <ul className="tb-people">
      {hosts.map((h) => (
        <li key={h.id}>
          <a href={hostHref(h.slug)}>
            <Artwork src={h.photo_url} alt={h.name} rounded size={40} />
            <span>
              <strong>{h.name}</strong>
              {h.role && <small>{h.role}</small>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ layout */

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  const nav = navItems(site);
  return (
    <div className="tb-shell">
      <header className="tb-header" data-nav>
        <div className="tb-header__inner">
          <a href="/" className="tb-brand" aria-label={`${name} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={name} className="tb-brand__logo" />
              : <span className="tb-brand__mark" aria-hidden="true">{name.slice(0, 1)}</span>}
            <span className="tb-brand__name">{name}</span>
          </a>
          <nav aria-label="Main" className="tb-nav">
            <ul>
              {nav.map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...extLink(n.external)}>{n.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="tb-header__actions">
            <SearchBox className="tb-search" placeholder="Search podcasts, episodes…" />
            <a className="tb-btn tb-btn--primary tb-header__cta" href="/podcasts">Browse podcasts</a>
          </div>
          <NavToggle className="tb-navtoggle" />
        </div>
      </header>

      <main id="main" className="tb-main">{children}</main>

      <footer className="tb-footer">
        <div className="tb-footer__inner">
          <div className="tb-footer__brand">
            <p className="tb-footer__name">{name}</p>
            {site.branding.tagline && <p className="tb-muted">{site.branding.tagline}</p>}
            <SocialLinks links={site.branding.social_links} className="tb-footer__social" />
          </div>
          <nav aria-label="Footer" className="tb-footer__nav">
            <p className="tb-footer__label">Explore</p>
            <ul>
              {nav.map((n) => (
                <li key={n.href + n.label}><a href={n.href} {...extLink(n.external)}>{n.label}</a></li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="tb-footer__bar">
          <p>{footerText(site)}</p>
        </div>
      </footer>

      <BusinessPlayer site={site} />
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function PodcastCard({ podcast }: PodcastCardProps) {
  return (
    <article className="tb-card">
      <a href={podcastHref(podcast)} className="tb-card__link">
        <div className="tb-card__art">
          <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} />
        </div>
        <div className="tb-card__body">
          {podcast.category && <span className="tb-badge">{podcast.category.name}</span>}
          <h3 className="tb-card__title">{podcast.title}</h3>
          {podcast.author && <p className="tb-card__author">{podcast.author}</p>}
          {podcast.short_description && <p className="tb-card__desc">{podcast.short_description}</p>}
          <p className="tb-card__foot">
            <span>{plural(podcast.episode_count, 'episode')}</span>
            {podcast.explicit && <span className="tb-tag-e" title="Explicit">Explicit</span>}
          </p>
        </div>
      </a>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  const label = episodeLabel(episode);
  const date = formatDate(episode.published_at, 'en', 'numeric');
  const dur = formatDuration(episode.duration);
  return (
    <article className={`tb-ep ${showPodcast ? '' : 'tb-ep--noshow'}`}>
      <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" className="tb-ep__art" size={48} />
      <div className="tb-ep__main">
        <a href={episodeHref(episode)} className="tb-ep__title">{episode.title}</a>
        <p className="tb-ep__sub">
          {label && <span className="tb-ep__label">{label}</span>}
          {episode.explicit && <span className="tb-tag-e" title="Explicit">E</span>}
          {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="tb-ep__show-inline">{episode.podcast_title}</a>}
          <span className="tb-ep__meta-inline">{[date, dur].filter(Boolean).join(' · ')}</span>
        </p>
      </div>
      {showPodcast && (
        <a href={podcastHref(episode.podcast_slug)} className="tb-ep__show">{episode.podcast_title}</a>
      )}
      <span className="tb-ep__date">
        {episode.published_at ? <time dateTime={episode.published_at}>{date}</time> : '—'}
      </span>
      <span className="tb-ep__dur">{dur || '—'}</span>
      <EpisodePlayButton episode={episode} className="tb-ep__play" />
    </article>
  );
}

function EpisodeTable({ episodes, showPodcast = true, caption }: { episodes: Episode[]; showPodcast?: boolean; caption?: string }) {
  return (
    <div className="tb-eplist" role="group" aria-label={caption}>
      <div className={`tb-eplist__head ${showPodcast ? '' : 'tb-ep--noshow'}`} aria-hidden="true">
        <span />
        <span>Episode</span>
        {showPodcast && <span>Show</span>}
        <span>Published</span>
        <span>Length</span>
        <span />
      </div>
      {episodes.map((e) => <EpisodeCard key={e.id} episode={e} showPodcast={showPodcast} />)}
    </div>
  );
}

function PodcastGrid({ podcasts }: { podcasts: Podcast[] }) {
  return <div className="tb-grid">{podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}</div>;
}

/** Ranked "leaderboard" table for popular / trending shows. */
function RankList({ podcasts }: { podcasts: Podcast[] }) {
  return (
    <ol className="tb-rank">
      {podcasts.map((p, i) => (
        <li key={p.id}>
          <span className="tb-rank__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <Artwork src={p.artwork_url} alt="" size={52} className="tb-rank__art" />
          <div className="tb-rank__body">
            <a href={podcastHref(p)} className="tb-rank__title">{p.title}</a>
            <span className="tb-rank__by">{p.author}</span>
          </div>
          {p.category && <span className="tb-badge tb-rank__cat">{p.category.name}</span>}
          <span className="tb-rank__eps">{plural(p.episode_count, 'episode')}</span>
        </li>
      ))}
    </ol>
  );
}

function TopicTiles({ categories, compact }: { categories: CategorySummary[]; compact?: boolean }) {
  return (
    <ul className={`tb-topics ${compact ? 'tb-topics--compact' : ''}`}>
      {categories.map((c) => (
        <li key={c.id}>
          <a href={categoryHref(c.slug)}>
            <span className="tb-topics__icon" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
            <span className="tb-topics__text">
              <strong>{c.name}</strong>
              <small>{plural(c.podcast_count, 'podcast')}</small>
            </span>
            <Arrow />
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ home */

function Hero({ site, home }: { site: Site; home: HomeData }) {
  const name = siteName(site);
  const tagline = site.branding.tagline;
  const lead = site.seo.meta_description || tagline || `Expert conversations on business, strategy and leadership from ${name}.`;
  const p = home.featured[0] ?? home.editors_picks[0] ?? home.popular[0] ?? home.new_podcasts[0];
  const latest = p ? home.latest_episodes.find((e) => e.podcast_id === p.id) : undefined;
  const briefs = home.latest_episodes.filter((e) => e.id !== latest?.id).slice(0, 2);
  const stats = [
    { n: home.stats.podcasts, l: 'Podcasts' },
    { n: home.stats.episodes, l: 'Episodes' },
    { n: home.categories.length, l: 'Topics' },
  ];
  return (
    <section className="tb-hero tb-band" aria-labelledby="tb-hero-title">
      <div className="tb-hero__grid">
        <div className="tb-hero__copy">
          <p className="tb-kicker">{name}</p>
          <h1 className="tb-hero__title" id="tb-hero-title">
            {tagline ? tagline : <>Insights for <span className="tb-hl">{name}</span></>}
          </h1>
          <p className="tb-hero__lead">{lead}</p>
          <div className="tb-actions">
            <a className="tb-btn tb-btn--primary tb-btn--lg" href="/podcasts">Browse podcasts</a>
            <a className="tb-btn tb-btn--lg" href="/episodes">Latest episodes</a>
          </div>
          <dl className="tb-kpis">
            {stats.map((s) => (
              <div key={s.l}>
                <dt>{s.l}</dt>
                <dd>{s.n.toLocaleString('en')}</dd>
              </div>
            ))}
          </dl>
        </div>
        {p && (
          <div className="tb-hero__stack">
            <div className="tb-feature">
              <div className="tb-feature__top">
                <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tb-feature__art" priority />
                <div className="tb-feature__info">
                  <p className="tb-kicker tb-kicker--sm">Featured podcast</p>
                  <h2 className="tb-feature__title"><a href={podcastHref(p)}>{p.title}</a></h2>
                  <p className="tb-muted tb-feature__by">{p.author}</p>
                  {p.category && <span className="tb-badge">{p.category.name}</span>}
                </div>
              </div>
              {p.short_description && <p className="tb-feature__desc">{p.short_description}</p>}
              <div className="tb-feature__actions">
                {latest
                  ? <EpisodePlayButton episode={latest} variant="pill" label="Play latest" className="tb-playpill" />
                  : <a className="tb-btn tb-btn--primary" href={podcastHref(p)}>View podcast</a>}
                <span className="tb-muted tb-feature__count">{plural(p.episode_count, 'episode')}</span>
              </div>
            </div>
            {briefs.length > 0 && (
              <div className="tb-brief" aria-label="Latest briefings">
                <p className="tb-kicker tb-kicker--sm">Latest briefings</p>
                <ul>
                  {briefs.map((e) => (
                    <li key={e.id}>
                      <EpisodePlayButton episode={e} className="tb-brief__play" />
                      <span className="tb-brief__text">
                        <a href={episodeHref(e)}>{e.title}</a>
                        <small>{[e.podcast_title, formatDuration(e.duration)].filter(Boolean).join(' · ')}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      {home.categories.length > 0 && (
        <div className="tb-hero__topics">
          <h2 className="tb-h3">Featured industry topics</h2>
          <TopicTiles categories={home.categories.slice(0, 6)} compact />
        </div>
      )}
    </section>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero':
      return <Hero site={site} home={home} />;
    case 'popular': case 'trending': {
      const list = sectionPodcasts(home, s.type, s.limit || 8);
      if (list.length === 0) return null;
      return (
        <section className="tb-section" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} subtitle={s.subtitle} href="/podcasts" />
          <RankList podcasts={list} />
        </section>
      );
    }
    case 'featured': case 'editors_picks': case 'new_podcasts': {
      const list = sectionPodcasts(home, s.type, s.limit);
      if (list.length === 0) return null;
      return (
        <section className="tb-section" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} subtitle={s.subtitle} href="/podcasts" />
          <PodcastGrid podcasts={list} />
        </section>
      );
    }
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="tb-section" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} subtitle={s.subtitle} href="/episodes" />
          <EpisodeTable episodes={eps} caption={sectionTitle(s)} />
        </section>
      );
    }
    case 'categories':
      if (home.categories.length === 0) return null;
      return (
        <section className="tb-section" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} subtitle={s.subtitle || 'Explore shows by industry and discipline.'} href="/categories" />
          <TopicTiles categories={home.categories.slice(0, s.limit || 12)} />
        </section>
      );
    case 'collections':
      if (home.collections.length === 0) return null;
      return (
        <>
          {home.collections.filter((c) => c.podcasts.length > 0).map((c) => (
            <section key={c.id} className="tb-section" aria-label={c.title}>
              <SectionHead title={c.title} subtitle={c.description} href={collectionHref(c.slug)} linkLabel="View collection" />
              <PodcastGrid podcasts={c.podcasts.slice(0, s.limit || 8)} />
            </section>
          ))}
        </>
      );
    case 'newsletter':
      return (
        <section className="tb-section tb-follow" aria-label={sectionTitle(s)}>
          <div>
            <p className="tb-kicker tb-kicker--sm">Stay informed</p>
            <h2 className="tb-h2">{sectionTitle(s)}</h2>
            <p className="tb-muted">{s.subtitle || `Follow ${siteName(site)} for every new episode and industry briefing.`}</p>
          </div>
          <SocialLinks links={site.branding.social_links} className="tb-follow__links" />
        </section>
      );
    case 'cta':
      return (
        <section className="tb-section tb-cta" aria-label="Call to action">
          <div>
            <h2 className="tb-cta__title">{s.title || 'Stay ahead of your industry'}</h2>
            {s.subtitle && <p>{s.subtitle}</p>}
          </div>
          <a className="tb-btn tb-btn--invert tb-btn--lg" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
        </section>
      );
    default:
      return null;
  }
}

/** Podcast ids a podcast-list section would render (used to skip sections that repeat an earlier one). */
function sectionSignature(s: HomepageSection, home: HomeData): string | null {
  if (s.type === 'popular' || s.type === 'trending') return sectionPodcasts(home, s.type, s.limit || 8).map((p) => p.id).join(',');
  if (s.type === 'featured' || s.type === 'editors_picks' || s.type === 'new_podcasts') return sectionPodcasts(home, s.type, s.limit).map((p) => p.id).join(',');
  return null;
}

function Home(props: HomeProps) {
  const seen = new Set<string>();
  const sections = enabledSections(props.site).filter((s) => {
    const sig = sectionSignature(s, props.home);
    if (!sig) return true;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  return (
    <div className="tb-home">
      {sections.map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ podcast page */

function PodcastPage({ site, page }: PodcastPageProps) {
  const p = page.podcast;
  const lang = site.tenant.language;
  const latestDate = page.latest_episode?.published_at ?? p.latest_episode_at;
  const cats = p.categories.length ? p.categories : p.category ? [p.category] : [];
  return (
    <article className="tb-show">
      <header className="tb-band tb-showhead">
        <nav aria-label="Breadcrumb" className="tb-crumbs">
          <ol>
            <li><a href="/">Home</a></li>
            <li><a href="/podcasts">Podcasts</a></li>
            <li><span aria-current="page">{p.title}</span></li>
          </ol>
        </nav>
        <div className="tb-showhead__grid">
          <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tb-showhead__art" priority />
          <div className="tb-showhead__info">
            {cats.length > 0 && (
              <p className="tb-badges">
                {cats.map((c) => <a key={c.id} className="tb-badge" href={categoryHref(c.slug)}>{c.name}</a>)}
                {p.explicit && <span className="tb-tag-e" title="Explicit">Explicit</span>}
              </p>
            )}
            <h1 className="tb-showhead__title">{p.title}</h1>
            <p className="tb-showhead__by">
              {p.hosts.length > 0
                ? <>Hosted by {p.hosts.map((h, i) => <span key={h.id}>{i > 0 && (i === p.hosts.length - 1 ? ' and ' : ', ')}<a href={hostHref(h.slug)}>{h.name}</a></span>)}</>
                : p.author}
            </p>
            {p.short_description && <p className="tb-showhead__desc">{p.short_description}</p>}
            <div className="tb-actions">
              {page.latest_episode && <EpisodePlayButton episode={page.latest_episode} variant="pill" label="Play latest episode" className="tb-playpill" />}
              <SubscribeButton feedUrl={page.feed_url} className="tb-subscribe">Follow podcast</SubscribeButton>
            </div>
          </div>
          <dl className="tb-facts">
            <div><dt>Episodes</dt><dd>{page.episodes_total.toLocaleString('en')}</dd></div>
            {p.language && <div><dt>Language</dt><dd>{languageName(p.language, lang)}</dd></div>}
            {latestDate && <div><dt>Latest episode</dt><dd><time dateTime={latestDate}>{formatDate(latestDate, lang)}</time></dd></div>}
            <div><dt>Format</dt><dd>{p.podcast_type === 'serial' ? 'Serial' : 'Episodic'}</dd></div>
            {p.author && <div><dt>Publisher</dt><dd>{p.author}</dd></div>}
          </dl>
        </div>
      </header>

      <div className="tb-layout">
        <section className="tb-layout__main" aria-labelledby="tb-eps">
          <div className="tb-sechead">
            <div>
              <h2 id="tb-eps" className="tb-h2">Episodes</h2>
              <p className="tb-sechead__sub">
                {plural(page.episodes_total, 'episode')}
                {page.seasons.length > 1 && ` · Seasons ${page.seasons.join(', ')}`}
              </p>
            </div>
          </div>
          {page.episodes.length > 0
            ? <EpisodeTable episodes={page.episodes} showPodcast={false} caption="Episodes" />
            : <p className="tb-muted">No episodes published yet.</p>}
          {page.episodes_total > page.episodes.length && (
            <p className="tb-more">
              <a className="tb-btn" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total.toLocaleString('en')} episodes <Arrow /></a>
            </p>
          )}
        </section>

        <aside className="tb-layout__aside" aria-label="Podcast details">
          <section className="tb-panel" aria-labelledby="tb-about">
            <h2 id="tb-about" className="tb-panel__title">About</h2>
            <Prose html={p.description || p.short_description} />
            <TagList tags={p.tags} />
          </section>
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tb-panel" />
          <section className="tb-panel" aria-labelledby="tb-sub">
            <h2 id="tb-sub" className="tb-panel__title">Subscribe</h2>
            <p className="tb-muted tb-small">Get every new episode in your podcast app via RSS.</p>
            <SubscribeButton feedUrl={page.feed_url} className="tb-subscribe">Copy RSS feed</SubscribeButton>
          </section>
          <section className="tb-panel" aria-labelledby="tb-share">
            <h2 id="tb-share" className="tb-panel__title">Share</h2>
            <ShareButtons url={page.canonical_url} title={p.title} />
          </section>
          {p.hosts.length > 0 && (
            <section className="tb-panel" aria-labelledby="tb-hosts">
              <h2 id="tb-hosts" className="tb-panel__title">Hosts</h2>
              <HostList hosts={p.hosts} />
            </section>
          )}
        </aside>
      </div>

      {page.related.length > 0 && (
        <section className="tb-section" aria-labelledby="tb-related">
          <SectionHead title="Related podcasts" id="tb-related" href="/podcasts" />
          <PodcastGrid podcasts={page.related} />
        </section>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ episode page */

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const lang = site.tenant.language;
  const label = episodeLabel(e);
  const people = [...e.hosts, ...p.hosts.filter((h) => !e.hosts.some((x) => x.id === h.id))];
  return (
    <article className="tb-episode">
      <header className="tb-band tb-ephead">
        <nav aria-label="Breadcrumb" className="tb-crumbs">
          <ol>
            <li><a href="/podcasts">Podcasts</a></li>
            {p.category && <li><a href={categoryHref(p.category.slug)}>{p.category.name}</a></li>}
            <li><a href={podcastHref(p)}>{p.title}</a></li>
            <li><span aria-current="page">{label || 'Episode'}</span></li>
          </ol>
        </nav>
        <p className="tb-kicker">Episode briefing{label && ` · ${label}`}</p>
        <h1 className="tb-ephead__title">{e.title}</h1>
        <ul className="tb-metarow">
          <li><span className="tb-metarow__k">Podcast</span> <a href={podcastHref(p)}>{p.title}</a></li>
          {e.published_at && <li><span className="tb-metarow__k">Published</span> <time dateTime={e.published_at}>{formatDate(e.published_at, lang)}</time></li>}
          {e.duration > 0 && <li><span className="tb-metarow__k">Length</span> {formatDuration(e.duration)}</li>}
          {e.explicit && <li><span className="tb-tag-e" title="Explicit">Explicit</span></li>}
        </ul>
        <div className="tb-actions">
          <EpisodePlayButton episode={e} variant="pill" className="tb-playpill" />
          <DownloadLink episode={e} className="tb-btn">Download MP3</DownloadLink>
          <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tb-share" />
        </div>
      </header>

      <div className="tb-layout">
        <div className="tb-layout__main tb-report">
          <section className="tb-panel tb-panel--lg" aria-labelledby="tb-about-ep">
            <h2 id="tb-about-ep" className="tb-h2">About this episode</h2>
            <Prose html={e.description || e.short_description} />
            {e.show_notes && (
              <div className="tb-notes">
                <h3 className="tb-h3">Show notes</h3>
                <Prose html={e.show_notes} />
              </div>
            )}
            <TagList tags={e.tags} />
          </section>
          <div className="tb-takeaways"><KeyTopics topics={e.key_topics} /></div>
          {people.length > 0 && (
            <section className="tb-panel" aria-labelledby="tb-people">
              <h2 id="tb-people" className="tb-h3">Hosts &amp; guests</h2>
              <HostList hosts={people} />
            </section>
          )}
          <Transcript episode={e} className="tb-panel" />
          <div className="tb-faq"><FAQ items={e.faq} /></div>
          <div className="tb-sources"><Citations items={e.citations} title="Sources" /></div>
          {(page.previous || page.next) && (
            <nav className="tb-prevnext" aria-label="Previous and next episode">
              {page.previous
                ? <a href={episodeHref(page.previous)} className="tb-prevnext__prev"><small>← Previous</small><span>{page.previous.title}</span></a>
                : <span />}
              {page.next && <a href={episodeHref(page.next)} className="tb-prevnext__next"><small>Next →</small><span>{page.next.title}</span></a>}
            </nav>
          )}
        </div>

        <aside className="tb-layout__aside" aria-label="About the show">
          <section className="tb-panel tb-showcard" aria-labelledby="tb-showcard">
            <div className="tb-showcard__top">
              <Artwork src={p.artwork_url} alt={`${p.title} artwork`} size={64} />
              <div>
                <h2 id="tb-showcard" className="tb-showcard__title"><a href={podcastHref(p)}>{p.title}</a></h2>
                <p className="tb-muted tb-small">{p.author}</p>
              </div>
            </div>
            {p.short_description && <p className="tb-small">{p.short_description}</p>}
            <div className="tb-showcard__actions">
              <a className="tb-btn tb-btn--sm" href={podcastHref(p)}>View podcast</a>
              <SubscribeButton feedUrl={page.feed_url} className="tb-subscribe tb-subscribe--sm">Follow</SubscribeButton>
            </div>
          </section>
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tb-panel" />
          {page.more.length > 0 && (
            <section className="tb-panel" aria-labelledby="tb-moreeps">
              <h2 id="tb-moreeps" className="tb-panel__title">More episodes</h2>
              <ul className="tb-minilist">
                {page.more.map((m) => (
                  <li key={m.id}>
                    <a href={episodeHref(m)}>{m.title}</a>
                    <small>
                      {m.published_at && <time dateTime={m.published_at}>{formatDate(m.published_at, lang, 'short')}</time>}
                      {m.duration > 0 && ` · ${formatDuration(m.duration)}`}
                    </small>
                  </li>
                ))}
              </ul>
              <a className="tb-textlink" href={podcastHref(p)}>All episodes <Arrow /></a>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

export const businessTheme: Theme = {
  key: 'business',
  name: 'Business',
  Layout,
  Player: BusinessPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tb-grid',
  episodeListClass: 'tb-eplist',
};
