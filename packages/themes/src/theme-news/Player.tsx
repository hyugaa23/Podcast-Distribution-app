'use client';

import type { Site } from '@podcast/types';
import { CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl } from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Newsroom: compact bottom bar — red "Now playing" label block · story · dense transport · mono timecodes · tools. */
export function NewsPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="tn-player-spacer" aria-hidden="true" />
      <section className="tn-player" aria-label="Audio player">
        <div className="tn-player__label" aria-hidden="true">
          <span className="tn-player__dot" />
          <span>Now<br />playing</span>
        </div>
        <div className="tn-player__story">
          <NowPlaying />
        </div>
        <div className="tn-player__controls">
          <div className="tn-player__transport">
            <SkipBackButton className="tn-player__btn" />
            <PlayButton className="tn-player__play" />
            <SkipForwardButton className="tn-player__btn" />
          </div>
          <div className="tn-player__seek">
            <CurrentTime className="tn-player__time" />
            <SeekBar className="tn-player__range" />
            <Duration className="tn-player__time" />
          </div>
          <PlayerError className="pe-player-error" />
        </div>
        <div className="tn-player__tools">
          <SpeedControl className="tn-player__speed" />
          <VolumeControl className="tn-player__volume" />
          <CloseButton className="tn-player__btn tn-player__close" />
        </div>
      </section>
    </WhenPlaying>
  );
}
