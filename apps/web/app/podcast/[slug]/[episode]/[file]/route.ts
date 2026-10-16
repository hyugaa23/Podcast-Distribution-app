// Transcript files referenced from <podcast:transcript> in the feed: /podcast/{slug}/{episode}/transcript.{txt|srt|vtt}
import { passthrough } from '@/lib/api';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; episode: string; file: string }> }) {
  const { slug, episode, file } = await ctx.params;
  if (!/^transcript\.(txt|srt|vtt)$/.test(file)) return new Response('Not found', { status: 404 });
  return passthrough(`/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(episode)}/transcript`);
}
