// Theme 04 — Minimal (PRD §44): extreme whitespace, simple typography, minimal navigation,
// large podcast artwork, few distractions. One quiet centred column, a "Menu" overlay and a
// small floating pill player.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Episode, HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, episodeHref, episodeLabel, formatDate, formatDuration, hostHref, podcastHref,
  categoryHref, collectionHref, plural,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { MinimalPlayer } from './Player';

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  return (
    <div className="tm-shell">
      <header className="tm-header" data-nav>
        <div className="tm-header__bar">
          <a href="/" className="tm-brand" aria-label={`${name} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt={name} className="tm-brand__logo" />
              : <span>{name}</span>}
          </a>
          <NavToggle className="tm-menubtn" label="Open menu" />
        </div>
        <div className="tm-menu">
          <div className="tm-menu__inner">
            <SearchBox className="tm-search" placeholder="Search" />
            <nav aria-label="Main" className="tm-nav">
              <ul>
                {navItems(site).map((n) => (
                  <li key={n.href + n.label}>
                    <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <SocialLinks links={site.branding.social_links} className="tm-menu__social" />
          </div>
        </div>
      </header>
      <main id="main" className="tm-main">{children}</main>
      <footer className="tm-footer">
        {site.branding.tagline && <p>{site.branding.tagline}</p>}
        <SocialLinks links={site.branding.social_links} className="tm-footer__social" />
        <p className="tm-muted">{footerText(site)}</p>
      </footer>
      <MinimalPlayer site={site} />
    </div>
  );
}

function SectionHead({ title, href, linkLabel = 'View all' }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="tm-sechead">
      <h2 className="tm-label">{title}</h2>
      {href && <a href={href} className="tm-textlink">{linkLabel}</a>}
    </div>
  );
}

function PodcastCard({ podcast }: PodcastCardProps) {
  return (
    <article className="tm-card">
      <a href={podcastHref(podcast)} className="tm-card__link">
        <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} className="tm-card__art" />
        <h3 className="tm-card__title">{podcast.title}</h3>
        {(podcast.author || podcast.category?.name) && <p className="tm-card__sub">{podcast.author || podcast.category?.name}</p>}
      </a>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  return (
    <article className="tm-ep">
      <EpisodePlayButton episode={episode} className="tm-ep__play" />
      <div className="tm-ep__body">
        <a href={episodeHref(episode)} className="tm-ep__title">{episode.title}</a>
        <p className="tm-ep__meta">
          {showPodcast && <><a href={podcastHref(episode.podcast_slug)}>{episode.podcast_title}</a>{' — '}</>}
          {episodeLabel(episode) && <>{episodeLabel(episode)}{' — '}</>}
          {episode.published_at && <time dateTime={episode.published_at}>{formatDate(episode.published_at, 'en', 'short')}</time>}
          {episode.duration > 0 && <>{episode.published_at ? ' — ' : ''}{formatDuration(episode.duration)}</>}
          {episode.explicit && <span className="tm-explicit" title="Explicit">Explicit</span>}
        </p>
      </div>
    </article>
  );
}

function Stack({ title, href, podcasts }: { title: string; href?: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tm-section" aria-label={title}>
      <SectionHead title={title} href={href} />
      <div className="tm-grid">
        {podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}
      </div>
    </section>
  );
}

function EpisodeList({ episodes, showPodcast = true }: { episodes: Episode[]; showPodcast?: boolean }) {
  return (
    <div className="tm-eplist">
      {episodes.map((e, i) => <EpisodeCard key={e.id} episode={e} showPodcast={showPodcast} index={i} />)}
    </div>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero': {
      const p = home.featured[0];
      if (!p) return null;
      return (
        <section className="tm-hero" aria-label="Featured podcast">
          <a href={podcastHref(p)} className="tm-hero__artlink" tabIndex={-1} aria-hidden="true">
            <Artwork src={p.artwork_url} alt="" className="tm-hero__art" priority />
          </a>
          <h1 className="tm-hero__title">{p.title}</h1>
          {p.short_description && <p className="tm-hero__desc">{p.short_description}</p>}
          <a href={podcastHref(p)} className="tm-textlink tm-hero__cta">Listen <span aria-hidden="true">→</span></a>
        </section>
      );
    }
    case 'featured': case 'trending': case 'popular': case 'editors_picks': case 'new_podcasts':
      return <Stack title={sectionTitle(s)} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="tm-section tm-section--narrow" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} href="/episodes" />
          <EpisodeList episodes={eps} />
        </section>
      );
    }
    case 'categories': {
      const cats = home.categories.slice(0, s.limit || 24);
      if (cats.length === 0) return null;
      return (
        <section className="tm-section tm-section--narrow" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} href="/categories" />
          <ul className="tm-inline">
            {cats.map((c) => (
              <li key={c.id}><a href={categoryHref(c.slug)} title={plural(c.podcast_count, 'show')}>{c.name}</a></li>
            ))}
          </ul>
        </section>
      );
    }
    case 'collections':
      return (
        <>
          {home.collections.map((c) => <Stack key={c.id} title={c.title} href={collectionHref(c.slug)} podcasts={c.podcasts} />)}
        </>
      );
    case 'newsletter':
      return (
        <section className="tm-section tm-quiet" aria-label={sectionTitle(s)}>
          <h2 className="tm-label">{sectionTitle(s)}</h2>
          <p className="tm-quiet__text">{s.subtitle || `Follow ${siteName(site)} for every new release.`}</p>
          <SocialLinks links={site.branding.social_links} className="tm-quiet__social" />
        </section>
      );
    case 'cta':
      return (
        <section className="tm-section tm-quiet" aria-label="Call to action">
          <h2 className="tm-quiet__title">{s.title || 'Never miss an episode'}</h2>
          {s.subtitle && <p className="tm-quiet__text">{s.subtitle}</p>}
          <a className="tm-btn" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  return (
    <div className="tm-home">
      {enabledSections(props.site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

function PeopleList({ people }: { people: HostRef[] }) {
  return (
    <ul className="tm-people">
      {people.map((h) => (
        <li key={h.id}>
          <a href={hostHref(h.slug)}>
            <Artwork src={h.photo_url} alt="" rounded size={40} className="tm-people__photo" />
            <span>{h.name}{h.role && <small className="tm-muted"> {h.role}</small>}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function PodcastPage({ site, page }: PodcastPageProps) {
  const p = page.podcast;
  const cats = p.categories.length > 0 ? p.categories : p.category ? [p.category] : [];
  const latest = page.latest_episode;
  return (
    <article className="tm-show">
      <header className="tm-head">
        <Artwork src={p.artwork_url} alt={`${p.title} artwork`} className="tm-head__art" priority />
        <h1 className="tm-head__title">{p.title}</h1>
        <p className="tm-head__meta">
          {p.hosts.length > 0
            ? p.hosts.map((h, i) => <span key={h.id}>{i > 0 && ', '}<a href={hostHref(h.slug)}>{h.name}</a></span>)
            : p.author}
          {cats.length > 0 && <>{' · '}{cats.map((c, i) => <span key={c.id}>{i > 0 && ', '}<a href={categoryHref(c.slug)}>{c.name}</a></span>)}</>}
          {' · '}{plural(page.episodes_total, 'episode')}
          {p.explicit && <span className="tm-explicit" title="Explicit">Explicit</span>}
        </p>
        {latest && (
          <div className="tm-head__actions">
            <EpisodePlayButton episode={latest} variant="pill" label="Play latest" className="tm-pillplay" />
            <p className="tm-head__latest">
              Latest: <a href={episodeHref(latest)}>{latest.title}</a>
              {latest.published_at && <> · <time dateTime={latest.published_at}>{formatDate(latest.published_at, site.tenant.language, 'short')}</time></>}
            </p>
          </div>
        )}
      </header>

      <section className="tm-block" aria-labelledby="tm-eps">
        <h2 id="tm-eps" className="tm-label">Episodes</h2>
        {page.seasons.length > 1 && <p className="tm-muted tm-small">Seasons {page.seasons.join(', ')}</p>}
        <EpisodeList episodes={page.episodes} showPodcast={false} />
        {page.episodes_total > page.episodes.length && (
          <p className="tm-more"><a className="tm-textlink" href={`/episodes?podcast=${p.slug}`}>All {page.episodes_total} episodes →</a></p>
        )}
      </section>

      <section className="tm-block" aria-labelledby="tm-about">
        <h2 id="tm-about" className="tm-label">About</h2>
        <Prose html={p.description || p.short_description} className="tm-prose" />
        <TagList tags={p.tags} className="tm-tags" />
      </section>

      {p.hosts.length > 0 && (
        <section className="tm-block" aria-labelledby="tm-hosts">
          <h2 id="tm-hosts" className="tm-label">Hosted by</h2>
          <PeopleList people={p.hosts} />
        </section>
      )}

      <section className="tm-block" aria-labelledby="tm-follow">
        <h2 id="tm-follow" className="tm-label">Follow</h2>
        <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} title={null} className="tm-listen" />
        <div className="tm-actions">
          <SubscribeButton feedUrl={page.feed_url} className="tm-subscribe">Subscribe</SubscribeButton>
          <ShareButtons url={page.canonical_url} title={p.title} className="tm-share" />
        </div>
      </section>

      {page.related.length > 0 && (
        <section className="tm-block tm-block--wide" aria-labelledby="tm-related">
          <h2 id="tm-related" className="tm-label">You might also like</h2>
          <div className="tm-grid">{page.related.map((r, i) => <PodcastCard key={r.id} podcast={r} index={i} />)}</div>
        </section>
      )}
    </article>
  );
}

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const guests = e.hosts.filter((h) => !p.hosts.some((ph) => ph.id === h.id));
  return (
    <article className="tm-episode">
      <header className="tm-head">
        <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} className="tm-head__art" priority />
        <p className="tm-label tm-head__eyebrow"><a href={podcastHref(p)}>{p.title}</a></p>
        <h1 className="tm-head__title tm-head__title--ep">{e.title}</h1>
        <p className="tm-head__meta">
          {episodeLabel(e) && <>{episodeLabel(e)}{' · '}</>}
          <time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, site.tenant.language)}</time>
          {e.duration > 0 && <>{' · '}{formatDuration(e.duration)}</>}
          {e.explicit && <span className="tm-explicit" title="Explicit">Explicit</span>}
        </p>
        <div className="tm-head__actions">
          <EpisodePlayButton episode={e} variant="pill" className="tm-pillplay" />
          <DownloadLink episode={e} className="tm-textlink">Download</DownloadLink>
        </div>
      </header>

      <div className="tm-read">
        <section className="tm-block" aria-labelledby="tm-about-ep">
          <h2 id="tm-about-ep" className="tm-label">About this episode</h2>
          <Prose html={e.description || e.short_description} className="tm-prose" />
          <Prose html={e.show_notes} className="tm-prose tm-notes" />
          <TagList tags={e.tags} className="tm-tags" />
        </section>

        <div className="tm-block"><KeyTopics topics={e.key_topics} /></div>

        {(p.hosts.length > 0 || guests.length > 0) && (
          <section className="tm-block" aria-labelledby="tm-people">
            <h2 id="tm-people" className="tm-label">People</h2>
            {p.hosts.length > 0 && <><h3 className="tm-small tm-muted">Hosts</h3><PeopleList people={p.hosts} /></>}
            {guests.length > 0 && <><h3 className="tm-small tm-muted">Guests</h3><PeopleList people={guests} /></>}
          </section>
        )}

        <Transcript episode={e} className="tm-block tm-transcript" />
        <div className="tm-block tm-aeo"><FAQ items={e.faq} /></div>
        <div className="tm-block tm-aeo"><Citations items={e.citations} /></div>

        <section className="tm-block" aria-labelledby="tm-listen-ep">
          <h2 id="tm-listen-ep" className="tm-label">Listen &amp; share</h2>
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} title={null} className="tm-listen" />
          <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tm-share" />
        </section>

        {(page.previous || page.next) && (
          <nav className="tm-block tm-prevnext" aria-label="Previous and next episodes">
            {page.previous && (
              <a href={episodeHref(page.previous)} className="tm-prevnext__prev"><small className="tm-label">Previous</small><span>{page.previous.title}</span></a>
            )}
            {page.next && (
              <a href={episodeHref(page.next)} className="tm-prevnext__next"><small className="tm-label">Next</small><span>{page.next.title}</span></a>
            )}
          </nav>
        )}

        {page.more.length > 0 && (
          <section className="tm-block" aria-labelledby="tm-more">
            <div className="tm-sechead">
              <h2 id="tm-more" className="tm-label">More from {p.title}</h2>
              <a href={podcastHref(p)} className="tm-textlink">All episodes</a>
            </div>
            <EpisodeList episodes={page.more} showPodcast={false} />
          </section>
        )}
      </div>
    </article>
  );
}

export const minimalTheme: Theme = {
  key: 'minimal',
  name: 'Minimal',
  Layout,
  Player: MinimalPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tm-grid',
  episodeListClass: 'tm-eplist',
};
