'use client';

import type { Site } from '@podcast/types';
import {
  CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl,
  usePlayer,
} from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Radio: a tall broadcast console docked to the bottom — ON AIR label, live equalizer, huge round play button. */
export function RadioPlayer(_: { site: Site }) {
  const p = usePlayer();
  const live = p.playing;
  return (
    <WhenPlaying>
      <div className="tr-player-spacer" aria-hidden="true" />
      <section className={`tr-player ${live ? 'is-live' : 'is-paused'}`} aria-label="Audio player">
        <div className="tr-player__meta">
          <p className="tr-player__label">
            <span className="tr-player__dot" aria-hidden="true" />
            <span>{live ? 'Now playing' : 'Paused'}</span>
            <span className="tr-eq tr-eq--sm" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </p>
          <NowPlaying className="tr-player__np" />
        </div>
        <div className="tr-player__transport">
          <SkipBackButton className="tr-player__icon" />
          <PlayButton className="tr-player__play" />
          <SkipForwardButton className="tr-player__icon" />
        </div>
        <div className="tr-player__seek">
          <CurrentTime className="tr-player__time" />
          <SeekBar className="tr-player__range" />
          <Duration className="tr-player__time" />
          <PlayerError className="pe-player-error tr-player__error" />
        </div>
        <div className="tr-player__tools">
          <SpeedControl className="tr-player__speed" />
          <VolumeControl className="tr-player__volume" />
          <CloseButton className="tr-player__icon tr-player__close" />
        </div>
      </section>
    </WhenPlaying>
  );
}
