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
        <Stat label="Total plays" value={(s.plays ?? 0).toLocaleString()} href="/analytics" />
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
      <div className="grid-3" style={{ marginTop: 16 }}>
        <Card title="Growth snapshot">
          <div className="stack" style={{ gap: 8 }}>
            <Stat label="Avg plays / podcast" value={s.podcasts ? Math.round(s.plays / s.podcasts).toLocaleString() : '0'} />
            <Stat label="Avg episodes / podcast" value={s.podcasts ? Math.round(s.episodes / s.podcasts).toLocaleString() : '0'} />
            <Stat label="Platform coverage" value={`${s.distribution_live} live`} hint={`${s.distribution_pending + s.distribution_live} total submissions`} />
          </div>
        </Card>
        <Card title="Content velocity">
          <div className="stack" style={{ gap: 8 }}>
            <Stat label="Episodes this month" value={(s.episodes_this_month ?? 0).toLocaleString()} />
            <Stat label="New podcasts this month" value={(s.podcasts_this_month ?? 0).toLocaleString()} />
          </div>
        </Card>
        <Card title="Engagement">
          <div className="stack" style={{ gap: 8 }}>
            <Stat label="Active websites" value={(s.active_tenants ?? s.tenants).toLocaleString()} hint="with plays in last 30 days" />
            <Stat label="Completion rate" value={s.plays ? `${Math.round((s.completions ?? 0) / s.plays * 100)}%` : '—'} />
          </div>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}><RecentEpisodes items={d.recent_episodes} /></div>
    </>
  );
}

function SetupChecklist({ s }: { s: Record<string, number> }) {
  const steps = [
    { done: s.podcasts > 0, label: 'Create your first podcast', href: '/podcasts/new' },
    { done: s.episodes > 0, label: 'Publish an episode', href: '/episodes/new' },
    { done: s.platforms > 0, label: 'Submit to at least one platform', href: '/distribution' },
    { done: s.plays > 0, label: 'Get your first listen', href: '/analytics' },
  ];
  const completed = steps.filter((s) => s.done).length;
  if (completed === steps.length) return null;
  return (
    <div style={{ marginBottom: 16 }}><Card title="Getting started">
      <p className="small muted" style={{ marginBottom: 8 }}>{completed} of {steps.length} steps completed</p>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2, #e5e7eb)', marginBottom: 12 }}>
        <div style={{ height: '100%', borderRadius: 3, background: 'var(--primary, #1457ff)', width: `${(completed / steps.length) * 100}%`, transition: 'width .3s' }} />
      </div>
      <ul className="checklist">
        {steps.map((step, i) => (
          <li key={i} style={{ opacity: step.done ? 0.6 : 1 }}>
            <span style={{ marginRight: 8 }}>{step.done ? '✓' : '○'}</span>
            {step.done ? <span>{step.label}</span> : <a href={step.href}>{step.label} →</a>}
          </li>
        ))}
      </ul>
    </Card></div>
  );
}

/** Tenant dashboard (PRD §56). */
function TenantView({ d }: { d: TenantDash }) {
  const s = d.stats;
  const a = d.analytics_30d;
  return (
    <>
      <PageHeader title={d.tenant_name} subtitle="Website dashboard" actions={<><a className="btn" href="/podcasts/new">+ New podcast</a><a className="btn btn--primary" href="/episodes/new">+ New episode</a></>} />
      <SetupChecklist s={s} />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Podcasts" value={(s.podcasts ?? 0).toLocaleString()} href="/podcasts" />
        <Stat label="Episodes" value={(s.episodes ?? 0).toLocaleString()} href="/episodes" />
        <Stat label="Plays" value={(s.plays ?? 0).toLocaleString()} href="/analytics" />
        <Stat label="Platforms" value={s.platforms ?? 0} hint="with at least one live show" href="/distribution" />
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
