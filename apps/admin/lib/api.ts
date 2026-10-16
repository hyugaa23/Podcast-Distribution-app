'use client';

// Admin API client: short-lived JWT access token kept in memory, refreshed with the httpOnly
// refresh cookie (PRD §70). Every request is authorised again by the backend (PRD §71).

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown);
  constructor(status: number, body: ApiErrorBody);
  constructor(status: number, bodyOrCode: ApiErrorBody | string, message?: string, details?: unknown) {
    if (typeof bodyOrCode === 'string') {
      super(message!);
      this.status = status;
      this.code = bodyOrCode;
      this.details = details;
    } else {
      super(bodyOrCode.message);
      this.status = status;
      this.code = bodyOrCode.code;
      this.details = bodyOrCode.details;
    }
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function onSessionExpired(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let inflight: Promise<SessionData | null> | null = null;

/** Refreshes the session with the httpOnly cookie. Concurrent callers share one request (token rotation). */
export function refreshSession(): Promise<SessionData | null> {
  if (!inflight) inflight = doRefresh().finally(() => { inflight = null; });
  return inflight;
}

async function doRefresh(): Promise<SessionData | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: SessionData };
  accessToken = body.data.access_token;
  return body.data;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) refreshing = refreshSession().then((d) => !!d).finally(() => { refreshing = null; });
  return refreshing;
}

export interface SessionData {
  access_token: string;
  expires_at: string;
  user: { id: number; email: string; name: string; role: Role; tenant_id: number | null };
}

export type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'EDITOR' | 'CREATOR' | 'VIEWER';

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query; raw?: boolean } = {}): Promise<T> {
  const doFetch = () =>
    fetch(`/api${path}${qs(opts.query)}`, { signal: AbortSignal.timeout(30000),
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(opts.body !== undefined && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
      credentials: 'same-origin',
    });
  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/change-password') && !path.startsWith('/auth/refresh')) {
    if (await tryRefresh()) res = await doFetch();
    else listeners.forEach((l) => l());
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, 'server_error', `Server returned ${res.status}`, text?.slice(0, 200));
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? { code: 'error', message: res.statusText });
  return json as T;
}

/** Unwraps `{ data }` responses. */
export async function get<T>(path: string, query?: Query): Promise<T> {
  return (await api<{ data: T }>(path, { query })).data;
}
export async function post<T>(path: string, body: unknown = {}, query?: Query): Promise<T> {
  return (await api<{ data: T }>(path, { method: 'POST', body, query })).data;
}
export async function put<T>(path: string, body: unknown): Promise<T> {
  return (await api<{ data: T }>(path, { method: 'PUT', body })).data;
}
export async function del<T>(path: string, query?: Query): Promise<T> {
  return (await api<{ data: T }>(path, { method: 'DELETE', query })).data;
}

export interface ListResponse<T> {
  data: T[];
  meta: { total: number; page: number; per_page: number; pages: number };
}
export async function list<T>(path: string, query?: Query): Promise<ListResponse<T>> {
  return api<ListResponse<T>>(path, { query });
}

/** Downloads an authenticated export (CSV / JSON). */
export async function download(path: string, filename: string, query?: Query) {
  const res = await api<Response>(path, { query, raw: true });
  if (!res.ok) throw new ApiError(res.status, { code: 'download', message: 'Download failed' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Signed upload flow (PRD §77): init → PUT file to signed URL → complete.
 * Reports progress through onProgress (0..1).
 */
export async function uploadFile(
  purpose: string,
  targetId: number,
  file: File,
  onProgress?: (p: number) => void,
): Promise<{ url: string; audio_file_id?: number; job_id?: string; image_id?: number }> {
  const init = await post<{ upload_id: string; url: string; method: string; headers: Record<string, string> }>('/uploads', {
    purpose, target_id: targetId, filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size,
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method, init.url);
    for (const [k, v] of Object.entries(init.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error.message; } catch { /* keep default */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
  return post(`/uploads/${init.upload_id}/complete`);
}
