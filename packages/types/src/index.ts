// Shared types for the public site API (Go `internal/api/public.go`) and theme contract.

export type ThemeKey =
  | 'stream'
  | 'editorial'
  | 'news'
  | 'minimal'
  | 'creator'
  | 'radio'
  | 'tech'
  | 'business'
  | 'entertainment'
  | 'magazine';

export interface ThemeConfig {
  theme: ThemeKey;
  mode?: 'light' | 'dark' | 'hybrid';
  primary: string;
  secondary: string;
  accent?: string;
  background: string;
  surface?: string;
  text?: string;
  muted?: string;
  fontHeading: string;
  fontBody: string;
  fontMono?: string;
  radius: string;
  playerStyle: string;
  [key: string]: unknown;
}

export interface Branding {
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  heading_font: string;
  body_font: string;
  default_cover_url: string;
  footer_text: string;
  tagline: string;
  social_links: Record<string, string> | null;
}

export interface SEOSettings {
  site_title: string;
  title_template: string;
  meta_description: string;
  default_og_image: string;
  twitter_card: string;
  twitter_handle: string;
  organization_name: string;
  organization_logo: string;
  canonical_domain: string;
  index_policy: 'index' | 'noindex';
}

export interface NavItem {
  label: string;
  type: string;
  href: string;
  enabled: boolean;
  external?: boolean;
}

export type HomepageSectionType =
  | 'hero'
  | 'featured'
  | 'trending'
  | 'latest_episodes'
  | 'popular'
  | 'categories'
  | 'editors_picks'
  | 'new_podcasts'
  | 'collections'
  | 'newsletter'
  | 'cta';

export interface HomepageSection {
  type: HomepageSectionType;
  enabled: boolean;
  title: string;
  subtitle?: string;
  limit?: number;
  collection_id?: number;
  button_label?: string;
  button_href?: string;
}

export interface Site {
  tenant: { id: number; name: string; slug: string; language: string; timezone: string; content_mode: string };
  theme: { key: ThemeKey; number: number; name: string };
  theme_config: ThemeConfig;
  branding: Branding;
  seo: SEOSettings;
  navigation: NavItem[];
  homepage_sections: HomepageSection[];
  about_content: string;
  primary_domain: string;
  base_url: string;
}

export interface CategoryRef {
  id: number;
  name: string;
  slug: string;
}

export interface HostRef {
  id: number;
  name: string;
  slug: string;
  photo_url: string;
  role: string;
}

export interface Podcast {
  id: number;
  title: string;
  slug: string;
  description?: string;
  short_description: string;
  artwork_url: string;
  banner_url?: string;
  author: string;
  language: string;
  explicit: boolean;
  copyright?: string;
  website_url?: string;
  podcast_type: 'episodic' | 'serial';
  category: CategoryRef | null;
  subcategory?: CategoryRef | null;
  categories: CategoryRef[];
  tags: string[];
  hosts: HostRef[];
  episode_count: number;
  latest_episode_at: string | null;
  published_at: string | null;
  updated_at: string;
  seo_title?: string;
  meta_description?: string;
  is_featured: boolean;
  is_editors_pick: boolean;
  plays?: number;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface Citation {
  title: string;
  url: string;
}

export interface Episode {
  id: number;
  podcast_id: number;
  podcast_title: string;
  podcast_slug: string;
  podcast_artwork_url: string;
  title: string;
  slug: string;
  description?: string;
  short_description: string;
  show_notes?: string;
  episode_number: number | null;
  season_number: number | null;
  episode_type: 'full' | 'trailer' | 'bonus';
  audio_url: string;
  audio_size: number;
  audio_mime: string;
  duration: number;
  artwork_url: string;
  explicit: boolean;
  published_at: string | null;
  updated_at: string;
  tags: string[];
  hosts: HostRef[];
  transcript?: string;
  transcript_format?: 'txt' | 'srt' | 'vtt' | '';
  has_transcript: boolean;
  seo_title?: string;
  meta_description?: string;
  key_topics?: string[] | null;
  faq?: FAQItem[] | null;
  citations?: Citation[] | null;
}

export interface CategorySummary {
  id: number;
  name: string;
  slug: string;
  podcast_count: number;
}

export interface Collection {
  id: number;
  title: string;
  slug: string;
  description: string;
  cover_url: string;
  podcasts: Podcast[];
}

export interface HomeData {
  featured: Podcast[];
  trending: Podcast[];
  latest_episodes: Episode[];
  popular: Podcast[];
  editors_picks: Podcast[];
  categories: CategorySummary[];
  new_podcasts: Podcast[];
  collections: Collection[];
  hosts: HostRef[];
  stats: { podcasts: number; episodes: number };
}

export interface ListenOn {
  platform_key: string;
  name: string;
  url: string;
  color: string;
}

export interface PodcastPageData {
  podcast: Podcast;
  episodes: Episode[];
  episodes_total: number;
  latest_episode: Episode | null;
  seasons: number[];
  listen_on: ListenOn[];
  related: Podcast[];
  canonical_url: string;
  feed_url: string;
}

export interface EpisodePageData {
  episode: Episode;
  podcast: Podcast;
  previous: Episode | null;
  next: Episode | null;
  more: Episode[];
  listen_on: ListenOn[];
  canonical_url: string;
  feed_url: string;
}

export interface HostDetail {
  id: number;
  name: string;
  slug: string;
  photo_url: string;
  bio: string;
  website_url: string;
  social_links: Record<string, string>;
}

export interface HostPageData {
  host: HostDetail;
  podcasts: Podcast[];
  episodes: Episode[];
}

export interface CategoryPageData {
  category: { id: number; name: string; slug: string; description: string; parent_id: number | null };
  parent: CategoryRef | null;
  subcategories: CategorySummary[];
  podcasts: Podcast[];
  latest_episodes: Episode[];
}

export interface SearchResults {
  query: string;
  podcasts?: Podcast[];
  episodes?: Episode[];
  hosts?: HostRef[];
  categories?: CategorySummary[];
  tags?: { name: string; slug: string }[];
}

export interface ListMeta {
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

/** Player track shape used by the global audio player. */
export interface PlayerTrack {
  episodeId: number;
  podcastId: number;
  title: string;
  podcastTitle: string;
  podcastSlug: string;
  episodeSlug: string;
  audioUrl: string;
  artworkUrl: string;
  duration: number;
}

export type AnalyticsEventType =
  | 'PAGE_VIEW'
  | 'PLAY'
  | '25_PERCENT'
  | '50_PERCENT'
  | '75_PERCENT'
  | 'COMPLETE'
  | 'PAUSE'
  | 'SEEK'
  | 'DOWNLOAD';
