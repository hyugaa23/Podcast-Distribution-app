'use client';

import { useState } from 'react';
import { del, get, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Input, Modal, PageHeader, Spinner, fmtDate, useAction, useAsync } from '@/components/ui';
import { NoAccess, SecretOnce, TenantSelect } from '@/components/network/common';

interface ApiKey {
  id: number; tenant_id: number; tenant_name: string; name: string; prefix: string; permissions: string[];
  last_used_at: string | null; revoked_at: string | null; created_at: string;
}

function CreateKeyModal({ perms, onClose, onCreated }: { perms: string[]; onClose: () => void; onCreated: () => void }) {
  const { can, tenants, scopeTenantId } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string[]>(perms.filter((p) => p.startsWith('read:')));
  const [tid, setTid] = useState<number | ''>(scopeTenantId ?? '');
  const [key, setKey] = useState<string | null>(null);
  const valid = name.trim() && sel.length && (!isSuper || tid);

  const create = async () => {
    const r = await run(() => post<{ id: number; key: string; prefix: string }>('/api-keys', { name: name.trim(), permissions: sel, ...(isSuper ? { tenant_id: tid } : {}) }), 'API key created');
    if (r) { setKey(r.key); onCreated(); }
  };

  return (
    <Modal title={key ? 'API key created' : 'New API key'} open onClose={onClose}
      footer={key ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={create}>Create key</Button></>}>
      {key ? (
        <SecretOnce title="Your new API key" value={key}>
          <p className="small" style={{ margin: '10px 0 4px' }}>Send it with every request:</p>
          <pre className="code">{`curl -H "X-API-Key: ${key}" \\\n  ${typeof window !== 'undefined' ? window.location.origin : ''}/api/podcasts`}</pre>
        </SecretOnce>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (valid) create(); }}>
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mobile app, Zapier sync" />
          {isSuper && <TenantSelect tenants={tenants} value={tid} onChange={setTid} required />}
          <fieldset className="nw-fieldset">
            <legend>Permissions</legend>
            <div className="nw-checklist">
              {perms.map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={sel.includes(p)} onChange={(e) => setSel(e.target.checked ? [...sel, p] : sel.filter((x) => x !== p))} />
                  <span className="mono">{p}</span>
                </label>
              ))}
            </div>
            {!sel.length && <p className="field-error">Select at least one permission.</p>}
          </fieldset>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}

/** API keys (PRD §104). */
export default function ApiKeysPage() {
  const { can, scopeTenantId } = useAuth();
  const tq = useTenantQuery();
  const isSuper = can('SUPER_ADMIN');
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const { data, error, loading, reload } = useAsync(() => get<{ keys: ApiKey[]; available_permissions: string[] }>('/api-keys', tq), [scopeTenantId]);
  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="API keys" />;
  const keys = (data?.keys ?? []).filter((k) => showRevoked || !k.revoked_at);
  const revokedCount = (data?.keys ?? []).filter((k) => k.revoked_at).length;

  return (
    <>
      <PageHeader title="API keys" subtitle="Credentials for external integrations" actions={<Button variant="primary" disabled={!data} onClick={() => setOpen(true)}>+ New API key</Button>} />
      <Card className="nw-callout">
        <span className="small">Authenticate with the header <code className="mono">X-API-Key: pk_…</code> (or <code className="mono">Authorization: Bearer pk_…</code>). Keys are scoped to one website and only to the permissions you grant. The full key is shown once — store it in a secret manager.</span>
      </Card>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          {revokedCount > 0 && (
            <label className="check"><input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /><span>Show {revokedCount} revoked key{revokedCount === 1 ? '' : 's'}</span></label>
          )}
          {!keys.length ? <Empty>No API keys yet.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Key</th><th>Permissions</th>{isSuper && <th>Website</th>}<th>Last used</th><th>Created</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td className="cell-title">{k.name}</td>
                      <td className="mono">{k.prefix}…</td>
                      <td><div className="row" style={{ gap: 4 }}>{k.permissions.map((p) => <span key={p} className={`badge badge--${p.startsWith('write') ? 'amber' : 'blue'}`}>{p}</span>)}</div></td>
                      {isSuper && <td>{k.tenant_name}</td>}
                      <td className="small">{k.last_used_at ? fmtDate(k.last_used_at, true) : 'Never'}</td>
                      <td className="small">{fmtDate(k.created_at)}</td>
                      <td>{k.revoked_at ? <Badge status="REVOKED">Revoked {fmtDate(k.revoked_at)}</Badge> : <Badge status="ACTIVE" />}</td>
                      <td>{!k.revoked_at && (
                        <ConfirmButton size="sm" variant="danger" confirm={`Revoke "${k.name}"? Integrations using it will stop working immediately.`}
                          onConfirm={async () => { if ((await run(() => del(`/api-keys/${k.id}`), 'Key revoked')) !== undefined) reload(); }}>Revoke</ConfirmButton>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {open && data && <CreateKeyModal perms={data.available_permissions} onClose={() => setOpen(false)} onCreated={reload} />}
    </>
  );
}
