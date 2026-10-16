# Theme authoring guide (for implementers of themes 02–10)

Read this fully before writing code. The reference implementation is **Theme 01 — Stream Dark** in
`packages/themes/src/theme-stream/` (index.tsx, Player.tsx, styles.css). Study it first.

## Rules (from the PRD)
- ONE application + theme engine + tenant configuration. Themes are **presentation only**. Never fetch data,
  never add business logic, never add npm dependencies. All data comes in via props.
- The 10 themes must be **visually AND structurally different**: homepage composition, card design,
  typography, navigation, spacing, hero, podcast page, episode presentation, player presentation.
  "Theme A = blue, Theme B = red" is NOT acceptable. Do not copy Stream's structure; design your own.
- Shared functionality must come from the shared packages (do not re-implement): `@podcast/ui`,
  `@podcast/player`, `../shared`, `../contract`.

## Files you own (only touch these 3 files)
`packages/themes/src/theme-<key>/index.tsx`  — server components (NO 'use client'), exports `<key>Theme: Theme`
`packages/themes/src/theme-<key>/Player.tsx` — `'use client'` global player presentation
`packages/themes/src/theme-<key>/styles.css` — ALL selectors scoped under `.t-<key>` (e.g. `.t-news .tn-card {}`)
Use a unique 2-letter class prefix for your theme (given in your assignment) for every class name.

## Contract (`packages/themes/src/contract.ts`)
```ts
interface Theme {
  key; name;
  Layout: ({ site, children }) => header + navigation + <main id="main">{children}</main> + footer + <YourPlayer site={site}/>
  Player: ({ site }) => client player presentation
  Home: ({ site, home: HomeData }) => homepage
  PodcastCard: ({ podcast, index? })
  EpisodeCard: ({ episode, showPodcast?, index? })
  PodcastPage: ({ site, page: PodcastPageData })
  EpisodePage: ({ site, page: EpisodePageData })
  podcastGridClass: string   // CSS class used by shared listing pages around many <PodcastCard/>
  episodeListClass: string   // CSS class used by shared listing pages around many <EpisodeCard/>
}
```
Types are in `packages/types/src/index.ts` (Site, HomeData, Podcast, Episode, PodcastPageData, EpisodePageData...).
Note `site.theme_config` / CSS variables are already applied on the root: use `var(--c-primary)`, `--c-secondary`,
`--c-accent`, `--c-bg`, `--c-surface`, `--c-text`, `--c-muted`, `--c-on-primary`, `--radius`, `--font-heading`,
`--font-body`, `--font-mono`. Tenants can change colours/fonts, so ALWAYS use these variables for brand colours
and fonts (you may use additional neutral colours). Base styles live in `packages/ui/src/base.css` (`pe-*` classes).

## Homepage (PRD §29, §53)
Render `enabledSections(site)` IN ORDER (admins enable/disable/reorder sections). Handle every section type:
`hero, featured, trending, latest_episodes, popular, categories, editors_picks, new_podcasts, collections, newsletter, cta`.
Use `sectionPodcasts(home, s.type, s.limit)`, `sectionEpisodes(home, s.limit)`, `sectionTitle(s)`, `home.categories`,
`home.collections`, `home.hosts`, `home.stats`. Return null for empty sections. The `hero` section is your theme's
signature. `newsletter` = a follow CTA using `<SocialLinks>` (there is no email backend — do NOT render an email form).
`cta` uses `s.title / s.subtitle / s.button_label / s.button_href`.

## Podcast page (PRD §12) must show
artwork, title, description (`<Prose html>`), host(s) (link to `/host/{slug}`), categories (link `/category/{slug}`),
total episodes, latest episode, episode list, external platform buttons (`<ListenOnButtons items={page.listen_on} feedUrl={page.feed_url}/>`),
follow/subscribe CTA (`<SubscribeButton feedUrl={page.feed_url}/>`), share (`<ShareButtons url={page.canonical_url} title/>`),
related podcasts (`page.related`). Link to the full list with `/episodes?podcast={slug}` when `episodes_total > episodes.length`.

## Episode page (PRD §39 AEO) must show
semantic headings (one h1 = episode title), "About this episode" section with description + show notes, play button
(`<EpisodePlayButton episode variant="pill"/>`), podcast link, publication date in `<time dateTime>`, duration,
`<KeyTopics topics={e.key_topics}/>`, host/guest info (`e.hosts` + `page.podcast.hosts`), `<Transcript episode={e}/>`,
`<FAQ items={e.faq}/>`, `<Citations items={e.citations}/>`, `<ShareButtons/>`, `<ListenOnButtons/>`, `<DownloadLink/>`,
previous/next (`page.previous`, `page.next`) and more episodes (`page.more`).

## Player (PRD §16) — must be usable on mobile
Client component built from `@podcast/player` primitives: `PlayButton, SkipBackButton, SkipForwardButton, SeekBar,
CurrentTime, Duration, VolumeControl, SpeedControl, CloseButton, PlayerError, usePlayer, formatTime` and from
`@podcast/ui`: `NowPlaying, WhenPlaying`. Must expose: play, pause, seek, current time, duration, volume, playback speed,
skip back, skip forward, episode information, artwork. Wrap in `<WhenPlaying>` and render a spacer element so fixed
players never cover page content. It is persistent (rendered once in Layout). Give it your theme's own presentation.

## Shared components (import from '@podcast/ui')
Server-safe: `Artwork({src, alt, size?, className?, priority?, rounded?})`, `Prose({html})`, `ListenOnButtons`, `Breadcrumbs`,
`Pagination`, `KeyTopics`, `FAQ`, `Citations`, `TagList({tags})`, `SocialLinks({links})`, `EmptyState`, `JsonLd`.
Client: `EpisodePlayButton({episode, variant?: 'icon'|'pill'|'text', label?, className?})`, `ShareButtons`, `SubscribeButton({feedUrl, children?})`,
`Transcript({episode})`, `SearchBox({className?, placeholder?})`, `NavToggle()` (put `data-nav` on the header element; CSS should
show the mobile menu when `[data-nav-open='true']`), `DownloadLink({episode})`, `NowPlaying`, `WhenPlaying`.
Helpers: `episodeHref, podcastHref, hostHref, categoryHref, collectionHref, formatDate(iso, lang, 'long'|'short'|'numeric'),
formatDuration(sec), episodeLabel(ep), plural(n, word), initials(name)`. From '../shared': `enabledSections, sectionPodcasts,
sectionEpisodes, sectionTitle, siteName, navItems, footerText, gradientFor`.

## Navigation
Render `navItems(site)` (admin-managed: Home, Podcasts, Episodes, Categories, Hosts, About, custom links; `n.external`
→ target=_blank rel=noopener). Include `<SearchBox/>` somewhere sensible. Logo: `site.branding.logo_url` else text mark
from `siteName(site)`. Footer: `footerText(site)`, `site.branding.tagline`, `<SocialLinks links={site.branding.social_links}/>`.

## Accessibility & responsive (PRD §82, §83)
Semantic HTML, alt text, visible focus (base CSS handles :focus-visible), sufficient contrast, keyboard friendly, no
information conveyed by colour only. Mobile, tablet, desktop, large desktop. No horizontal page scroll at 360px width.
Use `a { text-decoration }` sensibly, use `<time>`. Images: use `<Artwork>`. Plain `<a href>` links (not next/link).

## Verify
Run `npx tsc -p packages/themes` from the repo root — must report zero errors. Do not edit any file outside your 3 files.
