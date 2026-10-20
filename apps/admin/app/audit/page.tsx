'use client';

import { Fragment, useState } from 'react';
import { download, list } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import { Button, Empty, ErrorBox, PageHeader, Pager, Spinner, fmtDate, useAction, useAsync } from '@/components/ui';
import { NoAccess } from '@/components/network/common';

interface AuditEntry {
  id: number; user: string; action: string; resource_type: string; resource_id: string; tenant_id: number | null; tenant: string;
  ip: string; changes: unknown; created_at: string;
}

const ACTIONS = ['LOGIN', 'CHANGED_PASSWORD', 'CREATED_TENANT', 'UPDATED_TENANT', 'UPDATED_TENANT_SETTINGS', 'UPDATED_SEO', 'DELETED_TENANT',
  'ADDED_DOMAIN', 'UPDATED_DOMAIN', 'DELETED_DOMAIN', 'CREATED_USER', 'UPDATED_USER', 'DELETED_USER', 'CREATED_PODCAST', 'UPDATED_PODCAST',
  'PUBLISHED_PODCAST', 'UNPUBLISHED_PODCAST', 'DELETED_PODCAST', 'UPDATED_SYNDICATION', 'UPDATED_TENANT_OVERRIDE', 'CREATED_EPISODE', 'UPDATED_EPISODE',
  'PUBLISHED_EPISODE', 'UNPUBLISHED_EPISODE', 'SCHEDULED_EPISODE', 'DELETED_EPISODE', 'UPLOADED_AUDIO', 'UPDATED_DISTRIBUTION', 'SUBMITTED_DISTRIBUTION',
  'BULK_DISTRIBUTION', 'IMPORTED_RSS', 'CREATED_REDIRECT', 'DELETED_REDIRECT', 'CREATED_API_KEY', 'REVOKED_API_KEY', 'CREATED_WEBHOOK', 'DELETED_WEBHOOK',
  'UPDATED_SYSTEM_SETTINGS', 'RETRIED_JOB', 'EXPORTED_BACKUP'];
const RESOURCES = ['api_key', 'category', 'collection', 'domain', 'episode', 'host', 'job', 'platform', 'podcast', 'podcast_distribution', 'redirect',
  'rss_source', 'system', 'system_settings', 'tenant', 'user', 'webhook'];

function resourceHref(type: string, id: string): string | null {
  if (!id || id === '0') return null;
  switch (type) {
    case 'episode': return `/episodes/${id}`;
    case 'podcast': case 'podcast_distribution': return `/podcasts/${id}`;
    case 'tenant': return `/tenants/${id}`;
    case 'host': return `/hosts/${id}`;
    case 'domain': return '/domains';
    case 'user': return '/users';
    default: return null;
  }
}

function hasChanges(c: unknown) {
  return c != null && !(typeof c === 'object' && Object.keys(c as object).length === 0);
}

/** Audit log (PRD §78). */
export default function AuditPage() {
  const { can, scopeTenantId } = useAuth();
  const tq = useTenantQuery();
  const { run: runExport, busy: exporting } = useAction();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { data, error, loading, reload } = useAsync(
    () => list<AuditEntry>('/audit-logs', { ...tq, action, resource_type: resource, page, per_page: 50 }),
    [scopeTenantId, action, resource, page],
  );
  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="the audit log" />;
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what, where and when" actions={<>
        <Button loading={exporting} onClick={() => runExport(() => download('/exports/audit', 'audit.csv', tq), 'Audit log exported')}>⇩ Export CSV</Button>
        <Button onClick={reload} loading={loading && !!data}>Refresh</Button>
      </>} />
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setAction(draft.trim().toUpperCase()); setPage(1); }}>
        <label><span className="sr-only">Action</span>
          <input className="input" list="audit-actions" placeholder="Action, e.g. UPDATED_EPISODE" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 260 }} />
        </label>
        <datalist id="audit-actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        <label><span className="sr-only">Resource type</span>
          <select className="input" value={resource} onChange={(e) => { setResource(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
            <option value="">All resources</option>
            {RESOURCES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <Button type="submit">Filter</Button>
        {(action || resource) && <Button variant="ghost" onClick={() => { setAction(''); setDraft(''); setResource(''); setPage(1); }}>Clear</Button>}
        {data && <span className="small muted" style={{ marginLeft: 'auto' }}>{data.meta.total.toLocaleString()} entries</span>}
      </form>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.data.length ? <Empty>No audit entries{action || resource ? ' match these filters' : ''}.</Empty> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Resource</th><th>Tenant</th><th>IP</th><th>Changes</th></tr></thead>
              <tbody>
                {data.data.map((e) => {
                  const href = resourceHref(e.resource_type, e.resource_id);
                  const changes = hasChanges(e.changes);
                  return (
                    <Fragment key={e.id}>
                      <tr>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.created_at, true)}</td>
                        <td>{e.user || <span className="muted">system</span>}</td>
                        <td><button type="button" className="link mono" onClick={() => { setDraft(e.action); setAction(e.action); setPage(1); }} title="Filter by this action">{e.action}</button></td>
                        <td className="mono">{e.resource_type}{e.resource_id && <>_id: {href ? <a href={href}>{e.resource_id}</a> : e.resource_id}</>}</td>
                        <td>{e.tenant || <span className="muted">Network</span>}</td>
                        <td className="mono">{e.ip || '—'}</td>
                        <td>{changes ? (
                          <button type="button" className="link" aria-expanded={open.has(e.id)} onClick={() => toggle(e.id)}>{open.has(e.id) ? 'Hide ▴' : 'View ▾'}</button>
                        ) : <span className="muted">—</span>}</td>
                      </tr>
                      {changes && open.has(e.id) && (
                        <tr><td colSpan={7}><pre className="code" style={{ margin: 0 }}>{JSON.stringify(e.changes, null, 2)}</pre></td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={data.meta.page} pages={data.meta.pages} onPage={setPage} />
        </>
      )}
    </>
  );
}
