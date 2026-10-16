// Cache purge hook called by the API worker after publishing (PRD §85: Cache Purged).
import { revalidateTag } from 'next/cache';

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get('x-revalidate-secret') !== secret) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { tags } = (await req.json().catch(() => ({ tags: [] }))) as { tags?: string[] };
  // expire: 0 → the next request refetches; editors expect publishes to be visible immediately.
  for (const t of (tags ?? []).slice(0, 50)) revalidateTag(t, { expire: 0 });
  return Response.json({ revalidated: tags ?? [] });
}
