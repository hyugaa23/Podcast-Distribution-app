// Theme contract (PRD §40, §68, §112): themes only control presentation. All data
// fetching, SEO, analytics, player state and business rules live in apps/web,
// @podcast/ui and @podcast/player and are shared by every theme.
import type { ComponentType, ReactNode } from 'react';
import type { Episode, EpisodePageData, HomeData, Podcast, PodcastPageData, Site, ThemeKey } from '@podcast/types';

export interface LayoutProps {
  site: Site;
  children: ReactNode;
}

export interface HomeProps {
  site: Site;
  home: HomeData;
}

export interface PodcastCardProps {
  podcast: Podcast;
  index?: number;
}

export interface EpisodeCardProps {
  episode: Episode;
  /** Show the parent podcast name/artwork (lists that mix podcasts). */
  showPodcast?: boolean;
  index?: number;
}

export interface PodcastPageProps {
  site: Site;
  page: PodcastPageData;
}

export interface EpisodePageProps {
  site: Site;
  page: EpisodePageData;
}

export interface Theme {
  key: ThemeKey;
  name: string;
  /** Header, navigation, footer and the global player (must render <Player/>). */
  Layout: ComponentType<LayoutProps>;
  /** Global persistent player presentation (client component). */
  Player: ComponentType<{ site: Site }>;
  Home: ComponentType<HomeProps>;
  PodcastCard: ComponentType<PodcastCardProps>;
  EpisodeCard: ComponentType<EpisodeCardProps>;
  PodcastPage: ComponentType<PodcastPageProps>;
  EpisodePage: ComponentType<EpisodePageProps>;
  /** Class applied to grids of PodcastCard on shared listing pages. */
  podcastGridClass: string;
  /** Class applied to lists of EpisodeCard on shared listing pages. */
  episodeListClass: string;
}
