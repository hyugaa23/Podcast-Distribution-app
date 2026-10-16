'use client';

import type { Site } from '@podcast/types';
import { CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl } from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Entertainment: floating pill-shaped player with a colourful gradient rim; full-width rounded bar on mobile. */
export function EntertainmentPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="tx-player-spacer" aria-hidden="true" />
      <section className="tx-player" aria-label="Audio player">
        <div className="tx-player__pill">
          <NowPlaying className="tx-player__now" />
          <div className="tx-player__transport">
            <SkipBackButton className="tx-player__icon" />
            <PlayButton className="tx-player__play" />
            <SkipForwardButton className="tx-player__icon" />
          </div>
          <div className="tx-player__seek">
            <CurrentTime className="tx-player__time" />
            <SeekBar className="tx-player__range" />
            <Duration className="tx-player__time" />
          </div>
          <div className="tx-player__extra">
            <SpeedControl className="tx-player__speed" />
            <VolumeControl className="tx-player__volume" />
          </div>
          <CloseButton className="tx-player__icon tx-player__close" />
          <PlayerError className="pe-player-error tx-player__error" />
        </div>
      </section>
    </WhenPlaying>
  );
}
