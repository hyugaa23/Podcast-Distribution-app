'use client';

// System tabs — super admin only.
import { Fragment, useEffect, useState } from 'react';
import { download, get, post, put } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Spinner, Stat, fmtBytes, fmtDate, useAction, useAsync } from '@/components/ui';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const KEY_TITLES: Record<string, string> = {
  storage: 'Storage', cdn: 'CDN', email: 'Email', queue: 'Queue', analytics: 'Analytics', audio_processing: 'Audio processing',
  themes: 'Themes', domains: 'Domains', security: 'Security', api: 'API', cron: 'Cron / schedules',
};
const human = (k: string) => k.replace(/_/g, ' ').replace(/\b(mb|gb|kbps|ttl|api|url|cdn)\b/gi, (m) => m.toUpperCase()).replace(/^./, (c) => c.toUpperCase());

function SettingCard({ k, value, onSaved }: { k: string; value: Record<string, Json>; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [v, setV] = useState<Record<string, Json>>(value);
  // Arrays are edited as comma-separated text; keep the raw text while typing.
  const [arrText, setArrText] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(value).filter(([, x]) => Array.isArray(x)).map(([f, x]) => [f, (x as Json[]).join(', ')])));
  const dirty = JSON.stringify(v) !== JSON.stringify(value);

  const save = async () => {
    const out: Record<string, Json> = { ...v };
    for (const [f, txt] of Object.entries(arrText)) {
      const orig = value[f] as Json[];
      const numeric = orig.length > 0 && orig.every((x) => typeof x === 'number');
      const parts = txt.split(',').map((s) => s.trim()).filter(Boolean);
      out[f] = numeric ? parts.map(Number).filter((n) => !Number.isNaN(n)) : parts;
    }
    const r = await run(() => put(`/system/settings/${k}`, out), `${KEY_TITLES[k] ?? k} settings saved`);
    if (r !== undefined) onSaved();
  };
  const arrDirty = Object.entries(arrText).some(([f, t]) => t !== (value[f] as Json[]).join(', '));

  return (
    <Card title={KEY_TITLES[k] ?? human(k)} actions={<span className="mono small muted">{k}</span>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        {Object.keys(v).length === 0 && <p className="muted small">No settings.</p>}
        {Object.entries(v).map(([f, x]) => {
          const id = `sys-${k}-${f}`;
          if (typeof x === 'boolean') {
            return (
              <label key={f} className="check"><input type="checkbox" checked={x} onChange={(e) => setV({ ...v, [f]: e.target.checked })} /><span>{human(f)}</span></label>
            );
          }
          return (
            <div className="field" key={f}>
              <label htmlFor={id}>{human(f)}</label>
              {typeof x === 'number' ? (
                <input id={id} type="number" value={Number.isFinite(x) ? x : ''} onChange={(e) => setV({ ...v, [f]: e.target.value === '' ? 0 : Number(e.target.value) })} />
              ) : Array.isArray(x) ? (
                <>
                  <input id={id} value={arrText[f] ?? ''} onChange={(e) => setArrText({ ...arrText, [f]: e.target.value })} />
                  <p className="hint">Comma-separated list</p>
                </>
              ) : x !== null && typeof x === 'object' ? (
                <textarea id={id} rows={3} className="mono" defaultValue={JSON.stringify(x, null, 2)} onBlur={(e) => { try { setV({ ...v, [f]: JSON.parse(e.target.value) }); } catch { /* keep previous */ } }} />
              ) : (
                <input id={id} value={x ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
              )}
            </div>
          );
        })}
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!dirty && !arrDirty}>Save</Button>
      </form>
    </Card>
  );
}

export function SettingsTab() {
  const { data, error, loading, reload } = useAsync(() => get<{ settings: Record<string, Record<string, Json>>; keys: string[]; environment: Record<string, Json> }>('/system/settings'), []);
  const [ver, setVer] = useState(0);
  useEffect(() => setVer((x) => x + 1), [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="stack">
      <div className="nw-masonry">
        {data.keys.map((k) => <SettingCard key={`${k}-${ver}`} k={k} value={data.settings[k] ?? {}} onSaved={reload} />)}
      </div>
      <Card title="Environment" actions={<span className="small muted">read-only · set via environment variables</span>}>
        <dl className="kv">
          {Object.entries(data.environment).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="mono">{k}</dt>
              <dd>{typeof v === 'boolean' ? (v ? <span className="badge badge--green">yes</span> : <span className="badge badge--gray">no</span>)
                : v === null || v === '' ? <span className="muted">not set</span> : <span className="mono">{Array.isArray(v) ? v.join(', ') : String(v)}</span>}</dd>
            </Fragment>
          ))}
        </dl>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- jobs
interface Job { id: string; type: string; payload: unknown; status: string; attempts: number; error: string; tenant_id: number | null; created_at: string; started_at: string | null; finished_at: string | null }
interface Queue { ready: number; delayed: number; processing: number }

export function JobsTab() {
  const [status, setStatus] = useState('');
  const [auto, setAuto] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const { run } = useAction();
  const { data, error, loading, reload } = useAsync(() => get<{ jobs: Job[]; queue: Queue }>('/system/jobs', { status }), [status]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, status]);
  const q = data?.queue;
  return (
    <div className="stack">
      <div className="grid-3">
        <Stat label="Ready" value={q?.ready ?? '—'} />
        <Stat label="Delayed" value={q?.delayed ?? '—'} />
        <Stat label="Processing" value={q?.processing ?? '—'} />
      </div>
      <div className="row">
        <label><span className="sr-only">Filter by status</span>
          <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>Auto-refresh every 5s</span></label>
        <Button size="sm" onClick={reload} loading={loading && !!data}>Refresh</Button>
        <span className="small muted" style={{ marginLeft: 'auto' }}>Latest 200 jobs</span>
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.jobs.length ? <Empty>No jobs{status ? ` with status ${status}` : ''}.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Type</th><th>Status</th><th>Attempts</th><th>Error</th><th>Created</th><th>Started</th><th>Finished</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.jobs.map((j) => (
                <Fragment key={j.id}>
                  <tr>
                    <td><button type="button" className="link mono" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)}>{j.type}</button></td>
                    <td><Badge status={j.status} /></td>
                    <td>{j.attempts}</td>
                    <td className="small" style={{ maxWidth: 320, color: j.error ? 'var(--red)' : undefined }}>{j.error || <span className="muted">—</span>}</td>
                    <td className="small">{fmtDate(j.created_at, true)}</td>
                    <td className="small">{fmtDate(j.started_at, true)}</td>
                    <td className="small">{fmtDate(j.finished_at, true)}</td>
                    <td>{j.status === 'FAILED' && (
                      <Button size="sm" onClick={async () => { if ((await run(() => post(`/system/jobs/${j.id}/retry`), 'Job re-queued')) !== undefined) reload(); }}>Retry</Button>
                    )}</td>
                  </tr>
                  {open === j.id && <tr><td colSpan={8}><p className="small muted mono" style={{ margin: '0 0 6px' }}>{j.id}</p><pre className="code" style={{ margin: 0 }}>{JSON.stringify(j.payload, null, 2)}</pre></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- logs
interface Log { id: number; level: string; source: string; message: string; detail: string; tenant_id: number | null; resolved: boolean; created_at: string }
const LEVEL_STATUS: Record<string, string> = { error: 'error', warn: 'warning', warning: 'warning', info: 'info', critical: 'critical', debug: 'DRAFT' };

export function LogsTab() {
  const [level, setLevel] = useState('');
  const [unresolved, setUnresolved] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { run } = useAction();
  const { data, error, loading, reload, setData } = useAsync(() => get<Log[]>('/system/logs', { level, unresolved: unresolved ? 1 : undefined }), [level, unresolved]);
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const resolve = async (l: Log) => {
    const r = await run(() => post(`/system/logs/${l.id}/resolve`), 'Marked resolved');
    if (r !== undefined && data) setData(unresolved ? data.filter((x) => x.id !== l.id) : data.map((x) => (x.id === l.id ? { ...x, resolved: true } : x)));
  };
  return (
    <div className="stack">
      <div className="row">
        <label><span className="sr-only">Level</span>
          <select className="input" style={{ width: 'auto' }} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All levels</option>
            {['critical', 'error', 'warning', 'info'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={unresolved} onChange={(e) => setUnresolved(e.target.checked)} /><span>Unresolved only</span></label>
        <Button size="sm" onClick={reload}>Refresh</Button>
        {data && <span className="small muted" style={{ marginLeft: 'auto' }}>{data.length} entries</span>}
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.length ? <Empty>{unresolved ? '✓ No unresolved log entries.' : 'No log entries.'}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Level</th><th>Source</th><th>Message</th><th>Time</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <td><Badge status={LEVEL_STATUS[l.level] ?? l.level}>{l.level}</Badge></td>
                    <td className="mono">{l.source}</td>
                    <td>
                      {l.detail ? <button type="button" className="link" style={{ textAlign: 'left', color: 'var(--text)' }} aria-expanded={open.has(l.id)} onClick={() => toggle(l.id)}>{l.message} <span className="muted">{open.has(l.id) ? '▴' : '▾'}</span></button> : l.message}
                    </td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.created_at, true)}</td>
                    <td>{l.resolved ? <Badge status="OK">Resolved</Badge> : <Badge status="PENDING">Open</Badge>}</td>
                    <td>{!l.resolved && <Button size="sm" onClick={() => resolve(l)}>Resolve</Button>}</td>
                  </tr>
                  {open.has(l.id) && <tr><td colSpan={6}><pre className="code" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{l.detail}</pre></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- metrics
interface Metrics {
  uptime_seconds: number; api: { route: string; count: number; errors: number; avg_ms: number; max_ms: number; under_200ms: number; under_500ms: number }[];
  queue: Queue; jobs_24h: Record<string, number>; storage: Record<string, number>; runtime: Record<string, number>; db_pool: Record<string, number>;
}
function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export function MetricsTab() {
  const { data, error, loading, reload } = useAsync(() => get<Metrics>('/system/metrics'), []);
  const [sort, setSort] = useState<'count' | 'avg_ms' | 'max_ms' | 'errors'>('count');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const st = data.storage ?? {};
  const api = [...(data.api ?? [])].sort((a, b) => b[sort] - a[sort]);
  const totals = api.reduce((a, r) => ({ count: a.count + r.count, errors: a.errors + r.errors, u200: a.u200 + r.under_200ms, u500: a.u500 + r.under_500ms }), { count: 0, errors: 0, u200: 0, u500: 0 });
  const jobs = Object.entries(data.jobs_24h ?? {});
  return (
    <div className="stack">
      <div className="row row--between"><span className="small muted">Counters since last API restart.</span><Button size="sm" onClick={reload}>Refresh</Button></div>
      <div className="grid-4">
        <Stat label="Uptime" value={fmtUptime(data.uptime_seconds)} />
        <Stat label="API requests" value={totals.count.toLocaleString()} hint={`${totals.errors} errors (${pct(totals.errors, totals.count)}%)`} />
        <Stat label="< 200 ms" value={`${pct(totals.u200, totals.count)}%`} hint="Target: API p95 < 200 ms" />
        <Stat label="< 500 ms" value={`${pct(totals.u500, totals.count)}%`} hint="Target: pages < 500 ms" />
      </div>
      <div className="grid-4">
        <Card title="Runtime"><dl className="kv">{Object.entries(data.runtime ?? {}).map(([k, v]) => <Fragment key={k}><dt>{human(k)}</dt><dd>{v.toLocaleString()}</dd></Fragment>)}</dl></Card>
        <Card title="Database pool"><dl className="kv">{Object.entries(data.db_pool ?? {}).map(([k, v]) => <Fragment key={k}><dt>{human(k)}</dt><dd>{v.toLocaleString()}</dd></Fragment>)}</dl></Card>
        <Card title="Queue"><dl className="kv"><dt>Ready</dt><dd>{data.queue?.ready ?? 0}</dd><dt>Delayed</dt><dd>{data.queue?.delayed ?? 0}</dd><dt>Processing</dt><dd>{data.queue?.processing ?? 0}</dd></dl></Card>
        <Card title="Jobs (24 h)">
          {jobs.length ? <dl className="kv">{jobs.map(([k, v]) => <Fragment key={k}><dt><Badge status={k} /></dt><dd>{v.toLocaleString()}</dd></Fragment>)}</dl> : <p className="muted small">No jobs.</p>}
        </Card>
      </div>
      <Card title="Storage">
        <div className="grid-4">
          <Stat label="Audio" value={fmtBytes(st.audio_bytes ?? 0)} hint={`${(st.audio_files ?? 0).toLocaleString()} files`} />
          <Stat label="Images" value={fmtBytes(st.image_bytes ?? 0)} hint={`${(st.images ?? 0).toLocaleString()} files`} />
          <Stat label="Total" value={fmtBytes((st.audio_bytes ?? 0) + (st.image_bytes ?? 0))} />
          {Object.entries(st).filter(([k]) => !['audio_bytes', 'audio_files', 'image_bytes', 'images'].includes(k)).map(([k, v]) => (
            <Stat key={k} label={human(k)} value={k.endsWith('bytes') ? fmtBytes(v) : v.toLocaleString()} />
          ))}
        </div>
      </Card>
      <Card title="API latency by route" actions={
        <label className="small">Sort by{' '}
          <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="count">Requests</option><option value="avg_ms">Avg ms</option><option value="max_ms">Max ms</option><option value="errors">Errors</option>
          </select>
        </label>}>
        {!api.length ? <Empty>No requests recorded yet.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Route</th><th>Requests</th><th>Errors</th><th>Avg ms</th><th>Max ms</th><th>&lt; 200 ms</th><th>&lt; 500 ms</th></tr></thead>
              <tbody>
                {api.map((r) => {
                  const p200 = pct(r.under_200ms, r.count);
                  return (
                    <tr key={r.route}>
                      <td className="mono">{r.route}</td>
                      <td>{r.count.toLocaleString()}</td>
                      <td style={{ color: r.errors ? 'var(--red)' : undefined }}>{r.errors}</td>
                      <td style={{ color: r.avg_ms > 200 ? 'var(--amber)' : undefined }}>{r.avg_ms.toFixed(1)}</td>
                      <td>{r.max_ms.toFixed(0)}</td>
                      <td><span className={`badge badge--${p200 >= 95 ? 'green' : p200 >= 80 ? 'amber' : 'red'}`}>{p200}%</span></td>
                      <td>{pct(r.under_500ms, r.count)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 8 }}>Performance targets: API responses under 200 ms and pages under 500 ms for the vast majority of requests. Prometheus metrics are also exposed at <code>/metrics</code> on the private network.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- backup
export function BackupTab() {
  const { run, busy } = useAction();
  return (
    <div className="grid-2">
      <Card title="Configuration & metadata export">
        <p className="small" style={{ marginTop: 0 }}>Downloads a JSON snapshot of tenant configuration (settings, branding, SEO, domains), podcast metadata and distribution metadata. Audio and images are not included.</p>
        <Button variant="primary" loading={busy} onClick={() => run(() => download('/system/backup', `podcast-backup-${new Date().toISOString().slice(0, 10)}.json`), 'Backup downloaded')}>⬇ Download backup.json</Button>
        <p className="hint" style={{ marginTop: 8 }}>The export is recorded in the audit log.</p>
      </Card>
      <Card title="Full database backups">
        <p className="small" style={{ marginTop: 0 }}>Complete PostgreSQL backups are taken by <code>infrastructure/backup.sh</code> (<code>pg_dump</code> custom format, keeps the 14 most recent dumps, and optionally saves this metadata export too). Schedule it with cron, e.g.:</p>
        <pre className="code">{['0 3 * * * DATABASE_URL=postgres://… \\', '  API_URL=https://api.example.com API_TOKEN=… \\', '  /opt/podcast/infrastructure/backup.sh /var/backups/podcast'].join('\n')}</pre>
        <p className="small">Object storage (audio & images) should use bucket versioning / replication for redundancy.</p>
      </Card>
    </div>
  );
}
