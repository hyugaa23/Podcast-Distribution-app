// Line icon set for the admin (24px grid, 1.75 stroke, currentColor) — replaces emoji icons.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false, ...p,
});

export const Icons = {
  dashboard: (p: P) => <svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>,
  analytics: (p: P) => <svg {...base(p)}><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></svg>,
  podcasts: (p: P) => <svg {...base(p)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /><path d="M8 21h8" /></svg>,
  episodes: (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></svg>,
  hosts: (p: P) => <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18.5 14a6 6 0 0 1 3 6" /></svg>,
  collections: (p: P) => <svg {...base(p)}><path d="M4 6h16" /><path d="M6 3h12" /><rect x="3" y="9" width="18" height="12" rx="2" /></svg>,
  categories: (p: P) => <svg {...base(p)}><path d="M12 3 2 8l10 5 10-5z" /><path d="m2 13 10 5 10-5" /><path d="m2 18 10 5 10-5" opacity=".5" /></svg>,
  imports: (p: P) => <svg {...base(p)}><path d="M7 3v14" /><path d="m3 13 4 4 4-4" /><path d="M17 21V7" /><path d="m21 11-4-4-4 4" /></svg>,
  distribution: (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4" /><path d="M7.8 16.2a6 6 0 0 1 0-8.4" /><path d="M19 5a10 10 0 0 1 0 14" /><path d="M5 19A10 10 0 0 1 5 5" /></svg>,
  platforms: (p: P) => <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="M17.5 14v7" /><path d="M14 17.5h7" /></svg>,
  health: (p: P) => <svg {...base(p)}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg>,
  websites: (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></svg>,
  domains: (p: P) => <svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>,
  redirects: (p: P) => <svg {...base(p)}><path d="M4 12a8 8 0 0 1 13.6-5.7L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.6 5.7L4 15" /><path d="M4 20v-5h5" /></svg>,
  users: (p: P) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  keys: (p: P) => <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.7-8.7" /><path d="m16 7 3 3" /><path d="m14 9 2 2" /></svg>,
  webhooks: (p: P) => <svg {...base(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>,
  audit: (p: P) => <svg {...base(p)}><path d="M9 3h6l4 4v14H5V3z" /><path d="M14 3v5h5" /><path d="M8 13h8" /><path d="M8 17h5" /></svg>,
  system: (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  bell: (p: P) => <svg {...base(p)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>,
  menu: (p: P) => <svg {...base(p)}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>,
  globe: (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /></svg>,
  logout: (p: P) => <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>,
  account: (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.2 18.4a7 7 0 0 1 11.6 0" /></svg>,
};

export type IconName = keyof typeof Icons;

export function Icon({ name, ...p }: P & { name: IconName }) {
  const C = Icons[name];
  return <C {...p} />;
}

/** Brand mark: a waveform in a rounded square. */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" className="brandmark">
      <rect width="36" height="36" rx="10" fill="url(#bm)" />
      <defs><linearGradient id="bm" x1="0" y1="0" x2="36" y2="36"><stop stopColor="#4f7bff" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs>
      {[8, 13, 18, 23, 28].map((x, i) => (
        <rect key={x} x={x - 1.5} y={[13, 9, 6, 10, 14][i]} width="3" height={[10, 18, 24, 16, 8][i]} rx="1.5" fill="#fff" className="brandmark__bar" style={{ animationDelay: `${i * -0.18}s` }} />
      ))}
    </svg>
  );
}
