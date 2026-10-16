'use client';

import type { Site } from '@podcast/types';
import { CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl } from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Business: floating, centred white "dock" card with a compact control cluster and an inline seek row. */
export function BusinessPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="tb-player-spacer" aria-hidden="true" />
      <section className="tb-player" aria-label="Audio player">
        <div className="tb-player__info">
          <NowPlaying className="tb-player__now" />
        </div>
        <div className="tb-player__main">
          <div className="tb-player__controls">
            <SkipBackButton className="tb-player__btn" />
            <PlayButton className="tb-player__play" />
            <SkipForwardButton className="tb-player__btn" />
          </div>
          <div className="tb-player__seek">
            <CurrentTime className="tb-player__time" />
            <SeekBar className="tb-player__range" />
            <Duration className="tb-player__time" />
          </div>
          <PlayerError className="pe-player-error" />
        </div>
        <div className="tb-player__tools">
          <SpeedControl className="tb-player__speed" />
          <VolumeControl className="tb-player__volume" />
          <CloseButton className="tb-player__btn tb-player__close" />
        </div>
      </section>
    </WhenPlaying>
  );
}
