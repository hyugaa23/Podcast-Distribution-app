'use client';

// Shared motion layer for every theme: scroll reveals with stagger, a navigation progress bar and
// View Transitions between pages. Pure progressive enhancement — without JS (or with
// prefers-reduced-motion) all content is simply visible.
import { useEffect } from 'react';

const REVEAL_SELECTOR = [
  'main section', 'main article', 'main header', 'main aside > *', 'main li', 'main figure',
  'main [class*="card"]', 'main [class*="tile"]', 'main [class*="poster"]', 'main [class*="__item"]',
  'main .pe-page__title', 'main .pe-page__lead', 'main .pe-transcript', 'main .pe-faq', 'main .pe-listen',
].join(',');

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Marks content below the fold and fades/slides it in when it enters the viewport. */
export function ScrollReveal({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (reducedMotion() || !('IntersectionObserver' in window)) return;
    const root = document.documentElement;
    root.setAttribute('data-motion', 'on');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute('data-revealed', '');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );
    const t = setTimeout(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR)).slice(0, 400);
      for (const el of els) {
        if (el.hasAttribute('data-reveal') || el.closest('[data-no-reveal]') || el.closest('dialog')) continue;
        // Nested reveal targets inside an already-revealing parent only stagger, they don't double-animate.
        const parentTarget = el.parentElement?.closest('[data-reveal]');
        el.setAttribute('data-reveal', parentTarget ? 'child' : '');
        const idx = Array.prototype.indexOf.call(el.parentElement?.children ?? [], el);
        el.style.setProperty('--reveal-i', String(Math.min(Math.max(idx, 0), 12)));
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
          // Above the fold: animate in immediately (entrance animation), no waiting for scroll.
          requestAnimationFrame(() => el.setAttribute('data-revealed', ''));
        } else {
          io.observe(el);
        }
      }
    }, 20);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, [pathname]);
  return null;
}

/** Thin top progress bar shown while a client-side navigation is in flight. */
export function startNavProgress() {
  if (typeof document === 'undefined') return;
  let bar = document.getElementById('pe-navbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pe-navbar';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
  }
  bar.className = 'is-loading';
  // Safety net: same-path navigations (query changes) or errors must not leave the bar hanging.
  clearTimeout((window as unknown as { __peNav?: number }).__peNav);
  (window as unknown as { __peNav?: number }).__peNav = window.setTimeout(endNavProgress, 6000);
}

export function endNavProgress() {
  const bar = typeof document !== 'undefined' ? document.getElementById('pe-navbar') : null;
  if (!bar) return;
  bar.className = 'is-done';
  setTimeout(() => { if (bar.className === 'is-done') bar.className = ''; }, 450);
}

/** Runs a DOM update inside a View Transition when supported (smooth cross-fade between pages). */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reducedMotion()) doc.startViewTransition(update);
  else update();
}
