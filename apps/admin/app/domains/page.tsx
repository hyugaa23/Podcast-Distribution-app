'use client';

import { useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Domain } from '@/lib/types';
import { Card, ErrorBox, PageHeader, Spinner, useAsync } from '@/components/ui';
import { AddDomainForm, DomainsTable } from '@/components/network/domains';
import { NoAccess } from '@/components/network/common';

interface Env { platform_cname_target?: string; platform_ips?: string[] | null }

/** Domain management (PRD §8). */
export default function DomainsPage() {
  const { can, tenants, scopeTenantId } = useAuth();
  const tq = useTenantQuery();
  const isSuper = can('SUPER_ADMIN');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useAsync(() => get<Domain[]>('/domains', tq), [scopeTenantId]);
  const env = useAsync(() => (isSuper ? get<{ environment: Env }>('/system/settings').then((s) => s.environment) : Promise.resolve({} as Env)), [isSuper]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((d) => !s || d.domain.includes(s) || d.tenant_name.toLowerCase().includes(s));
  }, [data, q]);

  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="domains" />;
  const counts = (data ?? []).reduce((a, d) => {
    if (d.verification_status !== 'VERIFIED') a.unverified++;
    if (d.status !== 'ACTIVE') a.disabled++;
    if (d.last_error) a.errors++;
    return a;
  }, { unverified: 0, disabled: 0, errors: 0 });

  return (
    <>
      <PageHeader title="Domains" subtitle="Connect domains to websites, verify ownership and monitor DNS & SSL" />
      {isSuper && <div style={{ marginBottom: 16 }}><AddDomainForm tenants={tenants} tenantId={scopeTenantId ?? undefined} onAdded={reload} /></div>}
      <Card title={`All domains${data ? ` (${data.length})` : ''}`} actions={
        <label className="nw-search"><span className="sr-only">Search domains</span>
          <input className="input" type="search" placeholder="Search domain or site…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>}>
        {data && (counts.unverified + counts.errors > 0) && (
          <p className="alert alert--warn">{counts.unverified} unverified · {counts.errors} with errors · {counts.disabled} disabled</p>
        )}
        {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
          <DomainsTable domains={rows} tenants={tenants} isSuper={isSuper} reload={reload}
            cnameTarget={env.data?.platform_cname_target} platformIps={env.data?.platform_ips} />
        )}
        {!isSuper && <p className="hint" style={{ marginTop: 10 }}>Contact a super admin to add, move or remove domains.</p>}
      </Card>
    </>
  );
}
