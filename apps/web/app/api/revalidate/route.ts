// Cache purge hook called by the API worker after publishing (PRD §85: Cache Purged).
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  const provided = req.headers.get('x-revalidate-secret') || '';
  if (!secret || !safeCompare(provided, secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { tags } = (await req.json().catch(() => ({ tags: [] }))) as { tags?: string[] };
  // expire: 0 → the next request refetches; editors expect publishes to be visible immediately.
  for (const t of (tags ?? []).slice(0, 50)) revalidateTag(t, { expire: 0 });
  return Response.json({ revalidated: tags ?? [] });
}
