'use client';

import { get } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { AnalyticsSummary, Episode, TenantComparison } from '@/lib/types';
import { Badge, BarList, Card, ErrorBox, LineChart, PageHeader, Spinner, Stat, fmtBytes, fmtDate, useAsync } from '@/components/ui';

interface MasterDash {
  scope: 'network';
  stats: Record<string, number>;
  recent_episodes: Episode[];
  alerts: { severity: string; source: string; message: string; link: string; at: string }[];
  queue: { ready: number; delayed: number; processing: number };
  tenants: TenantComparison[];
}
interface TenantDash {
  scope: 'tenant';
  tenant_id: number;
  tenant_name: string;
  stats: Record<string, number>;
  distribution: { name: string; key: string; color: string; live: number }[];
  recent_episodes: Episode[];
  analytics_30d: AnalyticsSummary;
}

function RecentEpisodes({ items }: { items: Episode[] }) {
  return (
    <Card title="Recent episodes" actions={<a href="/episodes">All episodes →</a>}>
      {items.length === 0 ? <p className="muted">No episodes yet.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Episode</th><th>Podcast</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td><a className="cell-title" href={`/episodes/${e.id}`}>{e.title}</a></td>
                  <td>{e.podcast_title}</td>
                  <td><Badge status={e.status} /></td>
                  <td>{fmtDate(e.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Master Admin dashboard (PRD §55). */
function Master({ d }: { d: MasterDash }) {
  const s = d.stats;
  return (
    <>
      <PageHeader title="Network overview" subtitle="All tenants, domains and content across the platform" actions={<a className="btn btn--primary" href="/tenants/new">+ New website</a>} />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Total tenants" value={s.tenants} href="/tenants" />
        <Stat label="Total domains" value={s.domains} href="/domains" />
        <Stat label="Total podcasts" value={s.podcasts} href="/podcasts" />
        <Stat label="Total episodes" value={s.episodes} href="/episodes" />
        <Stat label="Total plays" value={s.plays.toLocaleString()} href="/analytics" />
        <Stat label="Storage used" value={fmtBytes(s.storage_bytes)} href="/system" />
        <Stat label="Distribution live" value={s.distribution_live} href="/distribution?status=LIVE" />
        <Stat label="Distribution pending" value={s.distribution_pending} hint={`${s.distribution_issues} need attention`} href="/distribution?status=PENDING" />
      </div>
      <div className="grid-2">
        <Card title="System alerts" actions={<a href="/system">System →</a>}>
          {d.alerts.length === 0 ? <p className="alert alert--success">✓ No critical failures.</p> : (
            <ul className="checklist">
              {d.alerts.map((a, i) => (
                <li key={i}><Badge status={a.severity} /> <span><strong>{a.source}</strong> — <a href={a.link}>{a.message}</a> <small className="muted">{fmtDate(a.at, true)}</small></span></li>
              ))}
            </ul>
          )}
          <p className="muted small" style={{ marginTop: 12 }}>Queue: {d.queue.ready} ready · {d.queue.delayed} delayed · {d.queue.processing} processing</p>
        </Card>
        <Card title="Top websites (30 days)" actions={<a href="/analytics">Compare →</a>}>
          <BarList items={d.tenants.slice(0, 8).map((t) => ({ label: `${t.tenant_name}${t.domain ? ` · ${t.domain}` : ''}`, value: t.plays }))} />
        </Card>
      </div>
      <div style={{ marginTop: 16 }}><RecentEpisodes items={d.recent_episodes} /></div>
    </>
  );
}

/** Tenant dashboard (PRD §56). */
function TenantView({ d }: { d: TenantDash }) {
  const s = d.stats;
  const a = d.analytics_30d;
  return (
    <>
      <PageHeader title={d.tenant_name} subtitle="Website dashboard" actions={<><a className="btn" href="/podcasts/new">+ New podcast</a><a className="btn btn--primary" href="/episodes/new">+ New episode</a></>} />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Podcasts" value={s.podcasts.toLocaleString()} href="/podcasts" />
        <Stat label="Episodes" value={s.episodes.toLocaleString()} href="/episodes" />
        <Stat label="Plays" value={s.plays.toLocaleString()} href="/analytics" />
        <Stat label="Platforms" value={s.platforms} hint="with at least one live show" href="/distribution" />
      </div>
      <div className="grid-2">
        <Card title="Distribution" actions={<a href="/distribution">Manage →</a>}>
          <BarList items={d.distribution.map((p) => ({ label: `${p.name}`, value: p.live }))} empty="No distribution yet" />
          <p className="muted small">Number of podcasts LIVE on each platform.</p>
        </Card>
        <Card title="Last 30 days">
          {a ? (
            <LineChart series={[
              { name: 'Plays', color: '#1457ff', points: a.series.map((p) => ({ x: p.day, y: p.plays })) },
              { name: 'Page views', color: '#10b981', points: a.series.map((p) => ({ x: p.day, y: p.page_views })) },
            ]} height={200} />
          ) : <p className="muted">No analytics yet.</p>}
        </Card>
      </div>
      <div style={{ marginTop: 16 }}><RecentEpisodes items={d.recent_episodes} /></div>
    </>
  );
}

export default function DashboardPage() {
  const tq = useTenantQuery();
  const { scopeTenantId } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<MasterDash | TenantDash>('/dashboard', tq), [scopeTenantId]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return data.scope === 'network' ? <Master d={data} /> : <TenantView d={data} />;
}
