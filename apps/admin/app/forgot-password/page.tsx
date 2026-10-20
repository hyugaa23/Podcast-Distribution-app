'use client';

import { useState, type FormEvent } from 'react';
import { post } from '@/lib/api';
import { Button, errMsg } from '@/components/ui';
import { BrandMark } from '@/components/icons';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-split" style={{ justifyContent: 'center' }}>
      <div className="login-split__form-side" style={{ maxWidth: 440, margin: '0 auto' }}>
        <div className="login-split__card">
          <div className="login-split__card-head" style={{ textAlign: 'center' }}>
            <BrandMark size={40} />
            <h1>Reset password</h1>
          </div>
          {sent ? (
            <div>
              <p>If an account exists for <strong>{email}</strong>, a reset link has been generated.</p>
              <p className="small muted" style={{ marginTop: 8 }}>Ask your administrator to find the reset link in System → Logs, or check the server output.</p>
              <p style={{ marginTop: 16 }}><a href="/login" className="link">← Back to sign in</a></p>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input id="email" type="email" autoComplete="username" required placeholder="name@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="alert alert--error" role="alert">{error}</p>}
              <Button type="submit" variant="primary" loading={busy} className="w100">Send reset link</Button>
              <p style={{ textAlign: 'center', marginTop: 12 }}><a href="/login" className="link small">← Back to sign in</a></p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
