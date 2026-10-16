// Theme registry (PRD §40–51, §68). One application + theme engine + tenant configuration (PRD §112).
import type { ThemeKey } from '@podcast/types';
import type { Theme } from './contract';
import { streamTheme } from './theme-stream';
import { editorialTheme } from './theme-editorial';
import { newsTheme } from './theme-news';
import { minimalTheme } from './theme-minimal';
import { creatorTheme } from './theme-creator';
import { radioTheme } from './theme-radio';
import { techTheme } from './theme-tech';
import { businessTheme } from './theme-business';
import { entertainmentTheme } from './theme-entertainment';
import { magazineTheme } from './theme-magazine';

export const themes: Record<ThemeKey, Theme> = {
  stream: streamTheme,
  editorial: editorialTheme,
  news: newsTheme,
  minimal: minimalTheme,
  creator: creatorTheme,
  radio: radioTheme,
  tech: techTheme,
  business: businessTheme,
  entertainment: entertainmentTheme,
  magazine: magazineTheme,
};

export function getTheme(key: string | undefined | null): Theme {
  return themes[(key ?? 'stream') as ThemeKey] ?? streamTheme;
}

export type { Theme } from './contract';
export * from './contract';
export * from './shared';
