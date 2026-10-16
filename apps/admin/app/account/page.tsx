'use client';

import { useState } from 'react';
import { get, post } from '@/lib/api';
import type { Tenant, User } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, Input, PageHeader, Spinner, fmtDate, useAction, useAsync } from '@/components/ui';
import { siteUrl } from '@/components/network/common';

const ROLE_TEXT: Record<string, string> = {
  SUPER_ADMIN: 'Full access to every website, domain, podcast and system setting.',
  TENANT_ADMIN: 'Manages one website: settings, branding, content, distribution and users.',
  EDITOR: 'Creates and publishes podcasts and episodes.',
  CREATOR: 'Manages the podcasts assigned to you.',
  VIEWER: 'Read-only access.',
};

/** My account: profile and password (PRD §70). */
export default function AccountPage() {
  const { data, error, loading, reload } = useAsync(() => get<{ user: User; tenant?: Tenant | null }>('/auth/me'), []);
  const { run, busy } = useAction();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const same = pw.length > 0 && pw === cur;
  const valid = cur.length > 0 && pw.length >= 8 && pw === pw2 && !same;

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { user, tenant } = data;

  return (
    <>
      <PageHeader title="My account" subtitle="Your profile and sign-in security" />
      <div className="grid-2">
        <Card title="Profile">
          <dl className="kv">
            <dt>Name</dt><dd>{user.name || '—'}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Role</dt><dd>{user.role.replace(/_/g, ' ')}<div className="small muted">{ROLE_TEXT[user.role]}</div></dd>
            <dt>Website</dt><dd>{tenant ? <>{tenant.name}{tenant.primary_domain && <> · <a href={siteUrl(tenant.primary_domain)} target="_blank" rel="noopener noreferrer">{tenant.primary_domain} ↗</a></>}</> : user.tenant_name ?? 'Whole network'}</dd>
            <dt>Status</dt><dd><Badge status={user.status} /></dd>
            <dt>Last login</dt><dd>{fmtDate(user.last_login_at, true)}</dd>
            <dt>Member since</dt><dd>{fmtDate(user.created_at)}</dd>
          </dl>
          <p className="hint" style={{ marginTop: 12 }}>To change your name, email or role, ask an administrator.</p>
        </Card>
        <Card title="Change password">
          {done && <p className="alert alert--success" role="status">Password changed. Other sessions may need to sign in again.</p>}
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            const r = await run(() => post('/auth/change-password', { current_password: cur, new_password: pw }), 'Password changed');
            if (r !== undefined) { setCur(''); setPw(''); setPw2(''); setDone(true); }
          }}>
            <input type="email" autoComplete="username" value={user.email} readOnly hidden />
            <Input label="Current password" type="password" required autoComplete="current-password" value={cur} onChange={(e) => { setCur(e.target.value); setDone(false); }} />
            <Input label="New password" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
              hint={tooShort ? <span style={{ color: 'var(--red)' }}>At least 8 characters ({pw.length}/8)</span> : same ? <span style={{ color: 'var(--red)' }}>Must differ from the current password</span> : 'At least 8 characters. A long passphrase is best.'} />
            <Input label="Confirm new password" type="password" required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              hint={mismatch ? <span style={{ color: 'var(--red)' }}>Passwords do not match</span> : undefined} />
            <Button type="submit" variant="primary" loading={busy} disabled={!valid}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
