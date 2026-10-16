// Domain ownership verification token served at /.well-known/podcast-verify.txt (rewritten by proxy.ts).
import { API, tenantHost } from '@/lib/api';

export async function GET() {
  const { host } = await tenantHost();
  const res = await fetch(`${API}/api/public/domain-verification?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
  return new Response(res.ok ? await res.text() : 'not found', { status: res.status, headers: { 'content-type': 'text/plain' } });
}
