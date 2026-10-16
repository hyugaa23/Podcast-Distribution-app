'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Button, errMsg } from '@/components/ui';
import { BrandMark } from '@/components/icons';

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-split">
      <div className="login-split__hero">
        <div className="login-split__hero-content">
          <BrandMark size={56} />
          <h2>Podcast Engine</h2>
          <p>Kelola, distribusi, dan analisis podcast kamu dari satu dashboard.</p>
          <div className="login-split__features">
            <div className="login-split__feat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4" /><path d="M7.8 16.2a6 6 0 0 1 0-8.4" /></svg>
              <span>Distribusi ke 10+ platform</span>
            </div>
            <div className="login-split__feat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></svg>
              <span>Analytics real-time</span>
            </div>
            <div className="login-split__feat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /></svg>
              <span>RSS feed otomatis</span>
            </div>
          </div>
        </div>
        <div className="login-split__hero-decor">
          <div className="login-split__wave login-split__wave--1" />
          <div className="login-split__wave login-split__wave--2" />
          <div className="login-split__wave login-split__wave--3" />
        </div>
      </div>

      <div className="login-split__form-side">
        <form className="login-split__card" onSubmit={submit} aria-labelledby="login-title">
          <div className="login-split__card-head">
            <h1 id="login-title">Selamat datang</h1>
            <p>Masuk ke admin dashboard</p>
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" required placeholder="nama@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="login-split__pw-wrap">
              <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required placeholder="Masukkan password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="login-split__pw-toggle" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}>
                {showPw ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m2 2 20 20" /><path d="M6.7 6.7C4.3 8.3 2.7 10.8 2 12c1.7 3.3 5.3 7 10 7 2 0 3.8-.7 5.3-1.7" /><path d="M14 14.2a3 3 0 0 1-4.2-4.2" /><path d="M22 12c-.7-1.2-2.3-3.7-4.7-5.3" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12c1.7-3.3 5.3-7 10-7s8.3 3.7 10 7c-1.7 3.3-5.3 7-10 7s-8.3-3.7-10-7" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
          </div>

          {error && <p className="alert alert--error" role="alert">{error}</p>}

          <Button type="submit" variant="primary" loading={busy} className="w100">Masuk</Button>

          <p className="login-split__footer">Podcast Engine &copy; {new Date().getFullYear()}</p>
        </form>
      </div>
    </main>
  );
}
