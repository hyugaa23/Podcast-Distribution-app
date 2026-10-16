'use client';

import { useId, type CSSProperties, type ReactNode } from 'react';
import type { PlayerTrack } from '@podcast/types';
import { PLAYBACK_SPEEDS, SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from '@podcast/config';
import { usePlayer } from './PlayerProvider';
import { IconBack, IconClose, IconForward, IconPause, IconPlay, IconSpinner, IconVolume, IconVolumeMute } from './icons';

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type BtnProps = { className?: string; style?: CSSProperties; children?: ReactNode };

/** Play/pause for the current track, or for `track` (starts it if not current). */
export function PlayButton({ track, className, style, children, label }: BtnProps & { track?: PlayerTrack; label?: string }) {
  const p = usePlayer();
  const current = !track || p.isCurrent(track.episodeId);
  const playing = current && p.playing;
  const busy = current && p.buffering && p.playing;
  const name = track?.title ?? p.track?.title ?? 'episode';
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label ?? `${playing ? 'Pause' : 'Play'} ${name}`}
      aria-pressed={playing}
      onClick={() => (track && !current ? p.play(track) : track && !p.track ? p.play(track) : p.toggle())}
      disabled={!track && !p.track}
    >
      {children ?? (busy ? <IconSpinner /> : playing ? <IconPause /> : <IconPlay />)}
    </button>
  );
}

export function SkipBackButton({ className, style, children }: BtnProps) {
  const p = usePlayer();
  return (
    <button type="button" className={className} style={style} aria-label={`Skip back ${SKIP_BACK_SECONDS} seconds`}
      onClick={() => p.skip(-SKIP_BACK_SECONDS)} disabled={!p.track}>
      {children ?? <IconBack />}
    </button>
  );
}

export function SkipForwardButton({ className, style, children }: BtnProps) {
  const p = usePlayer();
  return (
    <button type="button" className={className} style={style} aria-label={`Skip forward ${SKIP_FORWARD_SECONDS} seconds`}
      onClick={() => p.skip(SKIP_FORWARD_SECONDS)} disabled={!p.track}>
      {children ?? <IconForward />}
    </button>
  );
}

/** Accessible seek slider (keyboard: arrows ±5s, PageUp/PageDown ±30s, Home/End). */
export function SeekBar({ className, style }: { className?: string; style?: CSSProperties }) {
  const p = usePlayer();
  const max = Math.max(p.duration, 1);
  const pct = Math.min(100, (p.currentTime / max) * 100);
  return (
    <input
      type="range"
      className={className}
      style={{ ...style, ['--pct' as string]: `${pct}%` }}
      min={0}
      max={max}
      step={1}
      value={Math.floor(p.currentTime)}
      onChange={(e) => p.seek(Number(e.target.value))}
      aria-label="Seek"
      aria-valuetext={`${formatTime(p.currentTime)} of ${formatTime(p.duration)}`}
      disabled={!p.track}
    />
  );
}

export function CurrentTime({ className }: { className?: string }) {
  const p = usePlayer();
  return <span className={className} aria-label="Current time">{formatTime(p.currentTime)}</span>;
}

export function Duration({ className }: { className?: string }) {
  const p = usePlayer();
  return <span className={className} aria-label="Duration">{formatTime(p.duration)}</span>;
}

export function VolumeControl({ className, sliderClassName }: { className?: string; sliderClassName?: string }) {
  const p = usePlayer();
  const v = p.muted ? 0 : p.volume;
  return (
    <div className={className}>
      <button type="button" onClick={p.toggleMute} aria-label={p.muted ? 'Unmute' : 'Mute'} aria-pressed={p.muted}>
        {v === 0 ? <IconVolumeMute /> : <IconVolume />}
      </button>
      <input type="range" className={sliderClassName} min={0} max={1} step={0.05} value={v}
        onChange={(e) => p.setVolume(Number(e.target.value))} aria-label="Volume"
        aria-valuetext={`${Math.round(v * 100)}%`} style={{ ['--pct' as string]: `${v * 100}%` }} />
    </div>
  );
}

/** Playback speed selector: 0.75x – 2x (PRD §16). */
export function SpeedControl({ className }: { className?: string }) {
  const p = usePlayer();
  const id = useId();
  return (
    <span className={className}>
      <label htmlFor={id} className="pe-sr-only">Playback speed</label>
      <select id={id} value={p.rate} onChange={(e) => p.setRate(Number(e.target.value))} aria-label="Playback speed">
        {PLAYBACK_SPEEDS.map((s) => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </span>
  );
}

export function CloseButton({ className }: { className?: string }) {
  const p = usePlayer();
  return (
    <button type="button" className={className} onClick={p.close} aria-label="Close player">
      <IconClose />
    </button>
  );
}

/** Shows the player error message, if any. */
export function PlayerError({ className }: { className?: string }) {
  const p = usePlayer();
  if (!p.error) return null;
  return <span role="alert" className={className}>{p.error}</span>;
}
