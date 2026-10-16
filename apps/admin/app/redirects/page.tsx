'use client';

import { useMemo, useState } from 'react';
import { del, get, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import { Button, Card, ConfirmButton, Empty, ErrorBox, Input, PageHeader, Select, Spinner, useAction, useAsync } from '@/components/ui';
import { NoAccess, TenantSelect, siteUrl } from '@/components/network/common';

interface Redirect { id: number; tenant_id: number | null; tenant_name: string; from_path: string; to_path: string; status_code: number; is_auto: boolean; hits: number; created_at: string }

const CODES = [
  { value: 301, label: '301 — Moved permanently' }, { value: 302, label: '302 — Found (temporary)' },
  { value: 307, label: '307 — Temporary, keep method' }, { value: 308, label: '308 — Permanent, keep method' },
];

/** Redirect manager (PRD §89). */
export default function RedirectsPage() {
  const { can, scopeTenantId, tenants } = useAuth();
  const tq = useTenantQuery();
  const isSuper = can('SUPER_ADMIN');
  const { run, busy } = useAction();
  const { data, error, loading, reload } = useAsync(() => get<Redirect[]>('/redirects', tq), [scopeTenantId]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [code, setCode] = useState(301);
  const [tid, setTid] = useState<number | ''>(scopeTenantId ?? '');
  const [q, setQ] = useState('');
  const [onlyManual, setOnlyManual] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((r) => (!onlyManual || !r.is_auto) && (!s || r.from_path.toLowerCase().includes(s) || r.to_path.toLowerCase().includes(s)));
  }, [data, q, onlyManual]);

  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="redirects" />;
  const fromOk = from.trim().startsWith('/') && from.trim() !== '/';
  const toOk = to.trim().startsWith('/') || /^https?:\/\/\S+\.\S+/.test(to.trim());
  const valid = fromOk && toOk && from.trim() !== to.trim();
  const hostFor = (r: Redirect) => tenants.find((t) => t.id === r.tenant_id)?.primary_domain;

  const add = async () => {
    const res = await run(() => post('/redirects', { from_path: from.trim(), to_path: to.trim(), status_code: code, ...(isSuper ? { tenant_id: tid || null } : {}) }), 'Redirect saved');
    if (res !== undefined) { setFrom(''); setTo(''); reload(); }
  };

  return (
    <>
      <PageHeader title="Redirects" subtitle="Keep old links working. Slug changes create 301 redirects automatically." />
      <Card title="Add redirect">
        <form onSubmit={(e) => { e.preventDefault(); if (valid) add(); }}>
          <div className={isSuper ? 'grid-4' : 'grid-3'}>
            <Input label="From path" required value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/old-url" hint={from && !fromOk ? 'Must start with / (not just /)' : 'Path on the website'} />
            <Input label="To path or URL" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="/new-url or https://…" hint={to && !toOk ? 'Use a /path or a full http(s) URL' : undefined} />
            <Select label="Status code" value={code} onChange={(e) => setCode(Number(e.target.value))} options={CODES} />
            {isSuper && <TenantSelect tenants={tenants} value={tid} onChange={setTid} allowAll allLabel="All sites" />}
          </div>
          <p className="hint" style={{ marginBottom: 10 }}>Adding a redirect for an existing “from” path on the same site replaces it.</p>
          <Button type="submit" variant="primary" loading={busy} disabled={!valid}>Add redirect</Button>
        </form>
      </Card>
      <div className="row" style={{ margin: '16px 0 12px' }}>
        <label className="nw-search"><span className="sr-only">Search redirects</span>
          <input className="input" type="search" placeholder="Search paths…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={onlyManual} onChange={(e) => setOnlyManual(e.target.checked)} /><span>Manual only</span></label>
        {data && <span className="small muted" style={{ marginLeft: 'auto' }}>{rows.length} of {data.length}</span>}
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !rows.length ? <Empty>{data?.length ? 'No redirects match.' : 'No redirects yet.'}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>From → To</th><th>Code</th><th>Type</th><th>Site</th><th>Hits</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const host = hostFor(r);
                const canDelete = isSuper || r.tenant_id !== null;
                return (
                  <tr key={r.id}>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {host ? <a href={siteUrl(host, r.from_path)} target="_blank" rel="noopener noreferrer">{r.from_path}</a> : r.from_path}
                      <span aria-label="redirects to"> → </span>{r.to_path}
                    </td>
                    <td><span className={`badge badge--${r.status_code === 301 || r.status_code === 308 ? 'blue' : 'purple'}`}>{r.status_code}</span></td>
                    <td>{r.is_auto ? <span className="badge badge--gray" title="Created automatically after a slug change">Auto</span> : <span className="small">Manual</span>}</td>
                    <td>{r.tenant_id ? r.tenant_name : <span className="muted">All sites</span>}</td>
                    <td>{r.hits.toLocaleString()}</td>
                    <td>{canDelete && (
                      <ConfirmButton size="sm" variant="danger" confirm={`Delete redirect ${r.from_path} → ${r.to_path}?`}
                        onConfirm={async () => { if ((await run(() => del(`/redirects/${r.id}`), 'Redirect deleted')) !== undefined) reload(); }}>Delete</ConfirmButton>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
