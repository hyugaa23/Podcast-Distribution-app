// Shared listing scaffolding: generic pages reuse the active theme's cards and grid classes,
// so every theme styles them without duplicating page logic.
import type { ReactNode } from 'react';
import type { Episode, Podcast, Site } from '@podcast/types';
import { getTheme } from '@podcast/themes';
import { EmptyState } from '@podcast/ui';

export function PageShell({ title, lead, children, eyebrow }: { title: ReactNode; lead?: ReactNode; eyebrow?: ReactNode; children: ReactNode }) {
  return (
    <div className="pe-wrap pe-page">
      {eyebrow && <p className="pe-page__eyebrow">{eyebrow}</p>}
      <h1 className="pe-page__title">{title}</h1>
      {lead && <p className="pe-page__lead">{lead}</p>}
      {children}
    </div>
  );
}

export function PodcastGrid({ site, podcasts, empty = 'No podcasts yet.' }: { site: Site; podcasts: Podcast[]; empty?: string }) {
  const theme = getTheme(site.theme.key);
  if (podcasts.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className={theme.podcastGridClass}>
      {podcasts.map((p, i) => <theme.PodcastCard key={p.id} podcast={p} index={i} />)}
    </div>
  );
}

export function EpisodeList({ site, episodes, showPodcast = true, empty = 'No episodes yet.' }: { site: Site; episodes: Episode[]; showPodcast?: boolean; empty?: string }) {
  const theme = getTheme(site.theme.key);
  if (episodes.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className={theme.episodeListClass}>
      {episodes.map((e, i) => <theme.EpisodeCard key={e.id} episode={e} showPodcast={showPodcast} index={i} />)}
    </div>
  );
}
