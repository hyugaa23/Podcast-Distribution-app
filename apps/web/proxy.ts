// Tenant resolver (PRD §7): every request hostname is resolved to a tenant before rendering.
// Handles www → primary domain redirects, 301 redirects from the Redirect Manager (PRD §89),
// unknown domains, and sitemap/verification rewrites.
import { NextResponse, type NextRequest } from 'next/server';

const API = process.env.API_INTERNAL_URL || 'http://localhost:8080';

interface Resolved {
  tenant_id: number;
  theme: string;
  domain: string;
  primary_domain: string;
  redirect_host?: string;
  redirect?: { to: string; status: number };
}

type CacheEntry = { at: number; value: Resolved | null };
const cache = new Map<string, CacheEntry>();
const TTL = 30_000;

async function resolve(host: string, path: string): Promise<Resolved | null> {
  const key = `${host}|${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const res = await fetch(`${API}/api/public/resolve?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`, {
    headers: { accept: 'application/json' },
  });
  let value: Resolved | null = null;
  if (res.ok) value = ((await res.json()) as { data: Resolved }).data;
  else if (res.status !== 404) throw new Error(`resolve failed: ${res.status}`);
  if (cache.size > 5000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function hostOf(req: NextRequest): string {
  const raw = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** The URL as the visitor sees it: behind a reverse proxy the internal port/scheme must not leak into redirects. */
function publicUrl(req: NextRequest): URL {
  const url = new URL(req.nextUrl);
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]!.trim();
  if (proto === 'http' || proto === 'https') url.protocol = proto + ':';
  const raw = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0]!.trim();
  const port = /:(d+)$/.exec(raw)?.[1] ?? '';
  url.port = port;
  return url;
}

const esc = (s: string) => s.replace(/[<>&"]/g, "");

/** Branded status page used when a host is unknown or the API is unreachable. */
function statusPage(status: number, title: string, message: string, retry: boolean) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eaf2;background:#0b0d14;overflow:hidden}
.bg{position:fixed;inset:-20%;background:radial-gradient(40% 40% at 25% 30%,#3b5bff55,transparent 70%),radial-gradient(35% 35% at 75% 70%,#a855f755,transparent 70%);filter:blur(30px);animation:drift 14s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate3d(4%,-3%,0) scale(1.08)}}
main{position:relative;max-width:520px;padding:40px 28px;text-align:center;animation:rise .8s cubic-bezier(.2,.7,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(18px)}}
.eq{display:flex;gap:6px;justify-content:center;align-items:flex-end;height:56px;margin:0 auto 28px}
.eq i{width:8px;border-radius:4px;background:linear-gradient(#7c9bff,#a855f7);animation:eq 1.1s ease-in-out infinite}
.eq i:nth-child(1){height:40%;animation-delay:-.2s}.eq i:nth-child(2){height:80%;animation-delay:-.5s}.eq i:nth-child(3){height:100%;animation-delay:-.1s}
.eq i:nth-child(4){height:65%;animation-delay:-.7s}.eq i:nth-child(5){height:45%;animation-delay:-.35s}
@keyframes eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
.code{font:600 12px/1 ui-monospace,monospace;letter-spacing:.2em;color:#8b93ad;text-transform:uppercase}
h1{font-size:clamp(26px,5vw,36px);line-height:1.15;margin:12px 0 12px;letter-spacing:-.02em}
p{color:#a7aec4;line-height:1.6;margin:0 0 26px}
a,button{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 22px;font:600 15px/1 inherit;color:#0b0d14;background:#fff;cursor:pointer;text-decoration:none;transition:transform .2s}
a:hover,button:hover{transform:translateY(-2px)}
@media (prefers-reduced-motion:reduce){.bg,.eq i,main{animation:none}}
</style></head><body><div class="bg" aria-hidden="true"></div><main>
<div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
<div class="code">Error ${status}</div><h1>${title}</h1><p>${message}</p>
${retry ? '<button onclick="location.reload()">Try again</button>' : ''}
</main></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...(status === 503 ? { "retry-after": "15" } : {}) } });
}

const notConfigured = (host: string) =>
  statusPage(404, "This podcast site isn't live yet", `No site is connected to <strong>${esc(host)}</strong> yet. If you own this domain, add it to a website in the admin panel.`, false);

const unavailable = () =>
  statusPage(503, "We'll be right back", "The podcast service is temporarily unavailable. Please try again in a moment.", true);

export async function proxy(req: NextRequest) {
  const host = hostOf(req);
  const { pathname, search } = req.nextUrl;
  let r: Resolved | null;
  try {
    r = await resolve(host, pathname);
  } catch {
    return unavailable();
  }
  if (!r) return notConfigured(host);

  // Domain-level redirect (e.g. www.example.com → example.com) — permanent.
  if (r.redirect_host && r.redirect_host !== host) {
    const url = publicUrl(req);
    url.hostname = r.redirect_host;
    return NextResponse.redirect(url, 301);
  }
  // Path redirects (slug changes, manual redirects).
  if (r.redirect) {
    const to = r.redirect.to.startsWith('http') ? new URL(r.redirect.to) : new URL(r.redirect.to + search, publicUrl(req));
    return NextResponse.redirect(to, r.redirect.status || 301);
  }

  const headers = new Headers(req.headers);
  headers.set('x-tenant-host', host);
  headers.set('x-tenant-id', String(r.tenant_id));
  headers.set('x-pathname', pathname);

  // Segmented sitemaps (/sitemap.xml, /sitemap-podcasts.xml …) and domain verification.
  const sm = pathname.match(/^\/sitemap(?:-([a-z]+))?\.xml$/);
  if (sm) {
    return NextResponse.rewrite(new URL(`/api/sitemap/${sm[1] ?? 'index'}`, req.url), { request: { headers } });
  }
  if (pathname === '/.well-known/podcast-verify.txt') {
    return NextResponse.rewrite(new URL('/api/verify', req.url), { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/revalidate|api/track).*)'],
};
