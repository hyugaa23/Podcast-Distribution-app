'use client';

// Domain management components (PRD §8) shared by /domains and the tenant "Domains" tab.
import { useState } from 'react';
import { del, post, put } from '@/lib/api';
import type { Domain, Tenant } from '@/lib/types';
import { Badge, Button, Card, Checkbox, Empty, Input, Modal, fmtDate, useAction } from '@/components/ui';
import { CopyButton, TenantSelect, siteUrl } from './common';

function isLocal(d: string) {
  return d === 'localhost' || d.endsWith('.localhost');
}

/** DNS + verification instructions for one domain. */
export function DomainInstructions({ d, cnameTarget, platformIps }: { d: Domain; cnameTarget?: string; platformIps?: string[] | null }) {
  const apex = d.domain.split('.').length === 2;
  const txtName = `_podcast-verify.${d.domain}`;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {isLocal(d.domain) && <p className="alert alert--info">Local development domain (*.localhost) — resolves automatically, no DNS needed.</p>}
      <div>
        <h3 className="nw-h3">1. Point DNS to the platform</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Type</th><th>Name</th><th>Value</th><th /></tr></thead>
            <tbody>
              {apex ? (
                (platformIps?.length ? platformIps : ['<platform IP address>']).map((ip) => (
                  <tr key={ip}><td>A</td><td className="mono">{d.domain} (@)</td><td className="mono">{ip}</td><td>{!ip.startsWith('<') && <CopyButton text={ip} />}</td></tr>
                ))
              ) : (
                <tr><td>CNAME</td><td className="mono">{d.domain}</td><td className="mono">{cnameTarget || '<platform hostname>'}</td><td>{cnameTarget && <CopyButton text={cnameTarget} />}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Root domains (podcast.com) use an <strong>A</strong> record (or ALIAS/ANAME); subdomains (www.podcast.com, sub.example.com) use a <strong>CNAME</strong>.
          {!cnameTarget && !platformIps?.length && ' The platform target is configured via PLATFORM_CNAME_TARGET / PLATFORM_IPS.'}
        </p>
      </div>
      <div>
        <h3 className="nw-h3">2. Prove ownership (either method)</h3>
        <p className="small" style={{ margin: '0 0 6px' }}><strong>DNS TXT record</strong></p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Type</th><th>Name</th><th>Value</th><th /></tr></thead>
            <tbody>
              <tr>
                <td>TXT</td><td className="mono">{txtName}</td><td className="mono">{d.verification_token}</td>
                <td><CopyButton text={d.verification_token} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small" style={{ margin: '10px 0 4px' }}><strong>or HTTP file</strong> — once DNS points to the platform it automatically serves the token at:</p>
        <code className="mono nw-secret">http://{d.domain}/.well-known/podcast-verify.txt</code>
      </div>
      <p className="hint">3. Click <strong>Verify</strong>. Verification, DNS and SSL are also re-checked automatically every few hours. SSL certificates are issued once DNS resolves.</p>
    </div>
  );
}

export function DomainsTable({ domains, tenants, isSuper, showTenant = true, reload, cnameTarget, platformIps }: {
  domains: Domain[]; tenants: Tenant[]; isSuper: boolean; showTenant?: boolean; reload: () => void; cnameTarget?: string; platformIps?: string[] | null;
}) {
  const { run } = useAction();
  const [help, setHelp] = useState<Domain | null>(null);
  const [assign, setAssign] = useState<Domain | null>(null);
  const [assignTo, setAssignTo] = useState<number | ''>('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const act = async (d: Domain, fn: () => Promise<unknown>, msg: string) => {
    setBusyId(d.id);
    const r = await run(fn, msg);
    setBusyId(null);
    if (r !== undefined) reload();
  };

  if (domains.length === 0) return <Empty>No domains yet.</Empty>;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Domain</th>{showTenant && <th>Site</th>}<th>Primary</th><th>Redirect → primary</th><th>Status</th><th>Verification</th>
              <th>DNS</th><th>SSL</th><th>Last checked</th><th>Last error</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id}>
                <td>
                  <a className="cell-title" href={siteUrl(d.domain)} target="_blank" rel="noopener noreferrer">{d.domain} ↗</a>
                  <div className="small muted">Added {fmtDate(d.created_at)}</div>
                </td>
                {showTenant && <td><a href={`/tenants/${d.tenant_id}`}>{d.tenant_name}</a></td>}
                <td>{d.is_primary ? <span className="badge badge--blue">★ Primary</span> : isSuper ? (
                  <Button size="sm" variant="ghost" disabled={busyId === d.id} onClick={() => act(d, () => put(`/domains/${d.id}`, { is_primary: true }), `${d.domain} is now primary`)}>Make primary</Button>
                ) : <span className="muted">—</span>}</td>
                <td>
                  {isSuper && !d.is_primary ? (
                    <label className="check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={d.redirect_to_primary} disabled={busyId === d.id}
                        onChange={(e) => act(d, () => put(`/domains/${d.id}`, { redirect_to_primary: e.target.checked }), 'Redirect updated')} />
                      <span className="sr-only">Redirect {d.domain} to primary</span>
                      <span>{d.redirect_to_primary ? '301 →' : 'Off'}</span>
                    </label>
                  ) : d.redirect_to_primary ? '301 →' : <span className="muted">—</span>}
                </td>
                <td><Badge status={d.status} /></td>
                <td><Badge status={d.verification_status} />{d.verified_at && <div className="small muted">{fmtDate(d.verified_at)}</div>}</td>
                <td><Badge status={d.dns_status} /></td>
                <td><Badge status={d.ssl_status} /></td>
                <td className="small">{fmtDate(d.last_checked_at, true)}</td>
                <td className="small" style={{ maxWidth: 220 }}>{d.last_error ? <span style={{ color: 'var(--red)' }}>{d.last_error}</span> : <span className="muted">—</span>}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Button size="sm" loading={busyId === d.id} onClick={() => act(d, () => post(`/domains/${d.id}/verify`), `Checked ${d.domain}`)}>Verify</Button>
                    <Button size="sm" variant="ghost" onClick={() => setHelp(d)}>Setup</Button>
                    {isSuper && (
                      <details className="nw-menu">
                        <summary className="btn btn--sm btn--ghost" aria-label={`More actions for ${d.domain}`}>⋯</summary>
                        <div className="nw-menu__panel">
                          {d.verification_status !== 'VERIFIED' && (
                            <button type="button" onClick={() => window.confirm(`Mark ${d.domain} as verified without a DNS check?`) && act(d, () => put(`/domains/${d.id}`, { verification_status: 'VERIFIED' }), 'Marked as verified')}>Mark verified</button>
                          )}
                          <button type="button" onClick={() => act(d, () => put(`/domains/${d.id}`, { status: d.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }), d.status === 'ACTIVE' ? 'Domain disabled' : 'Domain activated')}>
                            {d.status === 'ACTIVE' ? 'Disable' : 'Activate'}
                          </button>
                          <button type="button" onClick={() => { setAssign(d); setAssignTo(d.tenant_id); }}>Assign to site…</button>
                          <button type="button" className="danger" onClick={() => window.confirm(`Delete domain ${d.domain}? Visitors will no longer reach the site through it.`) && act(d, () => del(`/domains/${d.id}`), 'Domain deleted')}>Delete</button>
                        </div>
                      </details>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title={help ? `Set up ${help.domain}` : 'Domain setup'} open={!!help} onClose={() => setHelp(null)} wide>
        {help && <DomainInstructions d={help} cnameTarget={cnameTarget} platformIps={platformIps} />}
      </Modal>

      <Modal title={assign ? `Assign ${assign.domain}` : 'Assign domain'} open={!!assign} onClose={() => setAssign(null)}
        footer={<>
          <Button onClick={() => setAssign(null)}>Cancel</Button>
          <Button variant="primary" disabled={!assignTo || assignTo === assign?.tenant_id} onClick={async () => {
            if (!assign || !assignTo) return;
            const d = assign;
            setAssign(null);
            await act(d, () => put(`/domains/${d.id}`, { tenant_id: assignTo }), 'Domain reassigned');
          }}>Assign</Button>
        </>}>
        <TenantSelect tenants={tenants} value={assignTo} onChange={setAssignTo} label="Website" required />
        <p className="hint">Moving a domain makes it a non-primary domain of the new site.</p>
      </Modal>
    </>
  );
}

/** Add-domain form (super admin). If tenantId is given the site select is hidden. */
export function AddDomainForm({ tenants, tenantId, onAdded }: { tenants: Tenant[]; tenantId?: number; onAdded: () => void }) {
  const { run, busy } = useAction();
  const [tid, setTid] = useState<number | ''>(tenantId ?? '');
  const [domain, setDomain] = useState('');
  const [primary, setPrimary] = useState(false);
  const [redirect, setRedirect] = useState(false);
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const valid = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(clean);
  return (
    <Card title="Add domain">
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!tid || !valid) return;
        const r = await run(() => post('/domains', { tenant_id: tid, domain: clean, is_primary: primary, redirect_to_primary: redirect }), `${clean} added`);
        if (r !== undefined) { setDomain(''); setPrimary(false); setRedirect(false); onAdded(); }
      }}>
        <div className="grid-2">
          {tenantId === undefined && <TenantSelect tenants={tenants} value={tid} onChange={setTid} required />}
          <Input label="Domain" required value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="podcast.com, www.podcast.com or sub.example.com"
            hint={domain && !valid ? 'Enter a hostname without path, e.g. podcast.com' : 'Without http:// — the platform handles both www and subdomains.'} />
        </div>
        <div className="row">
          <Checkbox label="Primary domain" hint="canonical host for the site" checked={primary} onChange={(v) => { setPrimary(v); if (v) setRedirect(false); }} />
          {!primary && <Checkbox label="Redirect to primary" hint="301 to the primary domain" checked={redirect} onChange={setRedirect} />}
        </div>
        <Button type="submit" variant="primary" loading={busy} disabled={!tid || !valid}>Add domain</Button>
      </form>
    </Card>
  );
}
