'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <main style={{ textAlign: 'center' }}>
          <h1>Site temporarily unavailable</h1>
          <button type="button" onClick={reset}>Retry</button>
        </main>
      </body>
    </html>
  );
}
