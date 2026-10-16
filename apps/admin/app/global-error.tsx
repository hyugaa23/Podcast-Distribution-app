'use client'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Admin global error:', error) }, [error])
  return (
    <html lang="en">
      <body>
        <div style={{ padding: '48px 24px', textAlign: 'center', maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', marginBottom: 16, fontSize: '.9rem' }}>
            {error.message || 'An unexpected error occurred.'}
            {error.digest && <span style={{ display: 'block', fontSize: '.78rem', marginTop: 4 }}>Error ID: {error.digest}</span>}
          </p>
          <button onClick={reset} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 500 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
