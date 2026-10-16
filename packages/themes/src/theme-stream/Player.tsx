'use client';

import type { Site } from '@podcast/types';
import { CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl } from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Stream Dark: full-width persistent bottom bar (now playing · transport + seek · speed/volume). */
export function StreamPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="ts-player-spacer" aria-hidden="true" />
      <section className="ts-player" aria-label="Audio player">
        <div className="ts-player__left">
          <NowPlaying />
        </div>
        <div className="ts-player__center">
          <div className="ts-player__transport">
            <SkipBackButton className="ts-player__icon" />
            <PlayButton className="ts-player__play" />
            <SkipForwardButton className="ts-player__icon" />
          </div>
          <div className="ts-player__seek">
            <CurrentTime className="ts-player__time" />
            <SeekBar className="ts-player__range" />
            <Duration className="ts-player__time" />
          </div>
          <PlayerError className="pe-player-error" />
        </div>
        <div className="ts-player__right">
          <SpeedControl className="ts-player__speed" />
          <VolumeControl className="ts-player__volume" />
          <CloseButton className="ts-player__icon" />
        </div>
      </section>
    </WhenPlaying>
  );
}
