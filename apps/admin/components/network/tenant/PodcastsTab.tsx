'use client';

import { useState } from 'react';
import { get, put } from '@/lib/api';
import type { Tenant } from '@/lib/types';
import { Badge, Empty, ErrorBox, Spinner, useAction, useAsync } from '@/components/ui';

interface TenantPodcast {
  podcast_id: number; title: string; slug: string; status: string; artwork_url: string; owner_tenant_id: number | null;
  is_featured: boolean; is_editors_pick: boolean; hidden: boolean; canonical_mode: string; sort_order: number; linked: boolean;
}
type Flag = 'is_featured' | 'is_editors_pick' | 'hidden';

/** Podcasts shown on a website, with per-tenant overrides (PRD §91). */
export function PodcastsTab({ tenant, canManage }: { tenant: Tenant; canManage: boolean }) {
  const { data, error, loading, reload, setData } = useAsync(() => get<TenantPodcast[]>(`/tenants/${tenant.id}/podcasts`), [tenant.id]);
  const { run } = useAction();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (p: TenantPodcast, flag: Flag) => {
    const key = `${p.podcast_id}-${flag}`;
    setBusy(key);
    const v = !p[flag];
    const r = await run(() => put(`/podcasts/${p.podcast_id}/tenants/${tenant.id}`, { [flag]: v }), 'Saved');
    setBusy(null);
    if (r !== undefined && data) setData(data.map((x) => (x.podcast_id === p.podcast_id ? { ...x, [flag]: v } : x)));
  };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty>No podcasts on this website yet. <a href="/podcasts/new">Create a podcast</a> or syndicate one from another site.</Empty>;

  const toggleCell = (p: TenantPodcast, flag: Flag, label: string) => (
    <label className="check" style={{ margin: 0 }}>
      <input type="checkbox" checked={p[flag]} disabled={!canManage || busy === `${p.podcast_id}-${flag}`} onChange={() => toggle(p, flag)} />
      <span className="sr-only">{label} — {p.title}</span>
    </label>
  );

  return (
    <>
      <p className="hint" style={{ marginBottom: 10 }}>Overrides apply only to <strong>{tenant.name}</strong>. Featured and Editor’s picks feed the homepage sections; hidden podcasts stay published elsewhere.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th /><th>Podcast</th><th>Status</th><th>Source</th><th>Featured</th><th>Editor’s pick</th><th>Hidden</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.podcast_id}>
                <td>{p.artwork_url ? <img className="thumb" src={p.artwork_url} alt="" /> : <span className="thumb" aria-hidden="true" />}</td>
                <td><a className="cell-title" href={`/podcasts/${p.podcast_id}`}>{p.title}</a><div className="small muted mono">/{p.slug}</div></td>
                <td><Badge status={p.status} /></td>
                <td className="small">{p.owner_tenant_id === tenant.id ? 'Own' : p.owner_tenant_id ? 'Syndicated' : 'Library'}</td>
                <td>{toggleCell(p, 'is_featured', 'Featured')}</td>
                <td>{toggleCell(p, 'is_editors_pick', 'Editor’s pick')}</td>
                <td>{toggleCell(p, 'hidden', 'Hidden')}</td>
                <td><a className="btn btn--sm" href={`/podcasts/${p.podcast_id}`}>Open</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
