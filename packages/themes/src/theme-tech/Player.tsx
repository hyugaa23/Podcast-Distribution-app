'use client';

import type { Site } from '@podcast/types';
import {
  CloseButton, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl, usePlayer,
} from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Always-hours timecode: 00:12:31 */
function timecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec / 60) % 60))}:${pad(Math.floor(sec % 60))}`;
}

function Timecode() {
  const p = usePlayer();
  return (
    <span className="tk-dock__tc" aria-label={`Elapsed ${timecode(p.currentTime)} of ${timecode(p.duration)}`}>
      <span aria-hidden="true">{timecode(p.currentTime)}</span>
      <span className="tk-dock__tc-sep" aria-hidden="true"> / </span>
      <span aria-hidden="true" className="tk-dock__tc-total">{timecode(p.duration)}</span>
    </span>
  );
}

function Status() {
  const p = usePlayer();
  const label = p.buffering && p.playing ? 'buffering' : p.playing ? 'playing' : 'paused';
  return <span className={`tk-dock__status tk-dock__status--${label}`}>{label}</span>;
}

/** Tech: compact floating dock with a gradient progress rail and mono timecode. */
export function TechPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="tk-dock-spacer" aria-hidden="true" />
      <section className="tk-dock" aria-label="Audio player">
        <div className="tk-dock__now">
          <NowPlaying className="tk-dock__np" />
        </div>
        <div className="tk-dock__transport">
          <SkipBackButton className="tk-dock__icon" />
          <PlayButton className="tk-dock__play" />
          <SkipForwardButton className="tk-dock__icon" />
        </div>
        <div className="tk-dock__seek">
          <Status />
          <SeekBar className="tk-dock__range" />
          <Timecode />
          <PlayerError className="pe-player-error tk-dock__err" />
        </div>
        <div className="tk-dock__tools">
          <SpeedControl className="tk-dock__speed" />
          <VolumeControl className="tk-dock__vol" />
          <CloseButton className="tk-dock__icon tk-dock__close" />
        </div>
      </section>
    </WhenPlaying>
  );
}
