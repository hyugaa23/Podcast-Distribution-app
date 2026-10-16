/** Hidden marker read by the page-view tracker to attribute views to a podcast/episode. */
export function TrackMarker({ podcastId, episodeId }: { podcastId?: number; episodeId?: number }) {
  return <span hidden data-pv="" data-podcast={podcastId ?? ''} data-episode={episodeId ?? ''} />;
}
