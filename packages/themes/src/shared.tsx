// Presentation helpers shared by all themes (no business logic).
import type { HomeData, HomepageSection, HomepageSectionType, NavItem, Podcast, Site, Episode } from '@podcast/types';

/** Enabled homepage sections in admin-configured order (PRD §53: enable / disable / reorder). */
export function enabledSections(site: Site): HomepageSection[] {
  return (site.homepage_sections ?? []).filter((s) => s.enabled);
}

export function sectionPodcasts(home: HomeData, type: HomepageSectionType, limit?: number): Podcast[] {
  const map: Partial<Record<HomepageSectionType, Podcast[]>> = {
    featured: home.featured, trending: home.trending, popular: home.popular, editors_picks: home.editors_picks, new_podcasts: home.new_podcasts,
  };
  const list = map[type] ?? [];
  return limit ? list.slice(0, limit) : list;
}

export function sectionEpisodes(home: HomeData, limit?: number): Episode[] {
  return limit ? home.latest_episodes.slice(0, limit) : home.latest_episodes;
}

export function siteName(site: Site): string {
  return site.seo.site_title || site.tenant.name;
}

export function navItems(site: Site): NavItem[] {
  return site.navigation?.length ? site.navigation : [{ label: 'Home', href: '/', type: 'home', enabled: true }];
}

export function footerText(site: Site): string {
  return site.branding.footer_text || `© ${new Date().getFullYear()} ${site.tenant.name}`;
}

/** Simple deterministic gradient for a podcast without banner art. */
export function gradientFor(seed: number, a: string, b: string): string {
  const angle = (seed * 47) % 360;
  return `linear-gradient(${angle}deg, ${a}, ${b})`;
}

export const SECTION_DEFAULT_TITLES: Record<HomepageSectionType, string> = {
  hero: '',
  featured: 'Featured Podcasts',
  trending: 'Trending',
  latest_episodes: 'Latest Episodes',
  popular: 'Popular Shows',
  categories: 'Categories',
  editors_picks: "Editor's Picks",
  new_podcasts: 'New Podcasts',
  collections: 'Collections',
  newsletter: 'Newsletter',
  cta: '',
};

export function sectionTitle(s: HomepageSection): string {
  return s.title || SECTION_DEFAULT_TITLES[s.type];
}
