// Shared configuration: theme registry metadata and design tokens used by web + admin.

import type { ThemeConfig, ThemeKey } from '@podcast/types';

export interface ThemeMeta {
  key: ThemeKey;
  number: number;
  name: string;
  /** Packaged folder name (PRD §68). */
  folder: string;
}

export const THEMES: ThemeMeta[] = [
  { key: 'stream', number: 1, name: 'Stream Dark', folder: 'theme-stream' },
  { key: 'editorial', number: 2, name: 'Clean Editorial', folder: 'theme-editorial' },
  { key: 'news', number: 3, name: 'Newsroom', folder: 'theme-news' },
  { key: 'minimal', number: 4, name: 'Minimal', folder: 'theme-minimal' },
  { key: 'creator', number: 5, name: 'Creator', folder: 'theme-creator' },
  { key: 'radio', number: 6, name: 'Radio', folder: 'theme-radio' },
  { key: 'tech', number: 7, name: 'Tech', folder: 'theme-tech' },
  { key: 'business', number: 8, name: 'Business', folder: 'theme-business' },
  { key: 'entertainment', number: 9, name: 'Entertainment', folder: 'theme-entertainment' },
  { key: 'magazine', number: 10, name: 'Premium Magazine', folder: 'theme-magazine' },
];

/** Playback speeds offered by every player (PRD §16). */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const SKIP_BACK_SECONDS = 15;
export const SKIP_FORWARD_SECONDS = 30;

/** Converts a theme config into CSS custom properties applied on the theme root. */
export function themeCssVars(cfg: Partial<ThemeConfig>): Record<string, string> {
  const vars: Record<string, string> = {};
  const set = (name: string, v: unknown) => {
    if (typeof v === 'string' && v.trim() !== '') vars[name] = v;
  };
  set('--c-primary', cfg.primary);
  set('--c-secondary', cfg.secondary);
  set('--c-accent', cfg.accent ?? cfg.primary);
  set('--c-bg', cfg.background);
  set('--c-surface', cfg.surface);
  set('--c-text', cfg.text);
  set('--c-muted', cfg.muted);
  set('--radius', cfg.radius);
  if (cfg.fontHeading) vars['--font-heading'] = `'${cfg.fontHeading}', system-ui, sans-serif`;
  if (cfg.fontBody) vars['--font-body'] = `'${cfg.fontBody}', system-ui, sans-serif`;
  if (cfg.fontMono) vars['--font-mono'] = `'${cfg.fontMono}', ui-monospace, monospace`;
  if (cfg.primary) vars['--c-on-primary'] = readableOn(cfg.primary);
  return vars;
}

/** Google Fonts stylesheet URL for the theme's heading/body/mono fonts. */
export function googleFontsHref(cfg: Partial<ThemeConfig>): string | null {
  const fams = Array.from(new Set([cfg.fontHeading, cfg.fontBody, cfg.fontMono].filter(Boolean) as string[]));
  if (fams.length === 0) return null;
  const q = fams
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

/** Returns #000 or #fff depending on which has better contrast with hex (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return '#fff';
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.179 ? '#111' : '#fff';
}
