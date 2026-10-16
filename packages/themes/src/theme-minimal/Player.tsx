'use client';

import { useId, useState } from 'react';
import type { Site } from '@podcast/types';
import {
  CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl,
  usePlayer,
} from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/**
 * Minimal: a small floating pill centred at the bottom (play · title · hairline progress).
 * "More" expands a quiet card above it with artwork, seek + times, skip, speed, volume.
 */
export function MinimalPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <MinimalPill />
    </WhenPlaying>
  );
}

function MinimalPill() {
  const p = usePlayer();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!p.track) return null;
  const pct = p.duration > 0 ? Math.min(100, (p.currentTime / p.duration) * 100) : 0;
  return (
    <>
      <div className="tm-player-spacer" aria-hidden="true" />
      <section className={`tm-player ${open ? 'is-open' : ''}`} aria-label="Audio player">
        <div id={panelId} className="tm-player__panel" hidden={!open}>
          <NowPlaying className="tm-player__now" />
          <div className="tm-player__seek">
            <CurrentTime className="tm-player__time" />
            <SeekBar className="tm-player__range" />
            <Duration className="tm-player__time" />
          </div>
          <div className="tm-player__controls">
            <SpeedControl className="tm-player__speed" />
            <div className="tm-player__transport">
              <SkipBackButton className="tm-player__icon" />
              <PlayButton className="tm-player__play tm-player__play--lg" />
              <SkipForwardButton className="tm-player__icon" />
            </div>
            <VolumeControl className="tm-player__volume" />
          </div>
        </div>
        <div className="tm-player__pill">
          <PlayButton className="tm-player__play" />
          <div className="tm-player__info">
            <a className="tm-player__title" href={`/podcast/${p.track.podcastSlug}/${p.track.episodeSlug}`}>{p.track.title}</a>
            <span className="tm-player__line" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
          </div>
          <span className="tm-player__inline">
            <SkipBackButton className="tm-player__icon" />
            <SkipForwardButton className="tm-player__icon" />
          </span>
          <button
            type="button"
            className="tm-player__toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Less' : 'More'}
          </button>
          <CloseButton className="tm-player__icon tm-player__close" />
        </div>
        <PlayerError className="pe-player-error tm-player__error" />
      </section>
    </>
  );
}
