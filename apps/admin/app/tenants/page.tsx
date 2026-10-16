'use client';

import { useState } from 'react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Tenant } from '@/lib/types';
import { Badge, Empty, ErrorBox, LinkButton, PageHeader, Spinner, fmtDate, useAsync } from '@/components/ui';
import { CONTENT_MODES, NoAccess, siteUrl } from '@/components/network/common';

/** Websites (tenants) list. */
export default function TenantsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useAsync(() => get<Tenant[]>('/tenants', { q: query }), [query]);
  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="websites" />;
  const isSuper = can('SUPER_ADMIN');

  return (
    <>
      <PageHeader title="Websites" subtitle={isSuper ? 'Every tenant website in the network' : 'Your website'}
        actions={isSuper && <LinkButton href="/tenants/new" variant="primary">+ New website</LinkButton>} />
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} role="search">
        <label className="nw-search"><span className="sr-only">Search websites</span>
          <input className="input" type="search" placeholder="Search by name or slug…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" className="btn">Search</button>
        {query && <button type="button" className="btn btn--ghost" onClick={() => { setQ(''); setQuery(''); }}>Clear</button>}
      </form>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.length ? (
        <Empty>{query ? 'No websites match your search.' : <>No websites yet. {isSuper && <a href="/tenants/new">Create the first one →</a>}</>}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Website</th><th>Primary domain</th><th>Theme</th><th>Content mode</th><th>Status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td><a className="cell-title" href={`/tenants/${t.id}`}>{t.name}</a><div className="small muted mono">{t.slug}</div></td>
                  <td>{t.primary_domain ? <a href={siteUrl(t.primary_domain)} target="_blank" rel="noopener noreferrer">{siteUrl(t.primary_domain)} ↗</a> : <span className="muted">No domain</span>}</td>
                  <td>{t.theme_name}</td>
                  <td>{CONTENT_MODES.find((m) => m.value === t.content_mode)?.label ?? t.content_mode}</td>
                  <td><Badge status={t.status} /></td>
                  <td>{fmtDate(t.created_at)}</td>
                  <td><LinkButton href={`/tenants/${t.id}`} size="sm">Manage</LinkButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
