'use client';

// Distribution Manager (PRD §20 menu, §95 Distribution Health, §97 Issues, §87 bulk distribution).
import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { download, get, list, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import { DIST_STATUSES, type DistStatus, type Distribution, type Podcast } from '@/lib/types';
import {
  Badge, Button, Card, Checkbox, Empty, ErrorBox, LinkButton, Modal, PageHeader, Pager, Progress, Select, Spinner, Stat, Tabs, Textarea,
  fmtDate, useAction, useAsync,
} from '@/components/ui';
import { DistributionEditor, DistributionTable, HistoryModal, PlatformName, isIssue, statusLabel, usePlatforms, type EditMode } from '@/components/distribution/shared';

type TabKey = 'overview' | 'platforms' | 'podcasts' | 'pending' | 'submitted' | 'live' | 'failed' | 'issues';
const STATUS_TABS: Record<string, string> = { pending: 'PENDING', submitted: 'SUBMITTED', live: 'LIVE', failed: 'FAILED', issues: 'ISSUES' };
const TAB_KEYS: TabKey[] = ['overview', 'platforms', 'podcasts', 'pending', 'submitted', 'live', 'failed', 'issues'];

interface Overview {
  counts: Record<string, number>; tracked?: number; issues: number; health_percent: number; published_podcasts: number;
  platforms: { platform_id: number; key: string; name: string; color: string; live: number; pending: number; issues: number; total: number }[];
  recent_issues: Distribution[];
}

function tabFromQuery(sp: URLSearchParams): TabKey {
  const tab = sp.get('tab') as TabKey | null;
  if (tab && TAB_KEYS.includes(tab)) return tab;
  const st = (sp.get('status') || '').toUpperCase();
  if (st === 'ACTION_REQUIRED' || st === 'ISSUES') return 'issues';
  if (st === 'REJECTED' || st === 'FAILED') return 'failed';
  const hit = Object.entries(STATUS_TABS).find(([, v]) => v === st);
  return (hit?.[0] as TabKey) ?? 'overview';
}

function DistributionManager() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { can, scopeTenantId } = useAuth();
  const tq = useTenantQuery();
  const tab = tabFromQuery(new URLSearchParams(sp.toString()));
  const canManage = can('SUPER_ADMIN', 'TENANT_ADMIN');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { run, busy } = useAction();

  const setTab = (k: TabKey) => {
    const st = STATUS_TABS[k];
    router.replace(st ? `${pathname}?status=${st}` : k === 'overview' ? pathname : `${pathname}?tab=${k}`, { scroll: false });
  };

  return (
    <>
      <PageHeader title="Distribution" subtitle="Track every podcast on every listening platform"
        actions={<>
          <Button loading={busy} onClick={() => run(() => download('/exports/distribution', 'distribution.csv', tq), 'Export started')}>⇩ Export CSV</Button>
          {canManage && <Button variant="primary" onClick={() => setBulkOpen(true)}>Bulk distribution</Button>}
        </>} />
      <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview' }, { key: 'platforms', label: 'Platforms' }, { key: 'podcasts', label: 'Podcasts' },
        { key: 'pending', label: 'Pending' }, { key: 'submitted', label: 'Submitted' }, { key: 'live', label: 'Live' },
        { key: 'failed', label: 'Failed' }, { key: 'issues', label: 'Issues' },
      ]} />
      {tab === 'overview' && <OverviewTab key={`${scopeTenantId}-${refresh}`} onTab={setTab} />}
      {tab === 'platforms' && <PlatformsTab key={`${scopeTenantId}-${refresh}`} />}
      {tab === 'podcasts' && <PodcastsTab key={scopeTenantId ?? 'all'} />}
      {STATUS_TABS[tab] && <StatusTab key={`${tab}-${scopeTenantId}-${refresh}`} status={STATUS_TABS[tab]} canManage={canManage} />}
      {canManage && <BulkModal open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={() => setRefresh((n) => n + 1)} />}
    </>
  );
}

export default function DistributionPage() {
  return <Suspense fallback={<Spinner />}><DistributionManager /></Suspense>;
}

// ---------------------------------------------------------------- Overview
function OverviewTab({ onTab }: { onTab: (k: TabKey) => void }) {
  const tq = useTenantQuery();
  const { data, error, loading, reload } = useAsync(() => get<Overview>('/distribution/overview', tq), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const c = data.counts;
  const tracked = data.tracked ?? Object.values(c).reduce((a, b) => a + b, 0);
  const failed = (c.FAILED ?? 0) + (c.REJECTED ?? 0);
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Distribution Health">
          <p style={{ margin: '0 0 8px' }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-.02em' }}>{data.health_percent}%</span>{' '}
            <span className="muted">Healthy</span>
          </p>
          <Progress value={data.health_percent} label="Distribution health" />
          <p className="muted small" style={{ marginBottom: 0 }}>
            {tracked.toLocaleString()} tracked records across {data.published_podcasts} published podcast{data.published_podcasts === 1 ? '' : 's'} ·{' '}
            {data.issues > 0 ? <button type="button" className="link" onClick={() => onTab('issues')}>{data.issues} need attention</button> : 'no open issues'}
          </p>
        </Card>
        <Card title="Needs attention" actions={<button type="button" className="link" onClick={() => onTab('issues')}>All issues →</button>}>
          <p style={{ margin: '0 0 6px' }}><Badge status="ACTION_REQUIRED">{c.ACTION_REQUIRED ?? 0} Action Required</Badge></p>
          <p style={{ margin: 0 }}><Badge status="FAILED">{failed} Failed / Rejected</Badge></p>
        </Card>
      </div>

      <div className="grid-4">
        {DIST_STATUSES.map((s) => {
          const tabKey: TabKey | undefined = s === 'LIVE' ? 'live' : s === 'PENDING' ? 'pending' : s === 'SUBMITTED' ? 'submitted' : isIssue(s) ? (s === 'ACTION_REQUIRED' ? 'issues' : 'failed') : undefined;
          return <Stat key={s} label={statusLabel(s)} value={(c[s] ?? 0).toLocaleString()}
            href={tabKey ? (STATUS_TABS[tabKey] ? `/distribution?status=${STATUS_TABS[tabKey]}` : `/distribution?tab=${tabKey}`) : undefined} />;
        })}
      </div>

      <Card title="By platform" actions={<a href="/distribution?tab=platforms">Platforms →</a>}>
        {data.platforms.length === 0 ? <Empty>No distribution records yet.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Platform</th><th>Live</th><th>Pending</th><th>Issues</th><th>Total</th><th style={{ width: '30%' }}>Coverage</th></tr></thead>
              <tbody>
                {data.platforms.map((p) => {
                  const pct = p.total ? Math.round((p.live / p.total) * 100) : 0;
                  return (
                    <tr key={p.platform_id}>
                      <td><strong><PlatformName name={p.name} color={p.color} /></strong></td>
                      <td><strong>{p.live}</strong> <span className="muted small">LIVE</span></td>
                      <td>{p.pending}</td>
                      <td>{p.issues > 0 ? <a href={`/distribution?status=ISSUES`}><Badge status="ACTION_REQUIRED">{p.issues}</Badge></a> : <span className="muted">0</span>}</td>
                      <td>{p.total}</td>
                      <td><div className="row" style={{ flexWrap: 'nowrap' }}><div style={{ flex: 1 }}><Progress value={pct} label={`${p.name} coverage`} /></div><span className="small">{pct}%</span></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent issues">
        {data.recent_issues.length === 0 ? <p className="alert alert--success" style={{ margin: 0 }}>✓ No open distribution issues.</p> : (
          <ul className="checklist">
            {data.recent_issues.map((d) => (
              <li key={d.id}>
                <Badge status={d.status} />
                <span>
                  <a href={`/distribution/${d.podcast_id}`}><strong>{d.podcast_title}</strong></a> · <PlatformName name={d.platform_name} color={d.platform_color} />
                  {d.issue_reason && <> — <span>{d.issue_reason}</span></>} <small className="muted">{fmtDate(d.updated_at, true)}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Platforms tab
function PlatformsTab() {
  const { can } = useAuth();
  const { data, error, loading, reload } = usePlatforms(false);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <Card title={`Platform registry (${data?.length ?? 0})`} actions={<LinkButton href="/distribution/platforms" size="sm">{can('SUPER_ADMIN') ? 'Manage platforms →' : 'View registry →'}</LinkButton>}>
      {!data?.length ? <Empty>No platforms configured.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Platform</th><th>Type</th><th>Submit</th><th>Active</th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td><strong><PlatformName name={p.name} color={p.color} /></strong></td>
                  <td><Badge status={p.submission_type === 'API' ? 'READY' : 'NOT_STARTED'}>{p.submission_type}</Badge></td>
                  <td>{p.submit_url ? <a href={p.submit_url} target="_blank" rel="noopener noreferrer">Open →</a> : <span className="muted">—</span>}</td>
                  <td>{p.is_active ? <Badge status="ACTIVE" /> : <Badge status="DISABLED">Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Podcasts tab
interface PodcastDist { live: number; total: number; progress_percent: number; readiness: { percent: number } }

function PodcastRowStats({ id }: { id: number }) {
  const { data, error, loading } = useAsync(() => get<PodcastDist>(`/distribution/${id}`), [id]);
  if (loading) return <span className="muted small">…</span>;
  if (error || !data) return <span className="muted small">—</span>;
  return (
    <div style={{ minWidth: 160 }}>
      <div className="small"><strong>{data.live} / {data.total}</strong> live · {data.progress_percent}%</div>
      <Progress value={data.progress_percent} label="Platforms live" />
      <div className="small muted">Readiness {data.readiness?.percent ?? 0}%</div>
    </div>
  );
}

function PodcastsTab() {
  const tq = useTenantQuery();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useAsync(() => list<Podcast>('/podcasts', { ...tq, page, q: query, per_page: 20, sort: 'title' }), [page, query]);
  return (
    <Card>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q); }}>
        <label className="sr-only" htmlFor="dist-pod-q">Search podcasts</label>
        <input id="dist-pod-q" className="input" style={{ maxWidth: 320 }} placeholder="Search podcasts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.data.length ? <Empty>No podcasts found.</Empty> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Podcast</th><th>Status</th><th>Distribution</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        {p.artwork_url ? <img className="thumb" src={p.artwork_url} alt="" /> : <span className="thumb" aria-hidden="true" />}
                        <div><a className="cell-title" href={`/distribution/${p.id}`}>{p.title}</a><div className="small muted">{p.owner_tenant_name ?? 'Central library'} · {p.episode_count} episodes</div></div>
                      </div>
                    </td>
                    <td><Badge status={p.status} /></td>
                    <td><PodcastRowStats id={p.id} /></td>
                    <td><LinkButton size="sm" href={`/distribution/${p.id}`}>Manage →</LinkButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.meta.page} pages={data.meta.pages} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Status tabs
function StatusTab({ status, canManage }: { status: string; canManage: boolean }) {
  const tq = useTenantQuery();
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('');
  const platforms = usePlatforms(false);
  const { data, error, loading, reload } = useAsync(() => list<Distribution>('/distribution', { ...tq, status, platform, page, per_page: 25 }), [status, platform, page]);
  const [edit, setEdit] = useState<{ d: Distribution; m: EditMode } | null>(null);
  const [hist, setHist] = useState<Distribution | null>(null);
  const platformMap = useMemo(() => new Map((platforms.data ?? []).map((p) => [p.id, p])), [platforms.data]);
  const desc: Record<string, string> = {
    PENDING: 'Submitted and waiting for the platform to approve.', SUBMITTED: 'Submitted to the platform.', LIVE: 'Published and listenable on the platform.',
    FAILED: 'Failed or rejected submissions.', ISSUES: 'Action required, failed or rejected — needs an admin.',
  };
  return (
    <Card title={<>{statusLabel(status)} <span className="muted small">{data ? `(${data.meta.total})` : ''}</span></>}
      actions={
        <label className="row small">
          <span>Platform</span>
          <select className="input" style={{ width: 'auto' }} value={platform} onChange={(e) => { setPage(1); setPlatform(e.target.value); }}>
            <option value="">All platforms</option>
            {(platforms.data ?? []).map((p) => <option key={p.id} value={p.key}>{p.name}</option>)}
          </select>
        </label>
      }>
      <p className="muted small" style={{ marginTop: 0 }}>{desc[status]}</p>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.data.length ? <Empty>No distribution records with this status.</Empty> : (
        <>
          <DistributionTable items={data.data} canManage={canManage} onEdit={(d, m) => setEdit({ d, m })} onHistory={setHist} />
          <Pager page={data.meta.page} pages={data.meta.pages} onPage={setPage} />
        </>
      )}
      <DistributionEditor record={edit?.d ?? null} mode={edit?.m ?? 'update'} platform={edit ? platformMap.get(edit.d.platform_id) : undefined}
        onClose={() => setEdit(null)} onSaved={reload} />
      <HistoryModal record={hist} onClose={() => setHist(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------- Bulk distribution
function BulkModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Modal title="Bulk distribution" open={open} onClose={onClose} wide>
      <BulkBody onClose={onClose} onDone={onDone} />
    </Modal>
  );
}

function BulkBody({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const tq = useTenantQuery();
  const pods = useAsync(() => list<Podcast>('/podcasts', { ...tq, per_page: 100, sort: 'title' }), []);
  const plats = usePlatforms(true);
  const [podIds, setPodIds] = useState<Set<number>>(new Set());
  const [platIds, setPlatIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<DistStatus>('READY');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  const toggle = (set: Set<number>, id: number, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };
  const visible = (pods.data?.data ?? []).filter((p) => !filter || p.title.toLowerCase().includes(filter.toLowerCase()));
  const combos = podIds.size * platIds.size;

  const submit = async () => {
    const r = await run(() => post<{ updated: number }>('/distribution/bulk', { podcast_ids: [...podIds], platform_ids: [...platIds], status, note }));
    if (r) {
      window.alert(`${r.updated} distribution record(s) set to ${statusLabel(status)}.`);
      onDone();
      onClose();
    }
  };

  return (
    <div className="stack">
      <div className="grid-2">
        <div>
          <div className="row row--between"><strong>Podcasts ({podIds.size})</strong>
            <span className="row">
              <button type="button" className="link small" onClick={() => setPodIds(new Set(visible.map((p) => p.id)))}>Select all</button>
              <button type="button" className="link small" onClick={() => setPodIds(new Set())}>Clear</button>
            </span>
          </div>
          <label className="sr-only" htmlFor="bulk-filter">Filter podcasts</label>
          <input id="bulk-filter" className="input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ margin: '6px 0' }} />
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
            {pods.loading ? <Spinner /> : pods.error ? <ErrorBox error={pods.error} onRetry={pods.reload} /> : visible.length === 0 ? <p className="muted small">No podcasts.</p> :
              visible.map((p) => <Checkbox key={p.id} label={p.title} checked={podIds.has(p.id)} onChange={(v) => setPodIds((s) => toggle(s, p.id, v))} />)}
          </div>
          {pods.data && pods.data.meta.total > pods.data.data.length && <p className="hint">Showing the first {pods.data.data.length} of {pods.data.meta.total} podcasts.</p>}
        </div>
        <div>
          <div className="row row--between"><strong>Platforms ({platIds.size})</strong>
            <span className="row">
              <button type="button" className="link small" onClick={() => setPlatIds(new Set((plats.data ?? []).map((p) => p.id)))}>Select all</button>
              <button type="button" className="link small" onClick={() => setPlatIds(new Set())}>Clear</button>
            </span>
          </div>
          <div style={{ maxHeight: 316, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginTop: 6 }}>
            {plats.loading ? <Spinner /> : plats.error ? <ErrorBox error={plats.error} onRetry={plats.reload} /> :
              (plats.data ?? []).map((p) => <Checkbox key={p.id} label={p.name} checked={platIds.has(p.id)} onChange={(v) => setPlatIds((s) => toggle(s, p.id, v))} />)}
          </div>
        </div>
      </div>
      <div className="grid-2">
        <Select label="Set status to" value={status} onChange={(e) => setStatus(e.target.value as DistStatus)}
          options={DIST_STATUSES.filter((s) => s !== 'LIVE').map((s) => ({ value: s, label: statusLabel(s) }))}
          hint="LIVE can't be set in bulk — it needs an external URL per platform." />
        <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — recorded in each record's history" />
      </div>
      <div className="row row--between">
        <span className="muted small">{combos} combination{combos === 1 ? '' : 's'} will be updated.</span>
        <span className="row">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!combos} onClick={submit}>Apply to {combos}</Button>
        </span>
      </div>
    </div>
  );
}

