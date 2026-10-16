'use client';

// RSS Health Monitor (PRD §96): reachable, XML valid, artwork, audio, required fields, GUID, SSL → Healthy / Warning / Critical.
import { Fragment, useEffect, useRef, useState } from 'react';
import { get, list, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { HealthCheck, Podcast } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Pager, Progress, Spinner, Stat, errMsg, fmtDate, useAsync, useToast } from '@/components/ui';

interface HealthResult { status: 'HEALTHY' | 'WARNING' | 'CRITICAL'; checks: HealthCheck[]; checked_at?: string; feed_url?: string }
type Entry = { state: 'loading' } | { state: 'none' } | { state: 'error'; error: string } | { state: 'ok'; r: HealthResult };

const LABEL: Record<string, string> = { HEALTHY: 'Healthy', WARNING: 'Warning', CRITICAL: 'Critical' };
const CHECK_TONE: Record<HealthCheck['status'], string> = { ok: 'OK', warning: 'WARNING', critical: 'ERROR' };
const CHECK_ICON: Record<HealthCheck['status'], string> = { ok: '✓', warning: '!', critical: '✗' };

function HealthBadge({ status }: { status: string }) {
  return <Badge status={status === 'CRITICAL' ? 'ERROR' : status}>{status === 'HEALTHY' ? '✓ ' : status === 'WARNING' ? '! ' : '✗ '}{LABEL[status] ?? status}</Badge>;
}

export default function RSSHealthPage() {
  const tq = useTenantQuery();
  const { scopeTenantId, can } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const pods = useAsync(() => list<Podcast>('/podcasts', { ...tq, page, per_page: 25, sort: 'title' }), [page, scopeTenantId]);
  const [health, setHealth] = useState<Record<number, Entry>>({});
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);
  const cancelRef = useRef(false);
  const canRun = can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR', 'CREATOR');

  useEffect(() => { setPage(1); }, [scopeTenantId]);

  // Load the latest stored check for each podcast on the page.
  useEffect(() => {
    const items = pods.data?.data ?? [];
    let alive = true;
    setHealth((h) => { const n = { ...h }; items.forEach((p) => { if (!n[p.id]) n[p.id] = { state: 'loading' }; }); return n; });
    (async () => {
      const queue = [...items];
      const worker = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const id = p.id;
          try {
            const r = await get<HealthResult[]>(`/podcasts/${id}/rss-health`);
            if (alive) setHealth((h) => ({ ...h, [id]: r?.length ? { state: 'ok', r: r[0] } : { state: 'none' } }));
          } catch (e) {
            if (alive) setHealth((h) => ({ ...h, [id]: { state: 'error', error: errMsg(e) } }));
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })();
    return () => { alive = false; };
  }, [pods.data]);

  const runCheck = async (id: number): Promise<boolean> => {
    setRunning((s) => new Set(s).add(id));
    try {
      const r = await post<HealthResult>(`/podcasts/${id}/rss-health`);
      setHealth((h) => ({ ...h, [id]: { state: 'ok', r: { ...r, checked_at: r.checked_at ?? new Date().toISOString() } } }));
      return true;
    } catch (e) {
      setHealth((h) => ({ ...h, [id]: { state: 'error', error: errMsg(e) } }));
      return false;
    } finally {
      setRunning((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const checkAll = async () => {
    cancelRef.current = false;
    // Collect every podcast in scope (not only the current page).
    let ids: number[] = [];
    try {
      for (let p = 1, pages = 1; p <= pages; p++) {
        const r = await list<Podcast>('/podcasts', { ...tq, page: p, per_page: 100 });
        ids = ids.concat(r.data.map((x) => x.id));
        pages = r.meta.pages;
      }
    } catch (e) { toast('error', errMsg(e)); return; }
    let failed = 0;
    setBulk({ done: 0, total: ids.length, failed: 0 });
    for (let i = 0; i < ids.length; i++) {
      if (cancelRef.current) break;
      if (!(await runCheck(ids[i]))) failed++;
      setBulk({ done: i + 1, total: ids.length, failed });
    }
    toast(failed ? 'error' : 'success', cancelRef.current ? 'Health check cancelled' : `Checked ${ids.length} feed(s)${failed ? `, ${failed} failed` : ''}`);
    setBulk(null);
  };

  const items = pods.data?.data ?? [];
  const counts = { HEALTHY: 0, WARNING: 0, CRITICAL: 0, none: 0 };
  items.forEach((p) => { const e = health[p.id]; if (e?.state === 'ok') counts[e.r.status]++; else if (e?.state === 'none') counts.none++; });

  return (
    <>
      <PageHeader title="RSS Health Monitor" subtitle="Feed reachability, XML validity, artwork, audio, required fields, GUIDs and SSL for every podcast"
        actions={canRun && (bulk
          ? <Button onClick={() => { cancelRef.current = true; }}>Cancel</Button>
          : <Button variant="primary" disabled={!items.length} onClick={checkAll}>Check all</Button>)} />

      {bulk && (
        <Card className="stack" title={`Checking feeds… ${bulk.done} / ${bulk.total}`}>
          <Progress value={bulk.total ? (bulk.done / bulk.total) * 100 : 0} label="Health check progress" />
          {bulk.failed > 0 && <p className="small" style={{ margin: 0, color: 'var(--red)' }}>{bulk.failed} check(s) failed to run</p>}
        </Card>
      )}

      <div className="grid-4" style={{ margin: '16px 0' }}>
        <Stat label="Healthy" value={counts.HEALTHY} hint="on this page" />
        <Stat label="Warning" value={counts.WARNING} hint="on this page" />
        <Stat label="Critical" value={counts.CRITICAL} hint="on this page" />
        <Stat label="Never checked" value={counts.none} hint="on this page" />
      </div>

      {pods.loading && !pods.data ? <Spinner /> : pods.error ? <ErrorBox error={pods.error} onRetry={pods.reload} /> : !items.length ? <Empty>No podcasts in this scope.</Empty> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th><span className="sr-only">Expand</span></th><th>Podcast</th><th>Health</th><th>Checks</th><th>Last checked</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {items.map((p) => {
                  const e = health[p.id];
                  const isOpen = open.has(p.id);
                  const checks = e?.state === 'ok' ? e.r.checks : [];
                  const bad = checks.filter((c) => c.status !== 'ok').length;
                  return (
                    <Fragment key={p.id}>
                      <tr>
                        <td>
                          <button type="button" className="icon-btn" aria-expanded={isOpen} aria-controls={`health-${p.id}`} aria-label={`${isOpen ? 'Hide' : 'Show'} checks for ${p.title}`}
                            disabled={e?.state !== 'ok'} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </td>
                        <td>
                          <a className="cell-title" href={`/distribution/${p.id}`}>{p.title}</a>
                          <div className="small muted">{p.owner_tenant_name ?? 'Central library'} · <Badge status={p.status} /></div>
                        </td>
                        <td>
                          {running.has(p.id) ? <Spinner label="Checking…" /> :
                            !e || e.state === 'loading' ? <span className="muted small">…</span> :
                            e.state === 'none' ? <Badge status="NONE">Not checked</Badge> :
                            e.state === 'error' ? <span className="small" style={{ color: 'var(--red)' }}>{e.error}</span> :
                            <HealthBadge status={e.r.status} />}
                        </td>
                        <td className="small">{e?.state === 'ok' ? (bad ? `${bad} of ${checks.length} need attention` : `All ${checks.length} passed`) : '—'}</td>
                        <td className="small">{e?.state === 'ok' ? fmtDate(e.r.checked_at, true) : '—'}</td>
                        <td>{canRun && <Button size="sm" loading={running.has(p.id)} disabled={!!bulk} onClick={async () => { if (await runCheck(p.id)) { setOpen((s) => new Set(s).add(p.id)); } }}>Run check</Button>}</td>
                      </tr>
                      {isOpen && e?.state === 'ok' && (
                        <tr id={`health-${p.id}`}>
                          <td />
                          <td colSpan={5}>
                            <ul className="checklist">
                              {e.r.checks.map((c) => (
                                <li key={c.key}>
                                  <Badge status={CHECK_TONE[c.status]}>{CHECK_ICON[c.status]} {c.status === 'ok' ? 'OK' : c.status === 'warning' ? 'Warning' : 'Critical'}</Badge>
                                  <span><strong>{c.label}</strong> — <span className="muted">{c.message}</span></span>
                                </li>
                              ))}
                            </ul>
                            {e.r.feed_url && <p className="small muted" style={{ marginBottom: 0 }}>Feed: <a href={e.r.feed_url} target="_blank" rel="noopener noreferrer" className="mono">{e.r.feed_url}</a></p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pods.data!.meta.page} pages={pods.data!.meta.pages} onPage={setPage} />
        </>
      )}
    </>
  );
}
