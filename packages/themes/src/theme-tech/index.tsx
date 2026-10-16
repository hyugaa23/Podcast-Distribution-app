// Theme 07 — Tech (PRD §47): modern dark/light hybrid, gradient accents, technical
// (monospace) typography and compact cards. Dark header/hero bands over a light,
// dense, documentation-like content area.
import type { Theme, EpisodeCardProps, EpisodePageProps, HomeProps, LayoutProps, PodcastCardProps, PodcastPageProps } from '../contract';
import type { Episode, HomepageSection, HostRef, Podcast } from '@podcast/types';
import {
  Artwork, Citations, DownloadLink, EpisodePlayButton, FAQ, KeyTopics, ListenOnButtons, NavToggle, Prose, SearchBox, ShareButtons,
  SocialLinks, SubscribeButton, TagList, Transcript, categoryHref, collectionHref, episodeHref, episodeLabel, formatDate, hostHref,
  plural, podcastHref,
} from '@podcast/ui';
import { enabledSections, footerText, navItems, sectionEpisodes, sectionPodcasts, sectionTitle, siteName } from '../shared';
import { TechPlayer } from './Player';

/* ---------- mono formatting helpers ---------- */

/** 2026-10-01 */
function isoDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** 42m · 1h05m */
function shortDur(sec: number): string {
  if (!sec || sec < 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(sec)}s`;
}

/** ep.12 · s2e12 · trailer · bonus */
function epTag(e: Episode): string {
  if (e.episode_type === 'trailer') return 'trailer';
  const n = e.episode_number ? (e.season_number ? `s${e.season_number}e${e.episode_number}` : `ep.${e.episode_number}`) : '';
  if (e.episode_type === 'bonus') return n ? `bonus ${n}` : 'bonus';
  return n;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function Explicit() {
  return <span className="tk-badge tk-badge--warn" title="Explicit content">explicit</span>;
}

function uniqueHosts(...lists: HostRef[][]): HostRef[] {
  const seen = new Set<number>();
  return lists.flat().filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
}

/* ---------- Layout ---------- */

function Layout({ site, children }: LayoutProps) {
  const name = siteName(site);
  return (
    <div className="tk-shell">
      <header className="tk-top" data-nav>
        <div className="tk-wrap tk-top__inner">
          <a href="/" className="tk-brand" aria-label={`${name} home`}>
            {site.branding.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={site.branding.logo_url} alt="" className="tk-brand__logo" />
              : <span className="tk-brand__mark" aria-hidden="true">{'>_'}</span>}
            <span className="tk-brand__name">{name}</span>
          </a>
          <nav aria-label="Main" className="tk-nav">
            <ul>
              {navItems(site).map((n) => (
                <li key={n.href + n.label}>
                  <a href={n.href} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {n.label}{n.external && <span aria-hidden="true" className="tk-nav__ext">↗</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="tk-searchwrap">
            <SearchBox className="tk-search" placeholder="Search shows, episodes…" />
            <kbd className="tk-kbd" aria-hidden="true">⌘K</kbd>
          </div>
          <NavToggle className="tk-navtoggle" />
        </div>
      </header>
      <main id="main" className="tk-main">{children}</main>
      <footer className="tk-foot">
        <div className="tk-wrap tk-foot__inner">
          <div>
            <p className="tk-foot__brand"><span className="tk-brand__mark" aria-hidden="true">{'>_'}</span> {name}</p>
            {site.branding.tagline && <p className="tk-foot__tag">{site.branding.tagline}</p>}
          </div>
          <SocialLinks links={site.branding.social_links} className="tk-foot__social" />
          <p className="tk-foot__legal"><span className="tk-dot" aria-hidden="true" /> {footerText(site)}</p>
        </div>
      </footer>
      <TechPlayer site={site} />
    </div>
  );
}

/* ---------- Cards ---------- */

function PodcastCard({ podcast }: PodcastCardProps) {
  const meta = [plural(podcast.episode_count, 'ep'), podcast.category?.name, podcast.language].filter(Boolean).join(' · ');
  return (
    <article className="tk-pc">
      <Artwork src={podcast.artwork_url} alt={`${podcast.title} artwork`} size={64} className="tk-pc__art" />
      <div className="tk-pc__body">
        <h3 className="tk-pc__title"><a href={podcastHref(podcast)} className="tk-stretch">{podcast.title}</a></h3>
        {podcast.author && <p className="tk-pc__by">{podcast.author}</p>}
        <p className="tk-mono tk-pc__meta">{meta}{podcast.explicit && <> · <Explicit /></>}</p>
      </div>
    </article>
  );
}

function EpisodeCard({ episode, showPodcast = true }: EpisodeCardProps) {
  const head = [epTag(episode), shortDur(episode.duration)].filter(Boolean).join(' · ');
  return (
    <article className="tk-ec">
      <Artwork src={episode.artwork_url || episode.podcast_artwork_url} alt="" size={64} className="tk-ec__art" />
      <div className="tk-ec__body">
        <a href={episodeHref(episode)} className="tk-ec__title">{episode.title}</a>
        {showPodcast && <a href={podcastHref(episode.podcast_slug)} className="tk-ec__show">{episode.podcast_title}</a>}
        <p className="tk-mono tk-ec__meta">
          {head}{head && episode.published_at && ' · '}
          {episode.published_at && <time dateTime={episode.published_at}>{isoDate(episode.published_at)}</time>}
          {episode.explicit && <> · <Explicit /></>}
        </p>
      </div>
      <EpisodePlayButton episode={episode} className="tk-ec__play" />
    </article>
  );
}

/** Compact numbered episode row (podcast page). */
function EpisodeRow({ episode, n, latest }: { episode: Episode; n: number; latest?: boolean }) {
  return (
    <li className="tk-row">
      <span className="tk-row__n tk-mono" aria-hidden="true">{pad2(episode.episode_number ?? n)}</span>
      <div className="tk-row__body">
        <a href={episodeHref(episode)} className="tk-row__title">{episode.title}</a>
        {latest && <span className="tk-badge tk-badge--new">latest</span>}
        {episode.short_description && <p className="tk-row__desc">{episode.short_description}</p>}
        <p className="tk-mono tk-row__meta">
          {[epTag(episode), shortDur(episode.duration)].filter(Boolean).join(' · ')}
          {episode.published_at && <> · <time dateTime={episode.published_at}>{isoDate(episode.published_at)}</time></>}
          {episode.has_transcript && ' · transcript'}
          {episode.explicit && <> · <Explicit /></>}
        </p>
      </div>
      <EpisodePlayButton episode={episode} className="tk-row__play" />
    </li>
  );
}

/* ---------- Home ---------- */

function SectionHead({ title, n, href, linkLabel = 'view all', id }: { title: string; n: number; href?: string; linkLabel?: string; id: string }) {
  return (
    <div className="tk-sechead">
      <h2 id={id}><span className="tk-sechead__n tk-mono" aria-hidden="true">{pad2(n)}</span>{title}</h2>
      {href && <a href={href} className="tk-mono tk-sechead__link">{linkLabel} <span aria-hidden="true">→</span></a>}
    </div>
  );
}

function PodcastGrid({ podcasts }: { podcasts: Podcast[] }) {
  return <div className="tk-grid">{podcasts.map((p, i) => <PodcastCard key={p.id} podcast={p} index={i} />)}</div>;
}

function Hero({ s, site, home }: { s: HomepageSection } & HomeProps) {
  const latest = home.latest_episodes[0];
  const feat = home.featured[0];
  const name = siteName(site);
  const headline = s.title || site.branding.tagline || name;
  const lead = s.subtitle || site.seo.meta_description || (feat ? feat.short_description : '');
  return (
    <section className="tk-band tk-hero" aria-labelledby="tk-hero-h">
      <div className="tk-band__glow" aria-hidden="true" />
      <div className="tk-wrap tk-hero__grid">
        <div className="tk-hero__copy">
          <p className="tk-mono tk-chip tk-chip--dark"><span className="tk-dot" aria-hidden="true" /> {name} <span className="tk-chip__sep" aria-hidden="true">/</span> podcasts</p>
          <h1 id="tk-hero-h" className="tk-hero__title"><span className="tk-grad">{headline}</span></h1>
          {lead && <p className="tk-hero__lead">{lead}</p>}
          <div className="tk-actions">
            <a className="tk-btn tk-btn--grad" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
            <a className="tk-btn tk-btn--ghost" href="/episodes">Latest episodes <span aria-hidden="true">→</span></a>
          </div>
          <ul className="tk-stats" aria-label="Site statistics">
            <li><span className="tk-stats__k">podcasts</span><span className="tk-stats__v">{home.stats.podcasts.toLocaleString('en')}</span></li>
            <li><span className="tk-stats__k">episodes</span><span className="tk-stats__v">{home.stats.episodes.toLocaleString('en')}</span></li>
            {home.hosts.length > 0 && <li><span className="tk-stats__k">hosts</span><span className="tk-stats__v">{home.hosts.length}</span></li>}
            {home.categories.length > 0 && <li><span className="tk-stats__k">topics</span><span className="tk-stats__v">{home.categories.length}</span></li>}
          </ul>
        </div>
        {(latest || feat) && (
          <div className="tk-term" role="group" aria-label={latest ? 'Latest episode' : 'Featured podcast'}>
            <div className="tk-term__bar" aria-hidden="true">
              <span className="tk-term__dots"><i /><i /><i /></span>
              <span className="tk-term__path">~/{latest ? 'latest' : 'featured'} — zsh</span>
            </div>
            <div className="tk-term__body">
              {latest ? (
                <>
                  <p className="tk-term__cmd"><span className="tk-term__ps" aria-hidden="true">$</span> play{latest.episode_number ? ` --episode ${latest.episode_number}` : ''} <span className="tk-term__str">&quot;{latest.title}&quot;</span></p>
                  <dl className="tk-term__out">
                    <div><dt>podcast</dt><dd><a href={podcastHref(latest.podcast_slug)}>{latest.podcast_title}</a></dd></div>
                    {latest.published_at && <div><dt>published</dt><dd><time dateTime={latest.published_at}>{isoDate(latest.published_at)}</time></dd></div>}
                    {latest.duration > 0 && <div><dt>duration</dt><dd>{shortDur(latest.duration)}</dd></div>}
                    {episodeLabel(latest) && <div><dt>label</dt><dd>{episodeLabel(latest)}</dd></div>}
                    <div><dt>status</dt><dd className="tk-term__ok">ready<span className="tk-caret" aria-hidden="true" /></dd></div>
                  </dl>
                  <div className="tk-term__actions">
                    <EpisodePlayButton episode={latest} variant="pill" label="Run episode" className="tk-term__play" />
                    <a href={episodeHref(latest)} className="tk-term__link">show notes <span aria-hidden="true">→</span></a>
                  </div>
                </>
              ) : feat && (
                <>
                  <p className="tk-term__cmd"><span className="tk-term__ps" aria-hidden="true">$</span> open <span className="tk-term__str">&quot;{feat.title}&quot;</span></p>
                  <dl className="tk-term__out">
                    <div><dt>author</dt><dd>{feat.author || '—'}</dd></div>
                    <div><dt>episodes</dt><dd>{feat.episode_count}</dd></div>
                    {feat.category && <div><dt>category</dt><dd>{feat.category.name}</dd></div>}
                  </dl>
                  <div className="tk-term__actions">
                    <a href={podcastHref(feat)} className="tk-btn tk-btn--grad">Open podcast</a>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HomeSection({ s, site, home, n }: { s: HomepageSection; n: number } & HomeProps) {
  const id = `tk-s-${n}`;
  switch (s.type) {
    case 'hero':
      return <Hero s={s} site={site} home={home} />;
    case 'trending': {
      const list = sectionPodcasts(home, s.type, s.limit);
      if (list.length === 0) return null;
      return (
        <section className="tk-wrap tk-sec" aria-labelledby={id}>
          <SectionHead id={id} n={n} title={sectionTitle(s)} href="/podcasts" />
          <ol className="tk-log">
            {list.map((p, i) => (
              <li key={p.id} className="tk-log__item">
                <span className="tk-log__rank tk-mono" aria-label={`Rank ${i + 1}`}>#{pad2(i + 1)}</span>
                <Artwork src={p.artwork_url} alt="" size={40} className="tk-log__art" />
                <div className="tk-log__body">
                  <a href={podcastHref(p)} className="tk-log__title">{p.title}</a>
                  <span className="tk-log__by">{p.author || p.category?.name}</span>
                </div>
                <span className="tk-mono tk-log__meta">
                  <span className="tk-log__delta">{plural(p.episode_count, 'ep')}</span>
                  {p.latest_episode_at && <time dateTime={p.latest_episode_at}>{isoDate(p.latest_episode_at)}</time>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      );
    }
    case 'featured': case 'popular': case 'editors_picks': case 'new_podcasts': {
      const list = sectionPodcasts(home, s.type, s.limit);
      if (list.length === 0) return null;
      return (
        <section className="tk-wrap tk-sec" aria-labelledby={id}>
          <SectionHead id={id} n={n} title={sectionTitle(s)} href="/podcasts" />
          {s.subtitle && <p className="tk-sec__sub">{s.subtitle}</p>}
          <PodcastGrid podcasts={list} />
        </section>
      );
    }
    case 'latest_episodes': {
      const eps = sectionEpisodes(home, s.limit);
      if (eps.length === 0) return null;
      return (
        <section className="tk-wrap tk-sec" aria-labelledby={id}>
          <SectionHead id={id} n={n} title={sectionTitle(s)} href="/episodes" />
          <div className="tk-eplist tk-eplist--grid">{eps.map((e, i) => <EpisodeCard key={e.id} episode={e} index={i} />)}</div>
        </section>
      );
    }
    case 'categories': {
      if (home.categories.length === 0) return null;
      return (
        <section className="tk-wrap tk-sec" aria-labelledby={id}>
          <SectionHead id={id} n={n} title={sectionTitle(s)} href="/categories" />
          <ul className="tk-stack">
            {home.categories.slice(0, s.limit || 24).map((c) => (
              <li key={c.id}>
                <a href={categoryHref(c.slug)}>
                  <span className="tk-stack__name">{c.name}</span>
                  <span className="tk-stack__n">{c.podcast_count}<span className="pe-sr-only"> {c.podcast_count === 1 ? 'show' : 'shows'}</span></span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    case 'collections': {
      if (home.collections.length === 0) return null;
      return (
        <>
          {home.collections.map((c, i) => c.podcasts.length > 0 && (
            <section key={c.id} className="tk-wrap tk-sec" aria-labelledby={`${id}-${i}`}>
              <SectionHead id={`${id}-${i}`} n={n} title={c.title} href={collectionHref(c.slug)} linkLabel="open collection" />
              {c.description && <p className="tk-sec__sub">{c.description}</p>}
              <PodcastGrid podcasts={s.limit ? c.podcasts.slice(0, s.limit) : c.podcasts} />
            </section>
          ))}
        </>
      );
    }
    case 'newsletter':
      return (
        <section className="tk-wrap tk-sec" aria-labelledby={id}>
          <div className="tk-follow">
            <div>
              <p className="tk-mono tk-follow__cmd">$ follow --all</p>
              <h2 id={id} className="tk-follow__title">{sectionTitle(s)}</h2>
              <p className="tk-follow__sub">{s.subtitle || `Follow ${siteName(site)} for every new release.`}</p>
            </div>
            <SocialLinks links={site.branding.social_links} className="tk-follow__social" />
          </div>
        </section>
      );
    case 'cta':
      return (
        <section className="tk-wrap tk-sec" aria-labelledby={id}>
          <div className="tk-cta">
            <div className="tk-band__glow" aria-hidden="true" />
            <div className="tk-cta__inner">
              <h2 id={id} className="tk-cta__title">{s.title || 'Ship your ears an upgrade'}</h2>
              {s.subtitle && <p className="tk-cta__sub">{s.subtitle}</p>}
            </div>
            <a className="tk-btn tk-btn--light" href={s.button_href || '/podcasts'}>{s.button_label || 'Browse podcasts'}</a>
          </div>
        </section>
      );
    default:
      return null;
  }
}

function Home(props: HomeProps) {
  const sections = enabledSections(props.site);
  const hasHero = sections.some((s) => s.type === 'hero');
  let n = 0;
  return (
    <div className="tk-home">
      {!hasHero && <h1 className="pe-sr-only">{siteName(props.site)}</h1>}
      {sections.map((s, i) => {
        if (s.type !== 'hero') n += 1;
        return <HomeSection key={s.type + i} s={s} n={n} {...props} />;
      })}
    </div>
  );
}

/* ---------- Podcast page ---------- */

function PodcastPage({ page }: PodcastPageProps) {
  const p = page.podcast;
  const cats = p.categories.length ? p.categories : p.category ? [p.category] : [];
  return (
    <article className="tk-podcast">
      <header className="tk-band tk-phead">
        <div className="tk-band__glow" aria-hidden="true" />
        <div className="tk-wrap tk-phead__grid">
          <div className="tk-gborder tk-phead__art">
            <Artwork src={p.artwork_url} alt={`${p.title} artwork`} priority />
          </div>
          <div className="tk-phead__info">
            <p className="tk-mono tk-path"><a href="/podcasts">~/podcasts</a>/{p.slug}</p>
            <h1 className="tk-phead__title">{p.title}</h1>
            <p className="tk-phead__by">
              {p.hosts.length > 0
                ? <>hosted by {p.hosts.map((h, i) => <span key={h.id}>{i > 0 && ', '}<a href={hostHref(h.slug)}>{h.name}</a></span>)}</>
                : p.author && <>by {p.author}</>}
            </p>
            {p.short_description && <p className="tk-phead__desc">{p.short_description}</p>}
            <ul className="tk-kv" aria-label="Podcast details">
              <li><span>episodes</span>{page.episodes_total}</li>
              <li><span>lang</span>{p.language || '—'}</li>
              <li><span>type</span>{p.podcast_type}</li>
              {page.seasons.length > 0 && <li><span>seasons</span>{page.seasons.length}</li>}
              {p.latest_episode_at && <li><span>updated</span><time dateTime={p.latest_episode_at}>{isoDate(p.latest_episode_at)}</time></li>}
              {p.explicit && <li className="tk-kv--warn">explicit</li>}
            </ul>
            <div className="tk-actions">
              {page.latest_episode && <EpisodePlayButton episode={page.latest_episode} variant="pill" label="Play latest" className="tk-bigplay" />}
              <SubscribeButton feedUrl={page.feed_url} className="tk-sub">Subscribe</SubscribeButton>
              <a className="tk-btn tk-btn--ghost" href="#episodes">Episodes <span aria-hidden="true">↓</span></a>
            </div>
          </div>
        </div>
      </header>

      <div className="tk-wrap tk-split">
        <div className="tk-split__main">
          <section className="tk-readme" aria-labelledby="tk-about">
            <div className="tk-readme__bar"><span className="tk-mono" aria-hidden="true">README.md</span></div>
            <div className="tk-readme__body">
              <h2 id="tk-about" className="tk-h2">About {p.title}</h2>
              {p.description ? <Prose html={p.description} /> : <p>{p.short_description}</p>}
              {cats.length > 0 && (
                <div className="tk-readme__row">
                  <h3 className="tk-label">categories</h3>
                  <ul className="tk-stack tk-stack--sm">
                    {cats.map((c) => <li key={c.id}><a href={categoryHref(c.slug)}><span className="tk-stack__name">{c.name}</span></a></li>)}
                  </ul>
                </div>
              )}
              {p.tags.length > 0 && (
                <div className="tk-readme__row">
                  <h3 className="tk-label">tags</h3>
                  <TagList tags={p.tags} className="tk-tags" />
                </div>
              )}
            </div>
          </section>

          <section className="tk-sec tk-sec--flush" aria-labelledby="episodes">
            <div className="tk-sechead">
              <h2 id="episodes">Episodes <span className="tk-mono tk-count">{page.episodes.length}/{page.episodes_total}</span></h2>
              {page.seasons.length > 1 && <p className="tk-mono tk-muted">{page.seasons.map((n) => `s${n}`).join(' · ')}</p>}
            </div>
            {page.episodes.length > 0 ? (
              <ol className="tk-rows">
                {page.episodes.map((e, i) => (
                  <EpisodeRow key={e.id} episode={e} n={page.episodes_total - i} latest={page.latest_episode?.id === e.id} />
                ))}
              </ol>
            ) : <p className="tk-muted">No episodes published yet.</p>}
            {page.episodes_total > page.episodes.length && (
              <a className="tk-btn tk-btn--outline tk-more" href={`/episodes?podcast=${p.slug}`}>See all {page.episodes_total} episodes <span aria-hidden="true">→</span></a>
            )}
          </section>
        </div>

        <aside className="tk-split__aside">
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tk-panel" compact />
          <section className="tk-panel" aria-labelledby="tk-subscribe">
            <h2 id="tk-subscribe" className="tk-label">subscribe</h2>
            <p className="tk-panel__p">Add the RSS feed to any podcast app.</p>
            <SubscribeButton feedUrl={page.feed_url} className="tk-sub">Copy RSS feed</SubscribeButton>
          </section>
          <section className="tk-panel" aria-labelledby="tk-share">
            <h2 id="tk-share" className="tk-label">share</h2>
            <ShareButtons url={page.canonical_url} title={p.title} className="tk-share" />
          </section>
          {p.hosts.length > 0 && (
            <section className="tk-panel" aria-labelledby="tk-hosts">
              <h2 id="tk-hosts" className="tk-label">hosts</h2>
              <ul className="tk-people">
                {p.hosts.map((h) => (
                  <li key={h.id}><a href={hostHref(h.slug)}><Artwork src={h.photo_url} alt="" rounded size={36} /><span>{h.name}{h.role && <small className="tk-mono">{h.role}</small>}</span></a></li>
                ))}
              </ul>
            </section>
          )}
          {page.related.length > 0 && (
            <section className="tk-panel" aria-labelledby="tk-related">
              <h2 id="tk-related" className="tk-label">related</h2>
              <div className="tk-grid tk-grid--one">{page.related.slice(0, 5).map((r) => <PodcastCard key={r.id} podcast={r} />)}</div>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

/* ---------- Episode page ---------- */

function EpisodePage({ site, page }: EpisodePageProps) {
  const e = page.episode;
  const p = page.podcast;
  const people = uniqueHosts(e.hosts, p.hosts);
  const toc: { id: string; label: string }[] = [
    { id: 'about', label: 'About' },
    ...(e.key_topics?.length ? [{ id: 'topics', label: 'Key topics' }] : []),
    ...(people.length ? [{ id: 'people', label: 'Hosts & guests' }] : []),
    ...(e.transcript ? [{ id: 'transcript', label: 'Transcript' }] : []),
    ...(e.faq?.length ? [{ id: 'faq', label: 'FAQ' }] : []),
    ...(e.citations?.length ? [{ id: 'sources', label: 'Sources' }] : []),
    ...(page.more.length ? [{ id: 'more', label: 'More episodes' }] : []),
  ];
  return (
    <article className="tk-episode">
      <header className="tk-band tk-ehead">
        <div className="tk-band__glow" aria-hidden="true" />
        <div className="tk-wrap tk-ehead__grid">
          <div className="tk-gborder tk-ehead__art">
            <Artwork src={e.artwork_url || p.artwork_url} alt={`${e.title} artwork`} priority />
          </div>
          <div className="tk-ehead__info">
            <p className="tk-mono tk-path"><a href={podcastHref(p)}>~/{p.slug}</a>/{e.slug}</p>
            <h1 className="tk-ehead__title">{e.title}</h1>
            <p className="tk-phead__by">from <a href={podcastHref(p)}>{p.title}</a></p>
            <ul className="tk-kv" aria-label="Episode details">
              {episodeLabel(e) && <li><span>label</span>{episodeLabel(e)}</li>}
              {e.published_at && <li><span>published</span><time dateTime={e.published_at}>{formatDate(e.published_at, site.tenant.language)}</time></li>}
              {e.duration > 0 && <li><span>duration</span>{shortDur(e.duration)}</li>}
              {e.has_transcript && <li><span>transcript</span>yes</li>}
              {e.explicit && <li className="tk-kv--warn">explicit</li>}
            </ul>
            <div className="tk-actions">
              <EpisodePlayButton episode={e} variant="pill" className="tk-bigplay" />
              <DownloadLink episode={e} className="tk-btn tk-btn--ghost">Download <span aria-hidden="true">↓</span></DownloadLink>
            </div>
          </div>
        </div>
      </header>

      <div className="tk-wrap tk-doc">
        <nav className="tk-toc" aria-label="On this page">
          <p className="tk-label">On this page</p>
          <ol>
            {toc.map((t, i) => <li key={t.id}><a href={`#${t.id}`}><span className="tk-mono" aria-hidden="true">{pad2(i + 1)}</span>{t.label}</a></li>)}
          </ol>
        </nav>

        <div className="tk-doc__body">
          <section id="about" className="tk-doc__sec" aria-labelledby="tk-about-ep">
            <h2 id="tk-about-ep" className="tk-h2">About this episode</h2>
            {e.description ? <Prose html={e.description} /> : <p>{e.short_description}</p>}
            {e.show_notes && (
              <div className="tk-notes">
                <p className="tk-label">show notes</p>
                <Prose html={e.show_notes} />
              </div>
            )}
            <TagList tags={e.tags} className="tk-tags" />
          </section>
          {e.key_topics?.length ? <div id="topics" className="tk-doc__sec tk-topics"><KeyTopics topics={e.key_topics} /></div> : null}
          {people.length > 0 && (
            <section id="people" className="tk-doc__sec" aria-labelledby="tk-people-h">
              <h2 id="tk-people-h" className="tk-h2">Hosts &amp; guests</h2>
              <ul className="tk-people tk-people--grid">
                {people.map((h) => (
                  <li key={h.id}>
                    <a href={hostHref(h.slug)}>
                      <Artwork src={h.photo_url} alt="" rounded size={40} />
                      <span>{h.name}{h.role && <small className="tk-mono">{h.role}</small>}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {e.transcript && <div id="transcript" className="tk-doc__sec"><Transcript episode={e} className="tk-transcript" /></div>}
          {e.faq?.length ? <div id="faq" className="tk-doc__sec tk-faq"><FAQ items={e.faq} /></div> : null}
          {e.citations?.length ? <div id="sources" className="tk-doc__sec tk-cites"><Citations items={e.citations} /></div> : null}

          {(page.previous || page.next) && (
            <nav className="tk-pn" aria-label="Previous and next episodes">
              {page.previous && (
                <a href={episodeHref(page.previous)} className="tk-pn__item">
                  <span className="tk-mono">← previous</span><strong>{page.previous.title}</strong>
                </a>
              )}
              {page.next && (
                <a href={episodeHref(page.next)} className="tk-pn__item tk-pn__item--next">
                  <span className="tk-mono">next →</span><strong>{page.next.title}</strong>
                </a>
              )}
            </nav>
          )}
        </div>

        <aside className="tk-doc__rail">
          <ListenOnButtons items={page.listen_on} feedUrl={page.feed_url} className="tk-panel" compact />
          <section className="tk-panel" aria-labelledby="tk-share-ep">
            <h2 id="tk-share-ep" className="tk-label">share</h2>
            <ShareButtons url={page.canonical_url} title={`${e.title} – ${p.title}`} className="tk-share" />
          </section>
          <section className="tk-panel" aria-labelledby="tk-show-ep">
            <h2 id="tk-show-ep" className="tk-label">podcast</h2>
            <PodcastCard podcast={p} />
            <SubscribeButton feedUrl={page.feed_url} className="tk-sub">Subscribe</SubscribeButton>
          </section>
        </aside>
      </div>

      {page.more.length > 0 && (
        <section id="more" className="tk-wrap tk-sec tk-doc__sec" aria-labelledby="tk-more-h">
          <div className="tk-sechead">
            <h2 id="tk-more-h">More from {p.title}</h2>
            <a href={podcastHref(p)} className="tk-mono tk-sechead__link">view all <span aria-hidden="true">→</span></a>
          </div>
          <div className="tk-eplist tk-eplist--grid">{page.more.map((m) => <EpisodeCard key={m.id} episode={m} showPodcast={false} />)}</div>
        </section>
      )}
    </article>
  );
}

export const techTheme: Theme = {
  key: 'tech',
  name: 'Tech',
  Layout,
  Player: TechPlayer,
  Home,
  PodcastCard,
  EpisodeCard,
  PodcastPage,
  EpisodePage,
  podcastGridClass: 'tk-grid',
  episodeListClass: 'tk-eplist',
};
