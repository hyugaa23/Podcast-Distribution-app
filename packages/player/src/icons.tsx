import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true, focusable: false, ...p,
});

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.79-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" /></svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" /></svg>
);
export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...p })}>
    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fill="currentColor" stroke="none" fontWeight="700">15</text>
  </svg>
);
export const IconForward = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...p })}>
    <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /><text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fill="currentColor" stroke="none" fontWeight="700">30</text>
  </svg>
);
export const IconVolume = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...p })}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);
export const IconVolumeMute = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...p })}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" /><path d="m22 9-6 6" /><path d="m16 9 6 6" />
  </svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', ...p })}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconSpinner = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', ...p })}>
    <path d="M12 3a9 9 0 1 0 9 9" className="pe-spin" />
  </svg>
);
