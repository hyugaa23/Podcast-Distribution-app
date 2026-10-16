// Analytics relay: browser → web → API with tenant host, client IP, user agent and country (PRD §57, §58).
import { API } from '@/lib/api';

export async function POST(req: Request) {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0]!.replace(/:\d+$/, '');
  const body = await req.text();
  if (body.length > 16_000) return new Response(null, { status: 413 });
  const res = await fetch(`${API}/api/public/events`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-tenant-host': host,
      'user-agent': req.headers.get('user-agent') || '',
    },
    cache: 'no-store',
  }).catch(() => null);
  return new Response(null, { status: res?.status === 202 ? 204 : res?.status ?? 502 });
}
