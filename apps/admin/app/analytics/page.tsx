'use client';

// Analytics (PRD §57), listen-through funnel (§58) and cross-domain comparison for super admins (§59).
import { useMemo, useState } from 'react';
import { download, get, list } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { AnalyticsSummary, DeviceBreakdown, EpisodeStats, KV, Podcast, TenantComparison } from '@/lib/types';
import { BarList, Button, Card, Empty, ErrorBox, LineChart, PageHeader, Spinner, Stat, useAction, useAsync } from '@/components/ui';

const RANGES = [7, 30, 90, 365];
const FUNNEL_LABEL: Record<string, string> = { PLAY: 'Play', '25_PERCENT': '25% listened', '50_PERCENT': '50% listened', '75_PERCENT': '75% listened', COMPLETE: 'Completed' };

const kvItems = (kv: KV[] | null | undefined, href?: (k: KV) => string | undefined) => (kv ?? []).map((k) => ({ label: k.label || k.key || '(unknown)', value: k.value, href: href?.(k) }));

export default function AnalyticsPage() {
  const tq = useTenantQuery();
  const { scopeTenantId, can, tenants } = useAuth();
  const [days, setDays] = useState(30);
  const [podcastId, setPodcastId] = useState<number | ''>('');
  const [tab, setTab] = useState<'overview' | 'episodes' | 'breakdown'>('overview');
  const { run, busy } = useAction();
  const isNetwork = can('SUPER_ADMIN') && !scopeTenantId;

  const pods = useAsync(() => { setPodcastId(''); return list<Podcast>('/podcasts', { ...tq, per_page: 100, sort: 'title' }); }, [scopeTenantId]);
  const { data, error, loading, reload } = useAsync(
    () => get<AnalyticsSummary>('/analytics/summary', { ...tq, days, podcast_id: podcastId || undefined }),
    [scopeTenantId, days, podcastId],
  );
  const scopeName = scopeTenantId ? tenants.find((t) => t.id === scopeTenantId)?.name : null;

  return (
    <>
      <PageHeader title="Analytics" subtitle={isNetwork ? 'All Network' : scopeName ?? 'Your website'}
        actions={<Button loading={busy} onClick={() => run(() => download('/exports/analytics', 'analytics.csv', { ...tq, days }), 'Export downloaded')}>⇩ Export CSV</Button>} />

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="row" role="group" aria-label="Date range" style={{ gap: 6 }}>
          {RANGES.map((d) => (
            <button key={d} type="button" className={`btn btn--sm ${d === days ? 'btn--primary' : ''}`} aria-pressed={d === days} onClick={() => setDays(d)}>
              {d === 365 ? '12 months' : `${d} days`}
            </button>
          ))}
        </div>
        <label className="row small" style={{ marginLeft: 'auto' }}>
          <span>Podcast</span>
          <select className="input" style={{ width: 'auto', maxWidth: 280 }} value={podcastId} onChange={(e) => setPodcastId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All podcasts</option>
            {(pods.data?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
      </div>

      <div className="row" role="tablist" style={{ marginBottom: 16, gap: 6 }}>
        {(['overview', 'episodes', 'breakdown'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={`btn btn--sm ${t === tab ? 'btn--primary' : ''}`}
            onClick={() => setTab(t)}>{t === 'overview' ? 'Overview' : t === 'episodes' ? 'Episodes' : 'Geo & Devices'}</button>
        ))}
      </div>

      {tab === 'overview' && (loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data && <Summary s={data} />)}
      {tab === 'episodes' && <EpisodeTab tq={tq} days={days} podcastId={podcastId || undefined} />}
      {tab === 'breakdown' && <BreakdownTab tq={tq} days={days} podcastId={podcastId || undefined} />}

      {isNetwork && tab === 'overview' && <div style={{ marginTop: 16 }}><NetworkComparison days={days} /></div>}

      <p className="small muted" style={{ marginTop: 24 }}>Analytics are aggregated every 5 minutes. Unique visitors are counted per calendar day using anonymised session hashes. Data is retained for 13 months.</p>
    </>
  );
}

function Summary({ s }: { s: AnalyticsSummary }) {
  const completionRate = s.episode_plays ? Math.round((s.completions / s.episode_plays) * 100) : 0;
  const funnel = (s.funnel ?? []).map((f) => ({ label: FUNNEL_LABEL[f.key] ?? f.label, value: f.value }));
  const empty = !s.episode_plays && !s.page_views && !s.unique_visitors;
  return (
    <div className="stack">
      <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Stat label="Episode plays" value={s.episode_plays.toLocaleString()} />
        <Stat label="Podcast plays" value={s.podcast_plays.toLocaleString()} />
        <Stat label="Unique visitors" value={s.unique_visitors.toLocaleString()} />
        <Stat label="Page views" value={s.page_views.toLocaleString()} />
        <Stat label="Completions" value={s.completions.toLocaleString()} hint={`${completionRate}% of plays`} />
      </div>
      {empty && <p className="alert alert--info" style={{ margin: 0 }}>No tracked activity in this period yet.</p>}
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <Card title="Over time">
          {s.series?.length ? (
            <LineChart series={[
              { name: 'Plays', color: '#1457ff', points: s.series.map((p) => ({ x: p.day, y: p.plays })) },
              { name: 'Page views', color: '#10b981', points: s.series.map((p) => ({ x: p.day, y: p.page_views })) },
              { name: 'Visitors', color: '#f59e0b', points: s.series.map((p) => ({ x: p.day, y: p.visitors })) },
            ]} />
          ) : <p className="muted">No data yet.</p>}
        </Card>
        <Card title="Listen-through funnel">
          <BarList items={funnel} />
          <p className="muted small" style={{ marginBottom: 0 }}>Plays that reached each point of the episode.</p>
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Top podcasts"><BarList items={kvItems(s.top_podcasts, (k) => (k.key ? `/podcasts/${k.key}` : undefined))} /></Card>
        <Card title="Top episodes"><BarList items={kvItems(s.top_episodes, (k) => (k.key ? `/episodes/${k.key}` : undefined))} /></Card>
      </div>
      <div className="grid-3">
        <Card title="Referrers"><BarList items={kvItems(s.referrers)} /></Card>
        <Card title="Countries"><BarList items={kvItems(s.countries)} /></Card>
        <Card title="Domains"><BarList items={kvItems(s.domains)} /></Card>
        <Card title="Devices"><BarList items={kvItems(s.devices)} /></Card>
        <Card title="Browsers"><BarList items={kvItems(s.browsers)} /></Card>
      </div>
    </div>
  );
}

type SortKey = 'tenant_name' | 'domain' | 'plays' | 'completions' | 'page_views' | 'unique_visitors' | 'podcasts' | 'episodes';
const COLS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'tenant_name', label: 'Site' }, { key: 'domain', label: 'Domain' }, { key: 'plays', label: 'Plays', numeric: true },
  { key: 'completions', label: 'Completions', numeric: true }, { key: 'page_views', label: 'Page views', numeric: true },
  { key: 'unique_visitors', label: 'Visitors', numeric: true }, { key: 'podcasts', label: 'Podcasts', numeric: true }, { key: 'episodes', label: 'Episodes', numeric: true },
];

function EpisodeTab({ tq, days, podcastId }: { tq: Record<string, unknown>; days: number; podcastId?: number }) {
  const { data, error, loading, reload } = useAsync(
    () => podcastId ? get<EpisodeStats[]>('/analytics/episodes', { ...tq, days, podcast_id: podcastId }) : Promise.resolve(null),
    [days, podcastId],
  );
  if (!podcastId) return <p className="alert alert--info">Select a podcast above to see per-episode analytics.</p>;
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty>No episode data for this period.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Episode</th><th style={{ textAlign: 'right' }}>Plays</th><th style={{ textAlign: 'right' }}>Completions</th><th style={{ textAlign: 'right' }}>Downloads</th><th style={{ textAlign: 'right' }}>Visitors</th><th style={{ textAlign: 'right' }}>Avg %</th></tr></thead>
        <tbody>
          {data.map((ep) => (
            <tr key={ep.episode_id}>
              <td><a className="cell-title" href={`/episodes/${ep.episode_id}`}>{ep.title}</a></td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ep.plays.toLocaleString()}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ep.completions.toLocaleString()}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ep.downloads.toLocaleString()}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ep.visitors.toLocaleString()}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ep.avg_percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownTab({ tq, days, podcastId }: { tq: Record<string, unknown>; days: number; podcastId?: number }) {
  const params = { ...tq, days, podcast_id: podcastId || undefined };
  const geo = useAsync(() => get<KV[]>('/analytics/geo', params), [days, podcastId]);
  const dev = useAsync(() => get<DeviceBreakdown>('/analytics/devices', params), [days, podcastId]);
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Countries">
          {geo.loading ? <Spinner /> : geo.error ? <ErrorBox error={geo.error} onRetry={geo.reload} /> : <BarList items={kvItems(geo.data)} />}
        </Card>
        <Card title="Devices">
          {dev.loading ? <Spinner /> : dev.error ? <ErrorBox error={dev.error} onRetry={dev.reload} /> : <BarList items={kvItems(dev.data?.devices)} />}
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Browsers">
          {dev.data ? <BarList items={kvItems(dev.data.browsers)} /> : dev.loading ? <Spinner /> : null}
        </Card>
        <Card title="Operating Systems">
          {dev.data ? <BarList items={kvItems(dev.data.os)} /> : dev.loading ? <Spinner /> : null}
        </Card>
      </div>
    </div>
  );
}

function NetworkComparison({ days }: { days: number }) {
  const { setScopeTenantId } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<{ tenants: TenantComparison[] }>('/analytics/network', { days }), [days]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'plays', dir: -1 });
  const rows = useMemo(() => {
    const r = [...(data?.tenants ?? [])];
    r.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return c * sort.dir;
    });
    return r;
  }, [data, sort]);
  const barKey: SortKey = COLS.find((c) => c.key === sort.key)?.numeric ? sort.key : 'plays';
  const max = Math.max(1, ...rows.map((r) => Number(r[barKey]) || 0));

  return (
    <Card title="Network comparison" actions={<span className="muted small">Cross-domain performance · last {days} days</span>}>
      <>
        {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !rows.length ? <Empty>No websites yet.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} style={c.numeric ? { textAlign: 'right' } : undefined}>
                      <button type="button" className="link" style={{ color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }}
                        onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.numeric ? -1 : 1 }))}>
                        {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                  <th style={{ width: '22%' }}>{COLS.find((c) => c.key === barKey)?.label}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const v = Number(t[barKey]) || 0;
                  return (
                    <tr key={t.tenant_id}>
                      <td><button type="button" className="link cell-title" title="Switch scope to this website" onClick={() => setScopeTenantId(t.tenant_id)}>{t.tenant_name}</button></td>
                      <td className="small">{t.domain ? <a href={`https://${t.domain}`} target="_blank" rel="noopener noreferrer">{t.domain}</a> : '—'}</td>
                      {COLS.filter((c) => c.numeric).map((c) => <td key={c.key} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(Number(t[c.key]) || 0).toLocaleString()}</td>)}
                      <td aria-hidden="true">
                        <div style={{ background: '#eef2ff', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                          <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: 'var(--primary)', borderRadius: 6 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    </Card>
  );
}
