// Public RSS feed: /feed/{podcast-slug}.xml (PRD §17). Stable, cacheable, ETag-aware.
import { passthrough } from '@/lib/api';

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!file.endsWith('.xml')) return new Response('Not found', { status: 404 });
  return passthrough(`/feeds/${encodeURIComponent(file.slice(0, -4))}`, req.headers);
}
