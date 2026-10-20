'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Episode } from '@podcast/types';
import { IconPause, IconPlay, PlayButton, formatTime, toTrack, usePlayer } from '@podcast/player';

/** Play / pause button bound to an episode. Children override the default icon+label. */
export function EpisodePlayButton({
  episode, className, variant = 'icon', label,
}: { episode: Episode; className?: string; variant?: 'icon' | 'pill' | 'text'; label?: string }) {
  const p = usePlayer();
  const playing = p.isCurrent(episode.id) && p.playing;
  if (!episode.audio_url) return null;
  return (
    <PlayButton track={toTrack(episode)} className={`pe-play pe-play--${variant} ${playing ? 'is-playing' : ''} ${className ?? ''}`}>
      {variant === 'icon' ? undefined : (
        <>
          {playing ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
          <span>{label ?? (playing ? 'Pause' : p.isCurrent(episode.id) ? 'Resume' : 'Play episode')}</span>
        </>
      )}
    </PlayButton>
  );
}

/** Social sharing: Copy Link, Facebook, X, LinkedIn, WhatsApp (PRD §94). */
export function ShareButtons({ url, title, className }: { url: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && 'share' in navigator), []);
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: 'X', href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { name: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}` },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className={`pe-share ${className ?? ''}`} role="group" aria-label="Share">
      <button type="button" onClick={copy} className="pe-share__btn">{copied ? 'Link copied ✓' : 'Copy link'}</button>
      {links.map((l) => (
        <a key={l.name} className="pe-share__btn" href={l.href} target="_blank" rel="noopener noreferrer" aria-label={`Share on ${l.name}`}>
          {l.name}
        </a>
      ))}
      {canShare && (
        <button type="button" className="pe-share__btn" onClick={() => navigator.share({ title, url }).catch(() => {})}>More…</button>
      )}
    </div>
  );
}

/** Follow / subscribe CTA: copy the RSS URL for any podcast app (PRD §12). */
export function SubscribeButton({ feedUrl, className, children }: { feedUrl: string; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className={`pe-subscribe ${className ?? ''}`}>
      <button type="button" className="pe-subscribe__btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {children ?? 'Follow'}
      </button>
      {open && (
        <div className="pe-subscribe__panel" role="dialog" aria-label="Subscribe">
          <p>Copy this RSS feed into any podcast app to follow the show:</p>
          <div className="pe-subscribe__row">
            <input readOnly value={feedUrl} aria-label="RSS feed URL" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={async () => {
              try {
                await navigator.clipboard.writeText(feedUrl);
                setCopied(true); setTimeout(() => setCopied(false), 2000);
              } catch {
                const ta = document.createElement('textarea');
                ta.value = feedUrl;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                setCopied(true); setTimeout(() => setCopied(false), 2000);
              }
            }}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Cue {
  start: number;
  text: string;
}

function parseTimestamp(ts: string): number {
  const m = ts.trim().replace(',', '.').split(':').map(Number);
  if (m.some(Number.isNaN)) return 0;
  return m.length === 3 ? m[0]! * 3600 + m[1]! * 60 + m[2]! : m.length === 2 ? m[0]! * 60 + m[1]! : m[0]!;
}

/** Parses VTT / SRT into cues; TXT returns one cue per paragraph without timing. */
export function parseTranscript(text: string, format?: string): { cues: Cue[]; timed: boolean } {
  const fmt = format || (text.trim().startsWith('WEBVTT') ? 'vtt' : text.includes(' --> ') ? 'srt' : 'txt');
  if (fmt === 'txt') {
    return { cues: text.split(/\n{1,}/).map((t) => t.trim()).filter(Boolean).map((t) => ({ start: -1, text: t })), timed: false };
  }
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter((l) => l.trim() && l.trim() !== 'WEBVTT');
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const start = parseTimestamp(lines[idx]!.split('-->')[0]!);
    const body = lines.slice(idx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (body) cues.push({ start, text: body });
  }
  return { cues, timed: true };
}

/** Accessible, searchable transcript. Timestamps seek the player (PRD §32, §82). */
export function Transcript({ episode, className, collapsed = true }: { episode: Episode; className?: string; collapsed?: boolean }) {
  const p = usePlayer();
  const [open, setOpen] = useState(!collapsed);
  const [q, setQ] = useState('');
  const { cues, timed } = useMemo(() => parseTranscript(episode.transcript ?? '', episode.transcript_format), [episode.transcript, episode.transcript_format]);
  if (!episode.transcript) return null;
  const isCurrent = p.isCurrent(episode.id);
  const activeIdx = isCurrent && timed ? cues.findLastIndex((c) => c.start <= p.currentTime) : -1;
  const shown = q ? cues.filter((c) => c.text.toLowerCase().includes(q.toLowerCase())) : cues;
  const jump = (t: number) => {
    if (!isCurrent) p.play(toTrack(episode));
    setTimeout(() => p.seek(t), isCurrent ? 0 : 300);
  };
  return (
    <section className={`pe-transcript ${className ?? ''}`} aria-labelledby={`tr-${episode.id}`}>
      <div className="pe-transcript__head">
        <h2 id={`tr-${episode.id}`}>Transcript</h2>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide' : 'Show'} transcript</button>
      </div>
      {/* Full text stays in the DOM for search engines and answer engines even when collapsed. */}
      <div className="pe-transcript__body" hidden={!open}>
        <input type="search" placeholder="Search transcript…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transcript" />
        <ol className="pe-transcript__cues">
          {shown.map((c, i) => (
            <li key={i} className={cues.indexOf(c) === activeIdx ? 'is-active' : undefined}>
              {timed && (
                <button type="button" className="pe-transcript__ts" onClick={() => jump(c.start)} aria-label={`Play from ${formatTime(c.start)}`}>
                  {formatTime(c.start)}
                </button>
              )}
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Search form for "Search podcasts, episodes, hosts…" (PRD §28). */
export function SearchBox({ className, placeholder = 'Search podcasts, episodes, hosts…', defaultValue }: { className?: string; placeholder?: string; defaultValue?: string }) {
  return (
    <form role="search" action="/search" method="get" className={`pe-search ${className ?? ''}`}>
      <label className="pe-sr-only" htmlFor="pe-search-q">Search</label>
      <input id="pe-search-q" type="search" name="q" placeholder={placeholder} defaultValue={defaultValue} autoComplete="off" />
      <button type="submit" aria-label="Search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
    </form>
  );
}

/** Mobile navigation toggle: flips data-nav-open on the closest [data-nav] element. Escape closes it. */
export function NavToggle({ className, label = 'Menu' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const set = (next: boolean) => {
    setOpen(next);
    ref.current?.closest('[data-nav]')?.setAttribute('data-nav-open', String(next));
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        set(false);
        ref.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <button ref={ref} type="button" className={`pe-navtoggle ${className ?? ''}`} aria-expanded={open}
      aria-label={open ? 'Close menu' : label} onClick={() => set(!open)}>
      <span aria-hidden="true">{open ? '✕' : '☰'}</span>
    </button>
  );
}

/** Download link that reports a DOWNLOAD analytics event (PRD §58 optional events). */
export function DownloadLink({ episode, className, children }: { episode: Episode; className?: string; children?: ReactNode }) {
  const p = usePlayer();
  if (!episode.audio_url) return null;
  return (
    <a href={episode.audio_url} download className={className} onClick={() => p.trackDownload(toTrack(episode))}>
      {children ?? 'Download'}
    </a>
  );
}

/** Small "now playing" metadata used inside theme player bars. */
export function NowPlaying({ className, showArtwork = true }: { className?: string; showArtwork?: boolean }) {
  const p = usePlayer();
  if (!p.track) return null;
  const t = p.track;
  return (
    <div className={`pe-nowplaying ${className ?? ''}`}>
      {showArtwork && t.artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.artworkUrl} alt={`${t.podcastTitle} artwork`} width={56} height={56} className="pe-nowplaying__art" />
      )}
      <div className="pe-nowplaying__meta">
        <span className="pe-eq" aria-hidden="true" {...(p.playing ? {} : { "data-paused": "" })}><i /><i /><i /><i /></span>
        <a className="pe-nowplaying__title" href={`/podcast/${t.podcastSlug}/${t.episodeSlug}`}>{t.title}</a>
        <a className="pe-nowplaying__podcast" href={`/podcast/${t.podcastSlug}`}>{t.podcastTitle}</a>
      </div>
    </div>
  );
}

/** Renders children only while a track is loaded (player bars hide when idle). */
export function WhenPlaying({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const p = usePlayer();
  return <>{p.track ? children : fallback}</>;
}
