'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="pe-wrap pe-page" style={{ textAlign: 'center' }}>
      <h1 className="pe-page__title">Something went wrong</h1>
      <p className="pe-page__lead" style={{ marginInline: 'auto' }}>We couldn’t load this page. Please try again.</p>
      <button type="button" onClick={reset}>Retry</button>
    </div>
  );
}
