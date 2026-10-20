'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { post } from '@/lib/api';
import { Button, errMsg } from '@/components/ui';
import { BrandMark } from '@/components/icons';

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await post('/auth/reset-password', { token, new_password: password });
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <main className="login-split" style={{ justifyContent: 'center' }}>
        <div className="login-split__form-side" style={{ maxWidth: 440, margin: '0 auto' }}>
          <div className="login-split__card">
            <p>Missing reset token. Please use the link from the reset email or ask your administrator.</p>
            <p style={{ marginTop: 12 }}><a href="/forgot-password" className="link">Request a new link →</a></p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="login-split" style={{ justifyContent: 'center' }}>
      <div className="login-split__form-side" style={{ maxWidth: 440, margin: '0 auto' }}>
        <div className="login-split__card">
          <div className="login-split__card-head" style={{ textAlign: 'center' }}>
            <BrandMark size={40} />
            <h1>Set new password</h1>
          </div>
          {done ? (
            <div>
              <p>Your password has been reset successfully.</p>
              <p style={{ marginTop: 12 }}><a href="/login" className="link">Sign in with your new password →</a></p>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="pw">New password</label>
                <input id="pw" type="password" autoComplete="new-password" required minLength={8} placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pw2">Confirm password</label>
                <input id="pw2" type="password" autoComplete="new-password" required placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && <p className="alert alert--error" role="alert">{error}</p>}
              <Button type="submit" variant="primary" loading={busy} className="w100">Reset password</Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
