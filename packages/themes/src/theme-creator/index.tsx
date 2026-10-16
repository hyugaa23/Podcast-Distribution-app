// Theme 05 — Creator (PRD §45): host-focused personal-brand layout, large creator photography,
// social links front and centre, featured show, warm rounded cards, floating player card.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, episodeHref, episodeLabel, formatDate, formatDuration, hostHref, plural, podcastHref,
  categoryHref, collectionHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { CreatorPlayer } from './Player';

/** "A", "A & B", "A, B & C" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function uniqueHosts(...lists: HostRef[][]): HostRef[] {
  const seen = new Set<number>();
  const out: HostRef[] = [];
  for (const list of lists) for (const h of list ?? []) if (!seen.has(h.id)) { seen.add(h.id); out.push(h); }
  return out;
}

/** Overlapping circular host avatars. */
function HostStack({ hosts, size = 48, max = 4 }: { hosts: HostRef[]; size?: number; max?: number }) {
  if (hosts.length === 0) return null;
  return (
    <ul className="tc-stack" aria-label="Hosts" style={{ ['--sz' as string]: `${size}px` }}>
      {hosts.slice(0, max).map((h) => (
        <li key={h.id}>
          <a href={hostHref(h.slug)} title={h.name}>
            <Artwork src={h.photo_url} alt={h.name} rounded size={size} />
          </a>
        </li>
      ))}
      {hosts.length > max && <li className="tc-stack__more" aria-label={`and ${hosts.length - max} more`}>+{hosts.length - max}</li>}
    </ul>
  );
}

function HostNames({ hosts }: { hosts: HostRef[] }) {
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

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  return (
    <div className="tc-shell">
      <header className="tc-header" data-nav>
        <div className="tc-header__bar">
          <a href="/" className="tc-brand" aria-label={`${name} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt="" className="tc-brand__avatar" />
              : <span className="tc-brand__avatar tc-brand__avatar--mark" aria-hidden="true">{name.slice(0, 1)}</span>}
            <span className="tc-brand__text">
              <span className="tc-brand__name">{name}</span>
              {site.branding.tagline && <span className="tc-brand__tag">{site.branding.tagline}</span>}
            </span>
          </a>
          <NavToggle className="tc-navtoggle" />
          <div className="tc-header__menu">
            <nav aria-label="Main" className="tc-nav">
              <ul>
                {navItems(site).map((n) => (
                  <li key={n.href + n.label}>
                    <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{n.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="tc-header__tools">
              <SearchBox className="tc-search" placeholder="Search episodes…" />
              <SocialLinks links={site.branding.social_links} className="tc-social" />
            </div>
          </div>
        </div>
      </header>
      <main id="main" className="tc-main">{children}</main>
      <footer className="tc-footer">
        <div className="tc-footer__card">
          <div>
            <p className="tc-footer__name">{name}</p>
            {site.branding.tagline && <p className="tc-footer__tag">{site.branding.tagline}</p>}
          </div>
          <SocialLinks links={site.branding.social_links} className="tc-social tc-social--big" />
        </div>
        <p className="tc-footer__legal">{footerText(site)}</p>
      </footer>
      <CreatorPlayer site={site} />
    </div>
  );
}

function PodcastCard({ podcast }: PodcastCardProps) {
  return (
    <article className="tc-show">
      <a href={podcastHref(podcast)} className="tc-show__art" tabIndex={-1} aria-hidden="true">
        <Artwork src={podcast.artwork_url} alt="" />
      </a>
      <div className="tc-show__body">
        <h3 className="tc-show__title"><a href={podcastHref(podcast)}>{podcast.title}</a></h3>
        {podcast.short_description && <p className="tc-show__desc">{podcast.short_description}</p>}
        <div className="tc-show__foot">
          {podcast.hosts.length > 0
            ? <span className="tc-show__hosts"><HostStack hosts={podcast.hosts} size={28} max={3} /><span>{joinNames(podcast.hosts.map((h) => h.name))}</span></span>
            : <span className="tc-show__hosts">{podcast.author}</span>}
          <span className="tc-chip tc-chip--soft">{plural(podcast.episode_count, 'episode')}</span>
        </div>
      </div>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  const meta = [episodeLabel(episode), formatDate(episode.published_at, 'en', 'short'), formatDuration(episode.duration)].filter(Boolean).join(' · ');
  return (
    <article className="tc-ep">
      <div className="tc-ep__media">
        <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" className="tc-ep__art" size={88} />
        <EpisodePlayButton episode={episode} className="tc-ep__play" />
      </div>
      <div className="tc-ep__body">
        {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="tc-ep__podcast">{episode.podcast_title}</a>}
        <h3 className="tc-ep__title"><a href={episodeHref(episode)}>{episode.title}</a></h3>
        {episode.short_description && <p className="tc-ep__desc">{episode.short_description}</p>}
        <p className="tc-ep__meta">
          {episode.explicit && <span className="tc-badge" title="Explicit">Explicit</span>}
          {meta}
        </p>
      </div>
    </article>
  );
}

function SectionHead({ title, subtitle, href, link = 'See all' }: { title: string; subtitle?: string; href?: string; link?: string }) {
  return (
    <div className="tc-sec__head">
      <div>
        <h2 className="tc-h2">{title}</h2>
        {subtitle && <p className="tc-sec__sub">{subtitle}</p>}
      </div>
      {href && <a className="tc-link" href={href}>{link} <span aria-hidden="true">→</span></a>}
    </div>
  );
}

function Shows({ title, subtitle, href, podcasts }: { title: string; subtitle?: string; href?: string; podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section className="tc-sec" aria-label={title}>
      <SectionHead title={title} subtitle={subtitle} href={href} />
      <div className="tc-shows">{podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}</div>
    </section>
  );
}

function MeetHosts({ hosts, title = 'Meet the hosts' }: { hosts: HostRef[]; title?: string }) {
  if (hosts.length === 0) return null;
  return (
    <section className="tc-sec" aria-label={title}>
      <SectionHead title={title} href="/hosts" link="All hosts" />
      <ul className="tc-hostrow">
        {hosts.map((h) => (
          <li key={h.id}>
            <a href={hostHref(h.slug)}>
              <span className="tc-hostrow__ring"><Artwork src={h.photo_url} alt="" rounded /></span>
              <span className="tc-hostrow__name">{h.name}</span>
              {h.role && <span className="tc-hostrow__role">{h.role}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Hero({ site, home }: HomeProps) {
  const host = home.hosts?.[0];
  const show = home.featured[0];
  if (!host && !show) return null;
  const photo = host?.photo_url || show?.artwork_url;
  const latest = show ? home.latest_episodes.find((e) => e.podcast_id === show.id) : undefined;
  return (
    <section className="tc-hero" aria-labelledby="tc-hero-title">
      <div className="tc-hero__photo">
        <div className="tc-hero__blob" aria-hidden="true" />
        <Artwork src={photo} alt={host ? host.name : `${show?.title} artwork`} className="tc-hero__img" priority />
      </div>
      <div className="tc-hero__intro">
        <p className="tc-wave"><span className="tc-wave__dot" aria-hidden="true" />Welcome to {siteName(site)}</p>
        <h1 id="tc-hero-title" className="tc-hero__title">
          Hi, I&rsquo;m <span className="tc-hl">{host ? host.name : siteName(site)}</span>
        </h1>
        {(site.branding.tagline || show?.short_description) && (
          <p className="tc-hero__lead">{site.branding.tagline || show?.short_description}</p>
        )}
        <ul className="tc-hero__stats" aria-label="At a glance">
          <li><strong>{home.stats.podcasts}</strong> {home.stats.podcasts === 1 ? 'show' : 'shows'}</li>
          <li><strong>{home.stats.episodes}</strong> {home.stats.episodes === 1 ? 'episode' : 'episodes'}</li>
        </ul>
        <SocialLinks links={site.branding.social_links} className="tc-social tc-social--big" />
        {show && (
          <div className="tc-feature">
            <Artwork src={show.artwork_url} alt="" className="tc-feature__art" size={96} />
            <div className="tc-feature__body">
              <p className="tc-eyebrow">Featured show</p>
              <h2 className="tc-feature__title"><a href={podcastHref(show)}>{show.title}</a></h2>
              {latest && <p className="tc-feature__latest">Latest: <a href={episodeHref(latest)}>{latest.title}</a></p>}
              <div className="tc-feature__actions">
                {latest
                  ? <EpisodePlayButton episode={latest} variant="pill" label="Play latest" className="tc-pill-play" />
                  : <a className="tc-btn tc-btn--primary" href={podcastHref(show)}>▶ Listen now</a>}
                <a className="tc-btn" href={podcastHref(show)}>Visit show</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HomeSection({ s, site, home }: { s: HomepageSection } & HomeProps) {
  switch (s.type) {
    case 'hero':
      return (
        <>
          <Hero site={site} home={home} />
          <MeetHosts hosts={home.hosts ?? []} />
        </>
      );
    case 'featured':
      return <Shows title={s.title || 'My shows'} subtitle={s.subtitle} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    case 'trending': case 'popular': case 'editors_picks': case 'new_podcasts':
      return <Shows title={sectionTitle(s)} subtitle={s.subtitle} href="/podcasts" podcasts={sectionPodcasts(home, s.type, s.limit)} />;
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="tc-sec" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} subtitle={s.subtitle} href="/episodes" />
          <div className="tc-eps">{eps.map((e) => <EpisodeCard key={e.id} episode={e} />)}</div>
        </section>
      );
    }
    case 'categories':
      if (home.categories.length === 0) return null;
      return (
        <section className="tc-sec" aria-label={sectionTitle(s)}>
          <SectionHead title={sectionTitle(s)} subtitle={s.subtitle} href="/categories" />
          <ul className="tc-chips">
            {home.categories.slice(0, s.limit || 16).map((c) => (
              <li key={c.id}>
                <a href={categoryHref(c.slug)}>{c.name} <span className="tc-chips__n">{c.podcast_count}</span><span className="pe-sr-only"> {c.podcast_count === 1 ? 'show' : 'shows'}</span></a>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'collections':
      return (
        <>
          {home.collections.map((c) => (
            <Shows key={c.id} title={c.title} subtitle={c.description} href={collectionHref(c.slug)} podcasts={c.podcasts} />
          ))}
        </>
      );
    case 'newsletter':
      return (
        <section className="tc-callout" aria-label={sectionTitle(s)}>
          <div>
            <h2 className="tc-h2">{s.title || 'Let’s stay in touch'}</h2>
            <p>{s.subtitle || `Follow ${siteName(site)} for behind-the-scenes and every new release.`}</p>
          </div>
          <SocialLinks links={site.branding.social_links} className="tc-social tc-social--big" />
        </section>
      );
    case 'cta':
      return (
        <section className="tc-callout tc-callout--bold" aria-label="Call to action">
          <div>
            <h2 className="tc-h2">{s.title || 'Never miss an episode'}</h2>
            {s.subtitle && <p>{s.subtitle}</p>}
          </div>
          <a className="tc-btn tc-btn--light" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse the shows'}</a>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  return (
    <div className="tc-home">
      {enabledSections(props.site).map((s, i) => <HomeSection key={s.type + i} s={s} {...props} />)}
    </div>
  );
}

function PodcastPage({ page }: PodcastPageProps) {
  const p = page.podcast;
  const latest = page.latest_episode;
  return (
    <article className="tc-pod">
      <header className="tc-pod__head">
        <div className="tc-pod__art">
          <Artwork src={p.artwork_url} alt={`${p.title} artwork`} priority />
        </div>
        <div className="tc-pod__info">
          {p.hosts.length > 0 ? (
            <div className="tc-pod__hosts">
              <HostStack hosts={p.hosts} size={56} />
              <p>Hosted by <HostNames hosts={p.hosts} /></p>
            </div>
          ) : p.author && <p className="tc-pod__by">By {p.author}</p>}
          <h1 className="tc-pod__title">{p.title}</h1>
          {p.short_description && <p className="tc-pod__lead">{p.short_description}</p>}
          <ul className="tc-pod__meta" aria-label="Show details">
            {p.categories.length > 0
              ? p.categories.map((c) => <li key={c.id}><a className="tc-chip" href={categoryHref(c.slug)}>{c.name}</a></li>)
              : p.category && <li><a className="tc-chip" href={categoryHref(p.category.slug)}>{p.category.name}</a></li>}
            <li><span className="tc-chip tc-chip--soft">{plural(page.episodes_total, 'episode')}</span></li>
            {p.explicit && <li><span className="tc-badge" title="Explicit">Explicit</span></li>}
          </ul>
          <div className="tc-actions">
            {latest && <EpisodePlayButton episode={latest} variant="pill" label="Play latest" className="tc-pill-play tc-pill-play--big" />}
            <SubscribeButton feedUrl={page.feed_url} className="tc-follow">Follow</SubscribeButton>
          </div>
          <ShareButtons url={page.canonical_url} title={p.title} className="tc-share" />
        </div>
      </header>

      {latest && (
        <section className="tc-latest" aria-labelledby="tc-latest-h">
          <p className="tc-eyebrow" id="tc-latest-h">Latest episode</p>
          <h2 className="tc-latest__title"><a href={episodeHref(latest)}>{latest.title}</a></h2>
          <p className="tc-latest__meta">
            <time dateTime={latest.published_at ?? undefined}>{formatDate(latest.published_at, p.language || 'en')}</time>
            {latest.duration > 0 && ` · ${formatDuration(latest.duration)}`}
          </p>
          {latest.short_description && <p className="tc-latest__desc">{latest.short_description}</p>}
        </section>
      )}

      <section className="tc-sec" aria-labelledby="tc-eps-h">
        <div className="tc-sec__head">
          <div>
            <h2 className="tc-h2" id="tc-eps-h">Episodes</h2>
            {page.seasons.length > 1 && <p className="tc-sec__sub">Seasons {page.seasons.join(', ')}</p>}
          </div>
        </div>
        <div className="tc-eps">
          {page.episodes.map((e) => <EpisodeCard key={e.id} episode={e} showPodcast={false} />)}
        </div>
        {page.episodes_total > page.episodes.length && (
          <p className="tc-center"><a className="tc-btn" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total} episodes</a></p>
        )}
      </section>

      <div className="tc-duo">
        <section className="tc-card" aria-labelledby="tc-about-h">
          <h2 className="tc-h3" id="tc-about-h">About the show</h2>
          <Prose html={p.description || p.short_description} />
          <TagList tags={p.tags} />
        </section>
        <div className="tc-stackcol">
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tc-card" />
          {p.hosts.length > 0 && (
            <section className="tc-card" aria-labelledby="tc-hosts-h">
              <h2 className="tc-h3" id="tc-hosts-h">Your hosts</h2>
              <ul className="tc-people">
                {p.hosts.map((h) => (
                  <li key={h.id}>
                    <a href={hostHref(h.slug)}>
                      <Artwork src={h.photo_url} alt="" rounded size={52} />
                      <span><strong>{h.name}</strong>{h.role && <small>{h.role}</small>}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <Shows title="You might also like" podcasts={page.related} />
    </article>
  );
}

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const people = uniqueHosts(p.hosts, e.hosts);
  const guests = e.hosts.filter((h) => !p.hosts.some((ph) => ph.id === h.id));
  const label = episodeLabel(e);
  return (
    <article className="tc-post">
      <header className="tc-post__head">
        <p className="tc-post__crumb">
          <a href={podcastHref(p)}><span aria-hidden="true">←</span> {p.title}</a>
          {label && <span className="tc-chip tc-chip--soft">{label}</span>}
        </p>
        <h1 className="tc-post__title">{e.title}</h1>
        <div className="tc-post__byline">
          <HostStack hosts={people} size={44} />
          <p>
            {people.length > 0 ? <>with <HostNames hosts={people} /></> : <a href={podcastHref(p)}>{p.author || p.title}</a>}
            <br />
            <span className="tc-muted">
              <time dateTime={e.published_at ?? undefined}>{formatDate(e.published_at, site.tenant.language)}</time>
              {e.duration > 0 && ` · ${formatDuration(e.duration)}`}
              {e.explicit && <span className="tc-badge" title="Explicit">Explicit</span>}
            </span>
          </p>
        </div>
      </header>

      <div className="tc-post__art">
        <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} priority />
      </div>

      <div className="tc-actions tc-actions--center">
        <EpisodePlayButton episode={e} variant="pill" className="tc-pill-play tc-pill-play--big" />
        <DownloadLink episode={e} className="tc-btn">Download</DownloadLink>
      </div>
      <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tc-share tc-share--center" />

      <div className="tc-post__body">
        <section aria-labelledby="tc-about-ep">
          <h2 id="tc-about-ep" className="tc-h2">About this episode</h2>
          <Prose html={e.description || e.short_description} />
          {e.show_notes && (
            <div className="tc-notes">
              <h3 className="tc-h3">Show notes</h3>
              <Prose html={e.show_notes} />
            </div>
          )}
          <TagList tags={e.tags} />
        </section>

        <KeyTopics topics={e.key_topics} />

        {people.length > 0 && (
          <section aria-labelledby="tc-people-h" className="tc-card">
            <h2 id="tc-people-h" className="tc-h3">{guests.length > 0 ? 'Hosts & guests' : 'Your hosts'}</h2>
            <ul className="tc-people">
              {people.map((h) => (
                <li key={h.id}>
                  <a href={hostHref(h.slug)}>
                    <Artwork src={h.photo_url} alt="" rounded size={52} />
                    <span>
                      <strong>{h.name}</strong>
                      <small>{h.role || (guests.some((g) => g.id === h.id) ? 'Guest' : 'Host')}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Transcript episode={e} className="tc-card" />
        <FAQ items={e.faq} />
        <Citations items={e.citations} />
        <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tc-card" />

        {(page.previous || page.next) && (
          <nav className="tc-prevnext" aria-label="Previous and next episodes">
            {page.previous && (
              <a href={episodeHref(page.previous)} className="tc-prevnext__prev">
                <small>← Previous</small><span>{page.previous.title}</span>
              </a>
            )}
            {page.next && (
              <a href={episodeHref(page.next)} className="tc-prevnext__next">
                <small>Next →</small><span>{page.next.title}</span>
              </a>
            )}
          </nav>
        )}
      </div>

      {page.more.length > 0 && (
        <section className="tc-sec" aria-labelledby="tc-more-h">
          <div className="tc-sec__head">
            <h2 className="tc-h2" id="tc-more-h">More from {p.title}</h2>
            <a className="tc-link" href={podcastHref(p)}>See all <span aria-hidden="true">→</span></a>
          </div>
          <div className="tc-eps">{page.more.map((m) => <EpisodeCard key={m.id} episode={m} showPodcast={false} />)}</div>
        </section>
      )}
    </article>
  );
}

export const creatorTheme: Theme = {
  key: 'creator',
  name: 'Creator',
  Layout,
  Player: CreatorPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tc-shows',
  episodeListClass: 'tc-eps',
};
