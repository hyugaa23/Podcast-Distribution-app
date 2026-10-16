// /sitemap.xml and segmented sitemaps (rewritten here by proxy.ts) (PRD §36).
import { passthrough } from '@/lib/api';

export async function GET(_req: Request, ctx: { params: Promise<{ segment: string }> }) {
  const { segment } = await ctx.params;
  return passthrough(`/sitemap/${encodeURIComponent(segment)}`);
}
