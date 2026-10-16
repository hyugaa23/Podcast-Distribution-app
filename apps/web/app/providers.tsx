'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PlayerProvider, type PlayerEventHandler } from '@podcast/player';
import type { AnalyticsEventType } from '@podcast/types';
import { ScrollReveal, endNavProgress, startNavProgress } from '@podcast/ui';

function sessionId(): string {
  try {
    let id = sessionStorage.getItem('pe-sid');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('pe-sid', id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

interface TrackPayload {
  type: AnalyticsEventType;
  podcast_id?: number;
  episode_id?: number;
  path?: string;
  referrer?: string;
  position?: number;
}

function send(ev: TrackPayload) {
  const body = JSON.stringify({ ...ev, session_id: sessionId(), path: ev.path ?? location.pathname });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    /* fall through */
  }
  fetch('/api/track', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
}

/** Records PAGE_VIEW on every client-side navigation (PRD §57). Pages mark podcast/episode ids via <TrackMarker>. */
function PageViewTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => {
      const marker = document.querySelector<HTMLElement>('[data-pv]');
      send({
        type: 'PAGE_VIEW',
        podcast_id: Number(marker?.dataset.podcast) || undefined,
        episode_id: Number(marker?.dataset.episode) || undefined,
        referrer: first.current ? document.referrer : location.origin,
      });
      first.current = false;
    }, 50);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}

/**
 * Turns same-origin links rendered by any theme into client-side navigations, so the global
 * player keeps playing while listeners browse (PRD §16 persistent player).
 */
function ClientNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => endNavProgress(), [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || !a.href || a.target && a.target !== '_self' || a.hasAttribute('download') || a.getAttribute('rel')?.includes('external')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      // Feeds, sitemaps, transcripts and API routes are files, not pages.
      if (/\.(xml|txt|vtt|srt|mp3|m4a|json)$/i.test(url.pathname) || url.pathname.startsWith('/api/')) return;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // in-page anchors
      e.preventDefault();
      if (url.pathname !== location.pathname) startNavProgress();
      router.push(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const onEvent = useCallback<PlayerEventHandler>((type, track, position) => {
    send({ type, podcast_id: track.podcastId, episode_id: track.episodeId, position });
  }, []);
  const pathname = usePathname();
  return (
    <PlayerProvider onEvent={onEvent}>
      <PageViewTracker />
      <ClientNavigation />
      <ScrollReveal pathname={pathname} />
      {children}
    </PlayerProvider>
  );
}
