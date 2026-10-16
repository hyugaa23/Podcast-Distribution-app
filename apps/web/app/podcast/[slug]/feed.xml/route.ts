// Alternate feed URL: /podcast/{slug}/feed.xml (PRD §17).
import { passthrough } from '@/lib/api';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return passthrough(`/feeds/${encodeURIComponent(slug)}`, req.headers);
}
