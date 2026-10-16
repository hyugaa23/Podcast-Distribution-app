'use client';

import type { Site } from '@podcast/types';
import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from '@podcast/config';
import {
  CloseButton, CurrentTime, Duration, IconPause, IconPlay, PlayButton, PlayerError, SeekBar, SkipBackButton, SkipForwardButton,
  SpeedControl, VolumeControl, usePlayer,
} from '@podcast/player';
import { NowPlaying, WhenPlaying } from '@podcast/ui';

/** Clean Editorial: a slim, quiet colophon-style bar with serif labels and text-like controls. */
export function EditorialPlayer(_: { site: Site }) {
  const p = usePlayer();
  const state = p.buffering && p.playing ? 'Loading' : p.playing ? 'Pause' : 'Listen';
  return (
    <WhenPlaying>
      <div className="te-player-spacer" aria-hidden="true" />
      <section className="te-player" aria-label="Audio player">
        <div className="te-player__rule">
          <CurrentTime className="te-player__time" />
          <SeekBar className="te-player__seek" />
          <Duration className="te-player__time" />
        </div>
        <div className="te-player__row">
          <div className="te-player__now">
            <span className="te-player__label" aria-hidden="true">Now playing</span>
            <NowPlaying className="te-player__meta" />
          </div>
          <div className="te-player__transport" role="group" aria-label="Playback">
            <SkipBackButton className="te-player__text">
              <span aria-hidden="true">&minus;{SKIP_BACK_SECONDS}s</span>
            </SkipBackButton>
            <PlayButton className="te-player__play">
              {p.playing ? <IconPause width={14} height={14} aria-hidden="true" /> : <IconPlay width={14} height={14} aria-hidden="true" />}
              <span>{state}</span>
            </PlayButton>
            <SkipForwardButton className="te-player__text">
              <span aria-hidden="true">+{SKIP_FORWARD_SECONDS}s</span>
            </SkipForwardButton>
          </div>
          <div className="te-player__aux">
            <SpeedControl className="te-player__speed" />
            <VolumeControl className="te-player__volume" />
            <CloseButton className="te-player__close" />
          </div>
        </div>
        <PlayerError className="pe-player-error te-player__error" />
      </section>
    </WhenPlaying>
  );
}
