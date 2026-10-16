// Server-side data access for the public site. Every call carries the resolved tenant host,
// so the API scopes all data to the tenant (PRD §7, §113).
import { cache } from 'react';
import { headers } from 'next/headers';
import { registerImageVariants, type ImageVariants } from '@podcast/ui';
import type {
  CategoryPageData, CategorySummary, Collection, Episode, EpisodePageData, HomeData, HostPageData, HostRef, ListMeta, Podcast,
  PodcastPageData, SearchResults, Site,
} from '@podcast/types';

export const API = process.env.API_INTERNAL_URL || 'http://localhost:8080';

export class NotFoundError extends Error {}

export async function tenantHost(): Promise<{ host: string; tenantId: string }> {
  const h = await headers();
  return { host: h.get('x-tenant-host') || (h.get('host') ?? '').replace(/:\d+$/, ''), tenantId: h.get('x-tenant-id') || '0' };
}

async function request<T>(path: string, init?: { revalidate?: number; raw?: boolean }): Promise<{ data: T; meta?: ListMeta }> {
  const body = await fetchJSON<T>(path, init);
  registerImageVariants(body.image_variants);
  return body;
}

async function fetchJSON<T>(path: string, init?: { revalidate?: number }): Promise<{ data: T; meta?: ListMeta; image_variants?: Record<string, ImageVariants> }> {
  const { host, tenantId } = await tenantHost();
  const res = await fetch(`${API}/api/public${path}`, {
    headers: { 'x-tenant-host': host, accept: 'application/json' },
    next: { revalidate: init?.revalidate ?? 30, tags: [`tenant-${tenantId}`] },
  });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return res.json();
}

/** Site config is requested by layout, metadata and pages — dedupe per request. */
export const getSite = cache(async (): Promise<Site> => (await request<Site>('/site')).data);
export const getHome = cache(async (): Promise<HomeData> => (await request<HomeData>('/home')).data);
export const getPodcastPage = cache(async (slug: string) => (await request<PodcastPageData>(`/podcasts/${encodeURIComponent(slug)}`)).data);
export const getEpisodePage = cache(
  async (slug: string, ep: string) => (await request<EpisodePageData>(`/podcasts/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(ep)}`)).data,
);
export const getCategoryPage = cache(async (slug: string, page = 1) => request<CategoryPageData>(`/categories/${encodeURIComponent(slug)}?page=${page}`));
export const getHostPage = cache(async (slug: string) => (await request<HostPageData>(`/hosts/${encodeURIComponent(slug)}`)).data);
export const getCollection = cache(async (slug: string) => (await request<Collection>(`/collections/${encodeURIComponent(slug)}`)).data);

export async function listPodcasts(page = 1, sort = '') {
  return request<Podcast[]>(`/podcasts?page=${page}&per_page=24${sort ? `&sort=${sort}` : ''}`);
}
export async function listEpisodes(page = 1) {
  return request<Episode[]>(`/episodes?page=${page}&per_page=24`);
}
export async function listPodcastEpisodes(slug: string, page = 1, season?: number) {
  return request<Episode[]>(`/podcasts/${encodeURIComponent(slug)}/episodes?page=${page}&per_page=30${season ? `&season=${season}` : ''}`);
}
export async function listCategories() {
  return (await request<CategorySummary[]>('/categories')).data;
}
export async function listHosts() {
  return (await request<HostRef[]>('/hosts')).data;
}
export async function listCollections() {
  return (await request<Collection[]>('/collections')).data;
}
export async function getTag(slug: string) {
  return (await request<{ tag: { name: string; slug: string }; podcasts: Podcast[]; episodes: Episode[] }>(`/tags/${encodeURIComponent(slug)}`)).data;
}
export async function search(q: string, type?: string) {
  return (await request<SearchResults>(`/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`, { revalidate: 0 })).data;
}

export async function getPreview(id: string, token: string) {
  const { host } = await tenantHost();
  const res = await fetch(`${API}/api/public/preview/episodes/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, {
    headers: { 'x-tenant-host': host }, cache: 'no-store',
  });
  if (!res.ok) throw new NotFoundError('preview');
  const body = (await res.json()) as { data: { page: EpisodePageData; status: string }; image_variants?: Record<string, ImageVariants> };
  registerImageVariants(body.image_variants);
  return body.data;
}

/** Raw passthrough for XML/text endpoints (feeds, sitemaps, robots, transcripts). */
export async function passthrough(path: string, reqHeaders?: Headers): Promise<Response> {
  const { host } = await tenantHost();
  const h: Record<string, string> = { 'x-tenant-host': host };
  const inm = reqHeaders?.get('if-none-match');
  if (inm) h['if-none-match'] = inm;
  const res = await fetch(`${API}/api/public${path}`, { headers: h, cache: 'no-store' });
  const out = new Headers();
  for (const k of ['content-type', 'cache-control', 'etag']) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }
  return new Response(res.status === 304 ? null : await res.arrayBuffer(), { status: res.status, headers: out });
}
