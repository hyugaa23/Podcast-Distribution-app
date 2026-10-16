'use client';

import { useMemo, useState } from 'react';
import { del, get, list, post, put, type Role } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Podcast, User } from '@/lib/types';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Input, Modal, PageHeader, Select, Spinner, fmtDate, useAction, useAsync } from '@/components/ui';
import { NoAccess, TenantSelect } from '@/components/network/common';

const ROLES: { value: Role; label: string; help: string }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', help: 'Owns the whole platform: every tenant, domain, podcast, distribution, system settings, storage, API and logs.' },
  { value: 'TENANT_ADMIN', label: 'Tenant Admin', help: 'Administers one website: settings, branding & theme, podcasts, episodes, distribution, analytics and its users. Cannot see other tenants.' },
  { value: 'EDITOR', label: 'Editor', help: 'Creates podcasts and episodes, edits metadata, uploads audio, drafts and publishes. Cannot change configuration.' },
  { value: 'CREATOR', label: 'Creator / Host', help: 'Manages only the podcasts assigned to them.' },
  { value: 'VIEWER', label: 'Viewer', help: 'Read-only access to content and analytics.' },
];
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

interface Form { id?: number; name: string; email: string; password: string; role: Role; tenant_id: number | ''; status: string; podcast_ids: number[] }

function UserModal({ initial, onClose, onSaved }: { initial: Form; onClose: () => void; onSaved: () => void }) {
  const { can, tenants, user: me } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const { run, busy } = useAction();
  const [f, setF] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const editing = !!f.id;
  const effTenant = isSuper ? f.tenant_id : me?.tenant_id ?? '';
  const pods = useAsync(
    () => (f.role === 'CREATOR' && effTenant ? list<Podcast>('/podcasts', { tenant_id: effTenant, per_page: 100, sort: 'title' }).then((r) => r.data.filter((p) => p.owner_tenant_id === effTenant)) : Promise.resolve([] as Podcast[])),
    [f.role, effTenant],
  );
  const roles = isSuper ? ROLES : ROLES.filter((r) => r.value !== 'SUPER_ADMIN');
  const needsTenant = f.role !== 'SUPER_ADMIN';
  const pwOk = editing ? !f.password || f.password.length >= 8 : f.password.length >= 8;
  const valid = f.email.includes('@') && pwOk && (!isSuper || !needsTenant || !!f.tenant_id);

  const save = async () => {
    const body: Record<string, unknown> = { name: f.name.trim(), email: f.email.trim(), role: f.role, status: f.status };
    if (f.password) body.password = f.password;
    if (isSuper) body.tenant_id = needsTenant ? f.tenant_id : null;
    if (f.role === 'CREATOR') body.podcast_ids = f.podcast_ids;
    const r = await run(() => (editing ? put(`/users/${f.id}`, body) : post('/users', body)), editing ? 'User updated' : 'User created');
    if (r !== undefined) { onSaved(); onClose(); }
  };

  return (
    <Modal title={editing ? `Edit ${initial.email}` : 'New user'} open onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>{editing ? 'Save' : 'Create user'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (valid) save(); }}>
        <Input label="Name" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
        <Input label="Email" type="email" required value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
        <Input label={editing ? 'New password' : 'Password'} type="password" required={!editing} value={f.password} minLength={8} autoComplete="new-password"
          onChange={(e) => set('password', e.target.value)} hint={editing ? 'Leave empty to keep the current password. Minimum 8 characters.' : 'Minimum 8 characters.'} />
        <div className="grid-2">
          <Select label="Role" value={f.role} onChange={(e) => set('role', e.target.value as Role)} options={roles.map((r) => ({ value: r.value, label: r.label }))}
            hint={ROLES.find((r) => r.value === f.role)?.help} />
          <Select label="Status" value={f.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]}
            disabled={editing && f.id === me?.id} hint={editing && f.id === me?.id ? 'You cannot disable your own account.' : undefined} />
        </div>
        {isSuper && needsTenant && (
          <TenantSelect tenants={tenants} value={f.tenant_id} onChange={(v) => setF((x) => ({ ...x, tenant_id: v, podcast_ids: [] }))} required />
        )}
        {f.role === 'CREATOR' && (
          <fieldset className="nw-fieldset">
            <legend>Assigned podcasts</legend>
            {!effTenant ? <p className="hint">Select a website first.</p> : pods.loading ? <Spinner /> : pods.error ? <ErrorBox error={pods.error} onRetry={pods.reload} /> :
              !pods.data?.length ? <p className="hint">This website does not own any podcasts yet.</p> : (
                <div className="nw-checklist">
                  {pods.data.map((p) => (
                    <label key={p.id} className="check">
                      <input type="checkbox" checked={f.podcast_ids.includes(p.id)}
                        onChange={(e) => set('podcast_ids', e.target.checked ? [...f.podcast_ids, p.id] : f.podcast_ids.filter((x) => x !== p.id))} />
                      <span>{p.title} <Badge status={p.status} /></span>
                    </label>
                  ))}
                </div>
              )}
            <p className="hint">Creators can only manage the podcasts selected here.</p>
          </fieldset>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Users & roles (PRD §5, §71). */
export default function UsersPage() {
  const { can, scopeTenantId, user: me } = useAuth();
  const tq = useTenantQuery();
  const isSuper = can('SUPER_ADMIN');
  const { run } = useAction();
  const { data, error, loading, reload } = useAsync(() => get<User[]>('/users', tq), [scopeTenantId]);
  const [edit, setEdit] = useState<Form | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((u) => (!role || u.role === role) && (!s || u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s) || (u.tenant_name ?? '').toLowerCase().includes(s)));
  }, [data, q, role]);

  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="users" />;
  const blank: Form = { name: '', email: '', password: '', role: 'EDITOR', tenant_id: scopeTenantId ?? '', status: 'ACTIVE', podcast_ids: [] };
  const canTouch = (u: User) => isSuper || u.role !== 'SUPER_ADMIN';

  return (
    <>
      <PageHeader title="Users" subtitle={isSuper ? 'Accounts across the network' : 'People who can access your website admin'}
        actions={<Button variant="primary" onClick={() => setEdit(blank)}>+ New user</Button>} />
      <div className="nw-split nw-split--narrow">
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <label className="nw-search"><span className="sr-only">Search users</span>
              <input className="input" type="search" placeholder="Search name, email or site…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label><span className="sr-only">Filter by role</span>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All roles</option>
                {ROLES.filter((r) => isSuper || r.value !== 'SUPER_ADMIN').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
          </div>
          {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !rows.length ? <Empty>{data?.length ? 'No users match.' : 'No users yet.'}</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>User</th><th>Role</th>{isSuper && <th>Website</th>}<th>Status</th><th>Last login</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td><span className="cell-title">{u.name || '—'}</span>{u.id === me?.id && <span className="badge badge--blue" style={{ marginLeft: 6 }}>You</span>}<div className="small muted">{u.email}</div></td>
                      <td>{roleLabel(u.role)}{u.role === 'CREATOR' && <div className="small muted">{u.podcast_ids.length} podcast{u.podcast_ids.length === 1 ? '' : 's'}</div>}</td>
                      {isSuper && <td>{u.tenant_id ? <a href={`/tenants/${u.tenant_id}`}>{u.tenant_name}</a> : <span className="muted">Network</span>}</td>}
                      <td><Badge status={u.status} /></td>
                      <td className="small">{fmtDate(u.last_login_at, true)}</td>
                      <td className="small">{fmtDate(u.created_at)}</td>
                      <td>
                        {canTouch(u) && (
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <Button size="sm" onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, password: '', role: u.role, tenant_id: u.tenant_id ?? '', status: u.status, podcast_ids: u.podcast_ids ?? [] })}>Edit</Button>
                            {u.id !== me?.id && (
                              <ConfirmButton size="sm" variant="danger" confirm={`Delete ${u.email}? This cannot be undone.`}
                                onConfirm={async () => { if ((await run(() => del(`/users/${u.id}`), 'User deleted')) !== undefined) reload(); }}>Delete</ConfirmButton>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Card title="Roles">
          <dl className="nw-roles">
            {ROLES.filter((r) => isSuper || r.value !== 'SUPER_ADMIN').map((r) => (<div key={r.value}><dt>{r.label}</dt><dd>{r.help}</dd></div>))}
          </dl>
          <p className="hint" style={{ marginTop: 10 }}>Permissions are always enforced by the server, not just hidden in the UI.</p>
        </Card>
      </div>
      {edit && <UserModal initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}
