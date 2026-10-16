import type { Episode, PlayerTrack } from '@podcast/types';

/** Builds a player track from a public episode. */
export function toTrack(e: Episode): PlayerTrack {
  return {
    episodeId: e.id,
    podcastId: e.podcast_id,
    title: e.title,
    podcastTitle: e.podcast_title,
    podcastSlug: e.podcast_slug,
    episodeSlug: e.slug,
    audioUrl: e.audio_url,
    artworkUrl: e.artwork_url || e.podcast_artwork_url,
    duration: e.duration,
  };
}
