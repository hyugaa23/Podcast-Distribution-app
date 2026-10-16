'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnalyticsEventType, PlayerTrack } from '@podcast/types';

export interface PlayerState {
  track: PlayerTrack | null;
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  error: string | null;
}

export interface PlayerApi extends PlayerState {
  /** Load and play a track, or toggle if it is already the current track. */
  play: (track?: PlayerTrack) => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRate: (r: number) => void;
  close: () => void;
  isCurrent: (episodeId: number) => boolean;
  /** Report a download click for analytics. */
  trackDownload: (track: PlayerTrack) => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export type PlayerEventHandler = (type: AnalyticsEventType, track: PlayerTrack, position: number) => void;

const STORE_KEY = 'pe-player';

function loadPrefs(): { volume: number; rate: number } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { volume: typeof v.volume === 'number' ? v.volume : 1, rate: typeof v.rate === 'number' ? v.rate : 1 };
  } catch {
    return { volume: 1, rate: 1 };
  }
}

/**
 * Global audio player. Mount once in the root layout so audio keeps playing across
 * client-side navigation (PRD §16 persistent player).
 */
export function PlayerProvider({ children, onEvent }: { children: ReactNode; onEvent?: PlayerEventHandler }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    track: null, playing: false, buffering: false, currentTime: 0, duration: 0, volume: 1, muted: false, rate: 1, error: null,
  });
  const trackRef = useRef<PlayerTrack | null>(null);
  const milestones = useRef<Set<string>>(new Set());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const emit = useCallback((type: AnalyticsEventType) => {
    const t = trackRef.current;
    const a = audioRef.current;
    if (t && onEventRef.current) onEventRef.current(type, t, Math.floor(a?.currentTime ?? 0));
  }, []);

  // Restore user preferences.
  useEffect(() => {
    const p = loadPrefs();
    setState((s) => ({ ...s, volume: p.volume, rate: p.rate }));
    if (audioRef.current) {
      audioRef.current.volume = p.volume;
      audioRef.current.playbackRate = p.rate;
    }
  }, []);

  const savePrefs = (volume: number, rate: number) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ volume, rate }));
    } catch {
      /* storage unavailable */
    }
  };

  const updateMediaSession = useCallback((t: PlayerTrack) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.podcastTitle,
      album: t.podcastTitle,
      artwork: t.artworkUrl ? [{ src: t.artworkUrl, sizes: '512x512' }] : [],
    });
  }, []);

  const play = useCallback(
    (track?: PlayerTrack) => {
      const a = audioRef.current;
      if (!a) return;
      if (track && track.episodeId !== trackRef.current?.episodeId) {
        trackRef.current = track;
        milestones.current = new Set();
        a.src = track.audioUrl;
        a.playbackRate = state.rate;
        a.load();
        setState((s) => ({ ...s, track, currentTime: 0, duration: track.duration || 0, error: null, buffering: true }));
        updateMediaSession(track);
      }
      a.play().catch((err) => {
        if (err?.name !== 'AbortError') setState((s) => ({ ...s, error: 'Playback failed. Please try again.', playing: false }));
      });
    },
    [state.rate, updateMediaSession],
  );

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !trackRef.current) return;
    if (a.paused) play();
    else a.pause();
  }, [play]);

  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seek = useCallback(
    (seconds: number) => {
      const a = audioRef.current;
      if (!a || !trackRef.current) return;
      const d = Number.isFinite(a.duration) ? a.duration : trackRef.current.duration;
      a.currentTime = Math.max(0, Math.min(seconds, d || seconds));
      setState((s) => ({ ...s, currentTime: a.currentTime }));
      if (seekTimer.current) clearTimeout(seekTimer.current);
      seekTimer.current = setTimeout(() => emit('SEEK'), 800);
    },
    [emit],
  );
  const skip = useCallback((delta: number) => seek((audioRef.current?.currentTime ?? 0) + delta), [seek]);

  const setVolume = useCallback((v: number) => {
    const a = audioRef.current;
    const vol = Math.max(0, Math.min(1, v));
    if (a) {
      a.volume = vol;
      a.muted = vol === 0;
    }
    setState((s) => {
      savePrefs(vol, s.rate);
      return { ...s, volume: vol, muted: vol === 0 };
    });
  }, []);

  const toggleMute = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !a.muted;
    setState((s) => ({ ...s, muted: a.muted }));
  }, []);

  const setRate = useCallback((r: number) => {
    const a = audioRef.current;
    if (a) a.playbackRate = r;
    setState((s) => {
      savePrefs(s.volume, r);
      return { ...s, rate: r };
    });
  }, []);

  const close = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    trackRef.current = null;
    setState((s) => ({ ...s, track: null, playing: false, currentTime: 0, duration: 0 }));
  }, []);

  const trackDownload = useCallback((t: PlayerTrack) => onEventRef.current?.('DOWNLOAD', t, 0), []);

  // Wire audio element events.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => {
      setState((s) => ({ ...s, playing: true, error: null }));
      if (!milestones.current.has('PLAY')) {
        milestones.current.add('PLAY');
        emit('PLAY');
      }
    };
    const onPause = () => {
      setState((s) => ({ ...s, playing: false }));
      if (!a.ended) emit('PAUSE');
    };
    const onTime = () => {
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : trackRef.current?.duration || 0;
      setState((s) => ({ ...s, currentTime: a.currentTime, duration: d || s.duration }));
      if (d > 0) {
        const pct = a.currentTime / d;
        for (const [mark, type] of [[0.25, '25_PERCENT'], [0.5, '50_PERCENT'], [0.75, '75_PERCENT']] as const) {
          if (pct >= mark && !milestones.current.has(type)) {
            milestones.current.add(type);
            emit(type);
          }
        }
      }
    };
    const onEnded = () => {
      setState((s) => ({ ...s, playing: false }));
      if (!milestones.current.has('COMPLETE')) {
        milestones.current.add('COMPLETE');
        emit('COMPLETE');
      }
    };
    const onWaiting = () => setState((s) => ({ ...s, buffering: true }));
    const onCanPlay = () => setState((s) => ({ ...s, buffering: false }));
    const onMeta = () => setState((s) => ({ ...s, duration: Number.isFinite(a.duration) ? a.duration : s.duration }));
    const onError = () => setState((s) => ({ ...s, playing: false, buffering: false, error: 'This episode could not be loaded.' }));
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    a.addEventListener('waiting', onWaiting);
    a.addEventListener('canplay', onCanPlay);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('waiting', onWaiting);
      a.removeEventListener('canplay', onCanPlay);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('error', onError);
    };
  }, [emit]);

  // Media Session (lock screen / hardware keys).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => play());
    ms.setActionHandler('pause', () => pause());
    ms.setActionHandler('seekbackward', () => skip(-15));
    ms.setActionHandler('seekforward', () => skip(30));
    ms.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime));
    return () => {
      for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* unsupported */
        }
      }
    };
  }, [play, pause, skip, seek]);

  const api = useMemo<PlayerApi>(
    () => ({
      ...state,
      play, pause, toggle, seek, skip, setVolume, toggleMute, setRate, close, trackDownload,
      isCurrent: (id: number) => state.track?.episodeId === id,
    }),
    [state, play, pause, toggle, seek, skip, setVolume, toggleMute, setRate, close, trackDownload],
  );

  return (
    <PlayerContext.Provider value={api}>
      {children}
      {/* The single audio element lives outside page content so navigation never unmounts it. */}
      <audio ref={audioRef} preload="metadata" aria-hidden="true" />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
