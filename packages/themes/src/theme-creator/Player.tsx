'use client';

import type { Site } from '@podcast/types';
import { CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl } from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Creator: a floating rounded "now playing" card anchored bottom-right; a bottom sheet on mobile. */
export function CreatorPlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="tc-player-spacer" aria-hidden="true" />
      <section className="tc-player" aria-label="Audio player">
        <div className="tc-player__top">
          <NowPlaying className="tc-player__now" />
          <CloseButton className="tc-player__close" />
        </div>
        <div className="tc-player__seek">
          <SeekBar className="tc-player__range" />
          <div className="tc-player__times">
            <CurrentTime className="tc-player__time" />
            <Duration className="tc-player__time" />
          </div>
        </div>
        <div className="tc-player__controls">
          <SpeedControl className="tc-player__speed" />
          <div className="tc-player__transport">
            <SkipBackButton className="tc-player__skip" />
            <PlayButton className="tc-player__play" />
            <SkipForwardButton className="tc-player__skip" />
          </div>
          <VolumeControl className="tc-player__volume" sliderClassName="tc-player__volrange" />
        </div>
        <PlayerError className="pe-player-error" />
      </section>
    </WhenPlaying>
  );
}
