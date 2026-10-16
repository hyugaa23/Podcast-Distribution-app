'use client';

import type { Site } from '@podcast/types';
import { CloseButton, CurrentTime, Duration, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton, SpeedControl, VolumeControl } from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/**
 * Premium Magazine: a slim, elegant bar fixed to the bottom of the page — a hairline
 * progress rule along its top edge, small-caps serif labels, and refined transport.
 */
export function MagazinePlayer(_: { site: Site }) {
  return (
    <WhenPlaying>
      <div className="tz-player-spacer" aria-hidden="true" />
      <section className="tz-player" aria-label="Audio player">
        <div className="tz-player__rule">
          <SeekBar className="tz-player__seek" />
        </div>
        <div className="tz-player__inner">
          <div className="tz-player__now">
            <span className="tz-player__label" aria-hidden="true">Now listening</span>
            <NowPlaying className="tz-player__meta" />
          </div>
          <div className="tz-player__transport">
            <SkipBackButton className="tz-player__icon tz-player__skip" />
            <PlayButton className="tz-player__play" />
            <SkipForwardButton className="tz-player__icon tz-player__skip" />
          </div>
          <div className="tz-player__times">
            <CurrentTime className="tz-player__time" />
            <span className="tz-player__sep" aria-hidden="true">/</span>
            <Duration className="tz-player__time" />
          </div>
          <div className="tz-player__opts">
            <span className="tz-player__label tz-player__label--inline" aria-hidden="true">Tempo</span>
            <SpeedControl className="tz-player__speed" />
            <VolumeControl className="tz-player__volume" />
            <CloseButton className="tz-player__icon tz-player__close" />
          </div>
        </div>
        <PlayerError className="pe-player-error tz-player__error" />
      </section>
    </WhenPlaying>
  );
}
