// Theme 02 — Clean Editorial (PRD §42): white background, large typography, editorial
// layout, minimal cards, large cover art. Built like a premium publication: centered
// masthead, a lead story, numbered essay lists, a typographic index and long-form
// article pages.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Episode, HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, categoryHref, collectionHref, episodeHref, episodeLabel, formatDate, formatDuration,
  hostHref, plural, podcastHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { EditorialPlayer } from './Player';

const siteNameFallback = 'the editors';
const num = (i: number) => String(i + 1).padStart(2, '0');

/** "Alice, Bob and Carol" with host links. */
function Byline({ hosts, fallback }: { hosts: HostRef[]; fallback?: string }) {
  if (hosts.length === 0) return fallback ? <>{fallback}</> : null;
  return (
    <>
      {hosts.map((h, i) => (
        <span key={h.id}>
          {i > 0 && (i === hosts.length - 1 ? ' and ' : ', ')}
          <a href={hostHref(h.slug)} className="te-byline__name">{h.name}</a>
        </span>
      ))}
    </>
  );
}

function SectionHead({ title, kicker, href, linkLabel = 'View all' }: { title: string; kicker?: string; href?: string; linkLabel?: string }) {
  return (
    <header className="te-sechead">
      {kicker && <p className="te-kicker">{kicker}</p>}
      <h2 className="te-sechead__title">{title}</h2>
      {href && <a className="te-more" href={href}>{linkLabel} <span aria-hidden="true">→</span></a>}
    </header>
  );
}

/* ------------------------------------------------------------------ Layout */

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  return (
    <div className="te-shell">
      <header className="te-masthead" data-nav>
        <div className="te-masthead__util te-wrap">
          <a className="te-masthead__edition" href="/episodes">Latest episodes <span aria-hidden="true">→</span></a>
          <SearchBox className="te-search" placeholder="Search the archive…" />
        </div>
        <div className="te-masthead__brand te-wrap">
          <a href="/" className="te-brand" aria-label={`${name} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={name} className="te-brand__logo" />
              : <span className="te-brand__name">{name}</span>}
          </a>
          {site.branding.tagline && <p className="te-brand__tagline">{site.branding.tagline}</p>}
          <NavToggle className="te-navtoggle" />
        </div>
        <nav aria-label="Main" className="te-nav">
          <ul className="te-wrap">
            {navItems(site).map((n) => (
              <li key={n.href + n.label}>
                <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                  {n.label}{n.external && <span className="pe-sr-only"> (opens in a new tab)</span>}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="te-main te-wrap">{children}</main>
      <footer className="te-footer">
        <div className="te-wrap te-footer__inner">
          <p className="te-footer__name">{name}</p>
          {site.branding.tagline && <p className="te-footer__tagline">{site.branding.tagline}</p>}
          <nav aria-label="Footer" className="te-footer__nav">
            <ul>
              {navItems(site).map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <SocialLinks links={site.branding.social_links} className="te-footer__social" />
          <p className="te-footer__copy">{footerText(site)}</p>
        </div>
      </footer>
      <EditorialPlayer site={site} />
    </div>
  );
}

/* ------------------------------------------------------------------ Cards */

function PodcastCard({ podcast }: PodcastCardProps) {
  return (
    <article className="te-card">
      <a href={podcastHref(podcast)} className="te-card__link">
        <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} className="te-card__art" />
        {podcast.category && <p className="te-kicker te-card__kicker">{podcast.category.name}</p>}
        <h3 className="te-card__title">{podcast.title}</h3>
        {podcast.author && <p className="te-card__by">By {podcast.author}</p>}
      </a>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true, index }: EpisodeCardProps) {
  const meta = [episodeLabel(episode), formatDuration(episode.duration)].filter(Boolean).join(' · ');
  return (
    <article className={`te-ep ${index !== undefined ? 'te-ep--numbered' : ''}`}>
      {index !== undefined && <span className="te-ep__num" aria-hidden="true">{num(index)}</span>}
      <div className="te-ep__body">
        {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="te-kicker te-ep__show">{episode.podcast_title}</a>}
        <h3 className="te-ep__title"><a href={episodeHref(episode)}>{episode.title}</a></h3>
        {episode.short_description && <p className="te-ep__deck">{episode.short_description}</p>}
        <p className="te-ep__meta">
          {episode.published_at && <time dateTime={episode.published_at}>{formatDate(episode.published_at, 'en', 'long')}</time>}
          {episode.published_at && meta && ' · '}{meta}
          {episode.explicit && <abbr className="te-explicit" title="Explicit">E</abbr>}
        </p>
        <EpisodePlayButton episode={episode} variant="text" className="te-ep__play" label="Listen" />
      </div>
      <a href={episodeHref(episode)} className="te-ep__artlink" tabIndex={-1} aria-hidden="true">
        <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" className="te-ep__art" />
      </a>
    </article>
  );
}

/* ------------------------------------------------------------------ Home */

function LeadStory({ p, home }: { p: Podcast; home: HomeProps['home'] }) {
  const latest = home.latest_episodes.find((e) => e.podcast_id === p.id);
  const also = home.featured.slice(1, 4);
  return (
    <section className="te-lead" aria-labelledby="te-lead-title">
      <div className="te-lead__grid">
        <div className="te-lead__text">
          <p className="te-kicker">
            Lead story{p.category && <> · <a href={categoryHref(p.category.slug)}>{p.category.name}</a></>}
          </p>
          <h1 id="te-lead-title" className="te-lead__title"><a href={podcastHref(p)}>{p.title}</a></h1>
          {p.short_description && <p className="te-lead__deck">{p.short_description}</p>}
          <p className="te-byline">By <Byline hosts={p.hosts} fallback={p.author || siteNameFallback} />
            {p.episode_count > 0 && <> <span className="te-byline__sep" aria-hidden="true">·</span> {plural(p.episode_count, 'episode')}</>}
          </p>
          <div className="te-lead__actions">
            {latest && <EpisodePlayButton episode={latest} variant="pill" label="Listen to the latest" className="te-pill" />}
            <a className="te-textlink" href={podcastHref(p)}>Read the series <span aria-hidden="true">→</span></a>
          </div>
          {latest && (
            <p className="te-lead__latest">
              <span className="te-kicker">Latest</span>{' '}
              <a href={episodeHref(latest)}>{latest.title}</a>
            </p>
          )}
        </div>
        <figure className="te-lead__figure">
          <Artwork src={p.artwork_url} alt={`${p.title} cover art`} className="te-lead__art" priority />
        </figure>
      </div>
      {also.length > 0 && (
        <ul className="te-lead__also" aria-label="Also featured">
          {also.map((a) => (
            <li key={a.id}>
              <span className="te-kicker">{a.category?.name ?? 'Featured'}</span>
              <a href={podcastHref(a)}>{a.title}</a>
              {a.author && <span className="te-lead__also-by">{a.author}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function PodcastGridSection({ title, kicker, href, podcasts }: { title: string; kicker?: string; href?: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="te-section" aria-label={title}>
      <SectionHead title={title} kicker={kicker} href={href} />
      <div className="te-grid">{podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}</div>
    </section>
  );
}

/** Editor's picks: long-form features with large art and a standfirst. */
function FeatureList({ title, podcasts }: { title: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="te-section" aria-label={title}>
      <SectionHead title={title} kicker="Chosen by the editors" href="/podcasts" />
      <ol className="te-features">
        {podcasts.map((p) => (
          <li key={p.id} className="te-feature">
            <a href={podcastHref(p)} className="te-feature__artlink" tabIndex={-1} aria-hidden="true">
              <Artwork src={p.artwork_url} alt="" className="te-feature__art" />
            </a>
            <div>
              {p.category && <p className="te-kicker">{p.category.name}</p>}
              <h3 className="te-feature__title"><a href={podcastHref(p)}>{p.title}</a></h3>
              {p.short_description && <p className="te-feature__deck">{p.short_description}</p>}
              <p className="te-byline">By <Byline hosts={p.hosts} fallback={p.author || siteNameFallback} /></p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Trending: a ranked "most read" style list. */
function RankedList({ title, podcasts }: { title: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="te-section" aria-label={title}>
      <SectionHead title={title} kicker="Most listened" href="/podcasts" />
      <ol className="te-ranked">
        {podcasts.map((p, i) => (
          <li key={p.id}>
            <span className="te-ranked__num" aria-hidden="true">{i + 1}</span>
            <div className="te-ranked__body">
              <a href={podcastHref(p)} className="te-ranked__title">{p.title}</a>
              <span className="te-ranked__by">{p.author || p.category?.name}</span>
            </div>
            <Artwork src={p.artwork_url} alt="" className="te-ranked__art" size={64} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero': {
      const p = home.featured[0];
      return p ? <LeadStory p={p} home={home} /> : null;
    }
    case 'editors_picks':
      return <FeatureList title={sectionTitle(s)} podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    case 'trending':
      return <RankedList title={sectionTitle(s)} podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    case 'featured': case 'popular': case 'new_podcasts':
      return (
        <PodcastGridSection
          title={sectionTitle(s)}
          kicker={s.subtitle || (s.type === 'new_podcasts' ? 'Just launched' : s.type === 'popular' ? 'Reader favourites' : 'In focus')}
          href="/podcasts"
          podcasts={sectionPodcasts(home, s.type, s.limit)}
        />
      );
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="te-section" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} kicker={s.subtitle || 'The latest'} href="/episodes" />
          <div className="te-eplist">{eps.map((e, i) => <EpisodeCard key={e.id} episode={e} index={i} />)}</div>
        </section>
      );
    }
    case 'categories': {
      const cats = home.categories.slice(0, s.limit || 24);
      if (cats.length === 0) return null;
      return (
        <section className="te-section" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} kicker={s.subtitle || 'Index'} href="/categories" linkLabel="Full index" />
          <ul className="te-index">
            {cats.map((c) => (
              <li key={c.id}>
                <a href={categoryHref(c.slug)}>
                  <span className="te-index__name">{c.name}</span>
                  <span className="te-index__dots" aria-hidden="true" />
                  <span className="te-index__count">{plural(c.podcast_count, 'show')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    case 'collections':
      if (home.collections.length === 0) return null;
      return (
        <>
          {home.collections.map((c) => (
            c.podcasts.length === 0 ? null : (
              <section key={c.id} className="te-section te-collection" aria-label={c.title}>
                <SectionHead title={c.title} kicker="Collection" href={collectionHref(c.slug)} linkLabel="Open collection" />
                {c.description && <p className="te-collection__desc">{c.description}</p>}
                <div className="te-grid">{c.podcasts.map((p) => <PodcastCard key={p.id} podcast={p} />)}</div>
              </section>
            )
          ))}
        </>
      );
    case 'newsletter':
      return (
        <section className="te-notice" aria-label={sectionTitle(s)}>
          <p className="te-kicker">Stay with us</p>
          <h2 className="te-notice__title">{sectionTitle(s)}</h2>
          <p className="te-notice__text">{s.subtitle || `Follow ${siteName(site)} for every new release.`}</p>
          <SocialLinks links={site.branding.social_links} className="te-notice__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="te-notice te-notice--cta" aria-label="Call to action">
          <h2 className="te-notice__title">{s.title || 'Never miss an episode'}</h2>
          {s.subtitle && <p className="te-notice__text">{s.subtitle}</p>}
          <a className="te-pill te-pill--solid" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  return (
    <div className="te-home">
      {enabledSections(props.site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ Podcast page */

function PodcastPage({ page }: PodcastPageProps) {
  const p = page.podcast;
  const latest = page.latest_episode;
  const cats = p.categories.length ? p.categories : p.category ? [p.category] : [];
  return (
    <article className="te-show">
      <header className="te-arthead">
        <p className="te-kicker">
          Podcast{p.category && <> · <a href={categoryHref(p.category.slug)}>{p.category.name}</a></>}
        </p>
        <h1 className="te-arthead__title">{p.title}</h1>
        {p.short_description && <p className="te-arthead__deck">{p.short_description}</p>}
        <p className="te-byline">
          {p.hosts.length > 0 ? <>Hosted by <Byline hosts={p.hosts} /></> : p.author && <>By {p.author}</>}
          <span className="te-byline__sep" aria-hidden="true"> · </span>
          {plural(page.episodes_total, 'episode')}
          {p.explicit && <abbr className="te-explicit" title="Explicit">E</abbr>}
        </p>
      </header>
      <figure className="te-cover">
        <Artwork src={p.artwork_url} alt={`${p.title} cover art`} className="te-cover__art" priority />
      </figure>
      <div className="te-actions">
        {latest && <EpisodePlayButton episode={latest} variant="pill" label="Play latest episode" className="te-pill" />}
        <SubscribeButton feedUrl={page.feed_url} className="te-subscribe">Subscribe</SubscribeButton>
        <ShareButtons url={page.canonical_url} title={p.title} className="te-share" />
      </div>

      <div className="te-columns">
        <div className="te-columns__main">
          {latest && (
            <section className="te-latest" aria-labelledby="te-latest-h">
              <h2 id="te-latest-h" className="te-kicker">Latest episode</h2>
              <h3 className="te-latest__title"><a href={episodeHref(latest)}>{latest.title}</a></h3>
              {latest.short_description && <p className="te-latest__deck">{latest.short_description}</p>}
              <p className="te-ep__meta">
                {latest.published_at && <time dateTime={latest.published_at}>{formatDate(latest.published_at, 'en', 'long')}</time>}
                {latest.duration > 0 && ` · ${formatDuration(latest.duration)}`}
              </p>
            </section>
          )}
          <section aria-labelledby="te-eps-h">
            <h2 id="te-eps-h" className="te-h2">All episodes</h2>
            {page.seasons.length > 1 && (
              <p className="te-muted">{page.seasons.length} seasons: {page.seasons.map((n) => `Season ${n}`).join(', ')}</p>
            )}
            <div className="te-eplist">
              {page.episodes.map((e, i) => <EpisodeCard key={e.id} episode={e} showPodcast={false} index={i} />)}
            </div>
            {page.episodes_total > page.episodes.length && (
              <p className="te-allink">
                <a className="te-textlink" href={`/episodes?podcast=${p.slug}`}>Read all {page.episodes_total} episodes <span aria-hidden="true">→</span></a>
              </p>
            )}
          </section>
        </div>
        <aside className="te-columns__side" aria-label="About this podcast">
          <section className="te-sidebox">
            <h2 className="te-sidebox__title">About the show</h2>
            <Prose html={p.description || p.short_description} className="te-sidebox__prose" />
            <TagList tags={p.tags} className="te-tags" />
          </section>
          {cats.length > 0 && (
            <section className="te-sidebox">
              <h2 className="te-sidebox__title">Filed under</h2>
              <ul className="te-sidelist">
                {cats.map((c) => <li key={c.id}><a href={categoryHref(c.slug)}>{c.name}</a></li>)}
              </ul>
            </section>
          )}
          {p.hosts.length > 0 && (
            <section className="te-sidebox">
              <h2 className="te-sidebox__title">{p.hosts.length > 1 ? 'Hosts' : 'Host'}</h2>
              <ul className="te-people">
                {p.hosts.map((h) => (
                  <li key={h.id}>
                    <a href={hostHref(h.slug)}>
                      <Artwork src={h.photo_url} alt="" rounded size={48} />
                      <span><strong>{h.name}</strong>{h.role && <small>{h.role}</small>}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="te-sidebox te-listen" />
          <section className="te-sidebox">
            <h2 className="te-sidebox__title">Subscribe</h2>
            <p className="te-muted">Follow the show in any podcast app and never miss an episode.</p>
            <SubscribeButton feedUrl={page.feed_url} className="te-subscribe">Get the RSS feed</SubscribeButton>
          </section>
        </aside>
      </div>

      <PodcastGridSection title="Further listening" kicker="Related" podcasts={page.related} />
    </article>
  );
}

/* ------------------------------------------------------------------ Episode page */

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const people: HostRef[] = [...e.hosts, ...p.hosts.filter((h) => !e.hosts.some((g) => g.id === h.id))];
  const guestIds = new Set(e.hosts.filter((h) => !p.hosts.some((ph) => ph.id === h.id)).map((h) => h.id));
  return (
    <article className="te-article">
      <header className="te-arthead">
        <p className="te-kicker">
          <a href={podcastHref(p)}>{p.title}</a>
          {episodeLabel(e) && <> · {episodeLabel(e)}</>}
        </p>
        <h1 className="te-arthead__title te-arthead__title--ep">{e.title}</h1>
        {e.short_description && <p className="te-arthead__deck">{e.short_description}</p>}
        <p className="te-byline">
          {p.hosts.length > 0 ? <>With <Byline hosts={p.hosts} /></> : p.author && <>By {p.author}</>}
          {e.published_at && <><span className="te-byline__sep" aria-hidden="true"> · </span><time dateTime={e.published_at}>{formatDate(e.published_at, site.tenant.language, 'long')}</time></>}
          {e.duration > 0 && <><span className="te-byline__sep" aria-hidden="true"> · </span>{formatDuration(e.duration)} listen</>}
          {e.explicit && <abbr className="te-explicit" title="Explicit">E</abbr>}
        </p>
      </header>
      <figure className="te-cover te-cover--wide">
        <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} className="te-cover__art" priority />
        <figcaption>From <a href={podcastHref(p)}>{p.title}</a></figcaption>
      </figure>
      <div className="te-actions">
        <EpisodePlayButton episode={e} variant="pill" className="te-pill" />
        <DownloadLink episode={e} className="te-textlink">Download audio</DownloadLink>
        <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="te-share" />
      </div>

      <div className="te-body">
        <section aria-labelledby="te-about-ep">
          <h2 id="te-about-ep" className="te-h2">About this episode</h2>
          <div className="te-dropcap">
            <Prose html={e.description || e.short_description} />
          </div>
          {e.show_notes && (
            <div className="te-notes">
              <h3 className="te-h3">Show notes</h3>
              <Prose html={e.show_notes} />
            </div>
          )}
          <TagList tags={e.tags} className="te-tags" />
        </section>

        <KeyTopics topics={e.key_topics} />

        {people.length > 0 && (
          <section aria-labelledby="te-people-h" className="te-contrib">
            <h2 id="te-people-h" className="te-h2">Hosts &amp; guests</h2>
            <ul className="te-people te-people--row">
              {people.map((h) => (
                <li key={h.id}>
                  <a href={hostHref(h.slug)}>
                    <Artwork src={h.photo_url} alt="" rounded size={56} />
                    <span>
                      <strong>{h.name}</strong>
                      <small>{h.role || (guestIds.has(h.id) ? 'Guest' : 'Host')}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Transcript episode={e} className="te-transcript" />
        <FAQ items={e.faq} />
        <Citations items={e.citations} />

        <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="te-listen te-listen--inline" />

        {(page.previous || page.next) && (
          <nav className="te-prevnext" aria-label="Previous and next episodes">
            {page.previous ? (
              <a href={episodeHref(page.previous)} className="te-prevnext__prev" rel="prev">
                <span className="te-kicker">← Previous</span>
                <span className="te-prevnext__title">{page.previous.title}</span>
              </a>
            ) : <span />}
            {page.next && (
              <a href={episodeHref(page.next)} className="te-prevnext__next" rel="next">
                <span className="te-kicker">Next →</span>
                <span className="te-prevnext__title">{page.next.title}</span>
              </a>
            )}
          </nav>
        )}
      </div>

      <MoreEpisodes podcast={p} episodes={page.more} />
    </article>
  );
}

function MoreEpisodes({ podcast, episodes }: { podcast: Podcast; episodes: Episode[] }) {
  if (episodes.length === 0) return null;
  return (
    <section className="te-section te-more-eps" aria-label={`More from ${podcast.title}`}>
      <SectionHead title={`More from ${podcast.title}`} kicker="Keep listening" href={podcastHref(podcast)} linkLabel="All episodes" />
      <div className="te-eplist">{episodes.map((m, i) => <EpisodeCard key={m.id} episode={m} showPodcast={false} index={i} />)}</div>
    </section>
  );
}

export const editorialTheme: Theme = {
  key: 'editorial',
  name: 'Clean Editorial',
  Layout,
  Player: EditorialPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'te-grid',
  episodeListClass: 'te-eplist',
};
