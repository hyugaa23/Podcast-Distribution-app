'use client';

import { useState } from 'react';
import { del, get, list, post, put, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Episode, HealthCheck, Podcast, Readiness } from '@/lib/types';
import {
  Badge, Button, Card, Checkbox, ConfirmButton, Empty, ErrorBox, ImageUpload, Input, LinkButton, Modal, Pager, Progress, Select, Spinner, Stat,
  Textarea, fmtDate, fmtDuration, useAction, useAsync, useToast,
} from '@/components/ui';
import { CategorySelects, HostsEditor, PODCAST_STATUSES, Section, useCategories, useOwnerTimezone } from './common';
import { PodcastDetailsFields, PodcastOwnerFields, draftToBody, podcastToDraft, type PodcastDraft } from './podcastForm';

// ---------------------------------------------------------------- Details
export function DetailsTab({ p, onSaved, onDeleted }: { p: Podcast; onSaved: (p: Podcast) => void; onDeleted: () => void }) {
  const { can, tenants } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const tz = useOwnerTimezone(p.owner_tenant_id);
  const [d, setD] = useState<PodcastDraft>(() => podcastToDraft(p, tz));
  const [dirty, setDirty] = useState(false);
  const { run, busy } = useAction();
  const set = <K extends keyof PodcastDraft>(k: K, v: PodcastDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setDirty(true); };
  const ro = !p.can_edit;

  const save = async () => {
    if (!d.title.trim()) return;
    if (d.status === 'SCHEDULED' && !d.scheduled_at) { window.alert('Choose a date and time for the scheduled publish.'); return; }
    const body = draftToBody(d, { includeOwner: isSuper, includeCanonical: isSuper });
    if (d.slug.trim() === p.slug) delete body.slug;
    const r = await run(() => put<Podcast>(`/podcasts/${p.id}`, body), 'Podcast saved');
    if (r) { setDirty(false); onSaved(r); setD(podcastToDraft(r, tz)); }
  };
  const lifecycle = async (action: 'publish' | 'unpublish') => {
    const r = await run(() => post<Podcast>(`/podcasts/${p.id}/${action}`), action === 'publish' ? 'Podcast published' : 'Podcast unpublished');
    if (r) { onSaved(r); setD((x) => ({ ...x, status: r.status, scheduled_at: '' })); }
  };
  const remove = async () => {
    const ok = await run(async () => { await del(`/podcasts/${p.id}`); return true; }, 'Podcast deleted');
    if (ok) onDeleted();
  };
  const reloadAfterUpload = async () => { const r = await get<Podcast>(`/podcasts/${p.id}`); onSaved(r); setD((x) => ({ ...x, artwork_url: r.artwork_url, banner_url: r.banner_url })); };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      {ro && <div className="alert alert--info">You can view this podcast but not edit it.</div>}
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="c-editor">
          <div className="stack">
            <Card title="Podcast details">
              <PodcastDetailsFields d={d} set={set} slugHint="Changing the slug automatically creates 301 redirects for the show page and feed." />
            </Card>
            <Card title="Category, tags & hosts">
              <CategorySelects categoryId={d.category_id} subcategoryId={d.subcategory_id}
                onChange={(c, s) => { setD((x) => ({ ...x, category_id: c, subcategory_id: s })); setDirty(true); }} />
              <Input label="Tags" value={d.tags} onChange={(e) => set('tags', e.target.value)} hint="Comma separated." />
              <HostsEditor value={d.hosts} onChange={(v) => set('hosts', v)} />
            </Card>
            <Card title="Owner">
              <PodcastOwnerFields d={d} set={set} />
              {isSuper && (
                <div className="grid-2">
                  <Select label="Owner site" value={d.owner_tenant_id} onChange={(e) => set('owner_tenant_id', Number(e.target.value))}
                    options={[{ value: 0, label: 'Central library' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
                  <Select label="Canonical site" value={d.canonical_tenant_id} onChange={(e) => set('canonical_tenant_id', Number(e.target.value))}
                    hint="Syndicated copies point their canonical URL here (avoids duplicate content)."
                    options={[{ value: 0, label: '— Owner / none —' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
                </div>
              )}
            </Card>
          </div>
          <div className="c-editor__side">
            <Card title="Status">
              <p style={{ marginTop: 0 }}><Badge status={p.status} />{p.published_at && <span className="muted small"> · published {fmtDate(p.published_at)}</span>}</p>
              <Select label="Status" value={d.status} onChange={(e) => set('status', e.target.value as Podcast['status'])}
                options={PODCAST_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
              {d.status === 'SCHEDULED' && (
                <Input label="Publish at" type="datetime-local" required value={d.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)}
                  hint={`Site timezone: ${tz}`} />
              )}
              <div className="row">
                <Button type="submit" variant="primary" loading={busy} disabled={!d.title.trim()}>Save changes</Button>
                {p.status !== 'PUBLISHED'
                  ? <Button onClick={() => lifecycle('publish')} disabled={busy || dirty} title={dirty ? 'Save your changes first' : undefined}>Publish</Button>
                  : <Button onClick={() => lifecycle('unpublish')} disabled={busy}>Unpublish</Button>}
              </div>
              {dirty && <p className="hint" style={{ marginTop: 8 }}>You have unsaved changes.</p>}
            </Card>
            <Card title="Artwork">
              <ImageUpload label="Cover artwork" value={d.artwork_url} hint="Square, 1400–3000 px, JPG/PNG."
                onUpload={async (f) => { await uploadFile('podcast_artwork', p.id, f); await reloadAfterUpload(); }} />
              <Input label="…or artwork URL" type="url" value={d.artwork_url} onChange={(e) => set('artwork_url', e.target.value)} />
              <ImageUpload label="Banner" value={d.banner_url} hint="Wide image for the show page header."
                onUpload={async (f) => { await uploadFile('podcast_banner', p.id, f); await reloadAfterUpload(); }} />
            </Card>
            <Card title="Danger zone">
              <ConfirmButton variant="danger" confirm={`Delete “${p.title}” and all its episodes? This cannot be undone.`} onConfirm={remove} disabled={busy}>
                Delete podcast
              </ConfirmButton>
            </Card>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

// ---------------------------------------------------------------- Episodes
export function EpisodesTab({ p }: { p: Podcast }) {
  const [page, setPage] = useState(1);
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => list<Episode>(`/podcasts/${p.id}/episodes`, { page, per_page: 25 }), [p.id, page]);
  const canCreate = p.can_edit && !can('VIEWER');
  return (
    <Card title={`Episodes${data ? ` (${data.meta.total})` : ''}`} actions={canCreate && <LinkButton href={`/episodes/new?podcast=${p.id}`} variant="primary" size="sm">+ New episode</LinkButton>}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : !data?.data.length ? (
        <Empty>No episodes yet.{canCreate && <p><a href={`/episodes/new?podcast=${p.id}`}>Add the first episode →</a></p>}</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th>Episode</th><th>Type</th><th>Duration</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.season_number ? `S${e.season_number} ` : ''}{e.episode_number ? `E${e.episode_number}` : '—'}</td>
                    <td><a className="cell-title" href={`/episodes/${e.id}`}>{e.title}</a></td>
                    <td>{e.episode_type}</td>
                    <td>{fmtDuration(e.duration)}</td>
                    <td><Badge status={e.status} /></td>
                    <td>{fmtDate(e.published_at ?? e.scheduled_at ?? e.created_at)}</td>
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

// ---------------------------------------------------------------- Distribution summary
interface DistSummary { live: number; total: number; progress_percent: number; readiness: Readiness; can_manage: boolean }

export function DistributionTab({ p }: { p: Podcast }) {
  const { data, error, loading, reload } = useAsync(() => get<DistSummary>(`/distribution/${p.id}`), [p.id]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const r = data.readiness;
  return (
    <Card title="Distribution summary" actions={<LinkButton href={`/distribution/${p.id}`} variant="primary" size="sm">Open distribution manager →</LinkButton>}>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Live platforms" value={`${data.live} / ${data.total}`} />
        <Stat label="Distribution progress" value={`${data.progress_percent}%`} />
        <Stat label="Readiness" value={`${r?.percent ?? 0}%`} hint={r?.ready ? 'Ready to submit' : 'Not ready yet'} />
      </div>
      <p className="small muted" style={{ marginBottom: 4 }}>Progress</p>
      <Progress value={data.progress_percent} label="Distribution progress" />
      <p className="small muted" style={{ margin: '12px 0 4px' }}>Readiness</p>
      <Progress value={r?.percent ?? 0} label="Readiness" />
      {r && r.missing?.length > 0 && (
        <div className="alert alert--warn" style={{ marginTop: 14 }}>Missing before submitting: {r.missing.join(', ')}</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Sites (syndication matrix)
interface SiteRow {
  tenant_id: number; tenant_name: string; content_mode: string; domain: string; assigned: boolean; linked: boolean; is_owner: boolean; can_assign: boolean;
  is_featured: boolean; is_editors_pick: boolean; hidden: boolean; seo_title: string; meta_description: string; featured_image_url: string;
  category_id: number | null; canonical_mode: 'SELF' | 'PRIMARY';
}

export function SitesTab({ p, onChanged }: { p: Podcast; onChanged: () => void }) {
  const { can, tenants } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const canManage = can('SUPER_ADMIN', 'TENANT_ADMIN');
  const { data, error, loading, reload, setData } = useAsync(() => get<SiteRow[]>(`/podcasts/${p.id}/tenants`), [p.id]);
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const [canonical, setCanonical] = useState<number>(p.canonical_tenant_id ?? 0);
  const [edit, setEdit] = useState<SiteRow | null>(null);
  const { run, busy } = useAction();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  const rows = data ?? [];
  const sel = checked ?? new Set(rows.filter((r) => r.assigned || r.is_owner).map((r) => r.tenant_id));
  const dirty = checked !== null || canonical !== (p.canonical_tenant_id ?? 0);

  const save = async () => {
    const r = await run(() => put<SiteRow[]>(`/podcasts/${p.id}/tenants`, { tenant_ids: [...sel], canonical_tenant_id: canonical }), 'Sites updated');
    if (r) { setData(r); setChecked(null); onChanged(); }
  };

  return (
    <div className="stack">
      <Card title="Distribution across sites" actions={isSuper && <Button variant="primary" size="sm" onClick={save} loading={busy} disabled={!dirty}>Save sites</Button>}>
        <p className="muted small" style={{ marginTop: 0 }}>
          {isSuper ? 'Choose which websites show this podcast. The owner site always keeps it; Independent sites only show their own content.'
            : 'Websites showing this podcast. Only a super admin can change syndication; you can edit the overrides for your site.'}
        </p>
        {rows.length === 0 ? <Empty>No sites.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Show</th><th>Website</th><th>Mode</th><th>Visible</th><th>Overrides</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const disabled = !isSuper || r.is_owner || !r.can_assign;
                  return (
                    <tr key={r.tenant_id}>
                      <td>
                        <input type="checkbox" aria-label={`Show on ${r.tenant_name}`} checked={r.is_owner || sel.has(r.tenant_id)} disabled={disabled}
                          title={r.is_owner ? 'Owner site' : !r.can_assign ? 'Not allowed (independent site)' : undefined}
                          onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.tenant_id); else n.delete(r.tenant_id); setChecked(n); }} />
                      </td>
                      <td><strong>{r.tenant_name}</strong>{r.is_owner && <> <Badge status="ACTIVE">Owner</Badge></>}{canonical === r.tenant_id && <> <Badge status="SCHEDULED">Canonical</Badge></>}<div className="muted small">{r.domain || '—'}</div></td>
                      <td className="small">{r.content_mode}</td>
                      <td>{r.assigned && !r.hidden ? <Badge status="LIVE">Visible</Badge> : r.hidden ? <Badge status="DISABLED">Hidden</Badge> : <span className="muted">—</span>}</td>
                      <td className="small">
                        {[r.is_featured && 'Featured', r.is_editors_pick && "Editor's pick", r.seo_title && 'SEO title', r.meta_description && 'Meta', r.featured_image_url && 'Image', r.category_id && 'Category', r.canonical_mode === 'PRIMARY' && 'Canonical → primary']
                          .filter(Boolean).join(' · ') || <span className="muted">none</span>}
                      </td>
                      <td>{canManage && r.assigned && <Button size="sm" onClick={() => setEdit(r)}>Edit overrides</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {isSuper && (
          <div style={{ maxWidth: 420, marginTop: 14 }}>
            <Select label="Canonical site" value={canonical} onChange={(e) => setCanonical(Number(e.target.value))}
              hint="Copies on other sites use this site's URL as canonical when their mode is PRIMARY."
              options={[{ value: 0, label: '— Owner / none —' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
          </div>
        )}
      </Card>
      <OverridesModal podcastId={p.id} row={edit} onClose={() => setEdit(null)} onSaved={(rows) => { setData(rows); setEdit(null); }} />
    </div>
  );
}

function OverridesModal({ podcastId, row, onClose, onSaved }: { podcastId: number; row: SiteRow | null; onClose: () => void; onSaved: (rows: SiteRow[]) => void }) {
  const [f, setF] = useState<SiteRow | null>(row);
  const [prev, setPrev] = useState<SiteRow | null>(row);
  if (row !== prev) { setPrev(row); setF(row); }
  const cats = useCategories();
  const { run, busy } = useAction();
  const save = async () => {
    if (!f) return;
    const body = {
      is_featured: f.is_featured, is_editors_pick: f.is_editors_pick, hidden: f.hidden, seo_title: f.seo_title, meta_description: f.meta_description,
      featured_image_url: f.featured_image_url.trim(), category_id: f.category_id ?? 0, canonical_mode: f.canonical_mode,
    };
    const ok = await run(async () => { await put(`/podcasts/${podcastId}/tenants/${f.tenant_id}`, body); return true; }, 'Overrides saved');
    if (ok) onSaved(await get<SiteRow[]>(`/podcasts/${podcastId}/tenants`));
  };
  const s = <K extends keyof SiteRow>(k: K, v: SiteRow[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  return (
    <Modal title={`Overrides — ${row?.tenant_name ?? ''}`} open={!!row} onClose={onClose} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save overrides</Button></>}>
      {f && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>Site-specific settings for this podcast on {f.tenant_name}, without duplicating the podcast.</p>
          <div className="grid-3">
            <Checkbox label="Featured" checked={f.is_featured} onChange={(v) => s('is_featured', v)} />
            <Checkbox label="Editor's pick" checked={f.is_editors_pick} onChange={(v) => s('is_editors_pick', v)} />
            <Checkbox label="Hidden on this site" checked={f.hidden} onChange={(v) => s('hidden', v)} />
          </div>
          <Input label="SEO title" value={f.seo_title} onChange={(e) => s('seo_title', e.target.value)} maxLength={120} hint="Leave empty to use the podcast title." />
          <Textarea label="Meta description" rows={3} value={f.meta_description} onChange={(e) => s('meta_description', e.target.value)} maxLength={320} />
          <Input label="Featured image URL" type="url" value={f.featured_image_url} onChange={(e) => s('featured_image_url', e.target.value)} placeholder="https://" />
          <div className="grid-2">
            <Select label="Category override" value={f.category_id ?? ''} onChange={(e) => s('category_id', e.target.value ? Number(e.target.value) : null)}
              options={[{ value: '', label: '— Use podcast category —' }, ...cats.all.map((c) => ({ value: c.id, label: c.parent_id ? `  › ${c.name}` : c.name }))]} />
            <Select label="Canonical mode" value={f.canonical_mode} onChange={(e) => s('canonical_mode', e.target.value as SiteRow['canonical_mode'])}
              options={[{ value: 'SELF', label: 'SELF — this site is canonical' }, { value: 'PRIMARY', label: 'PRIMARY — point to canonical site' }]} />
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- RSS feed
interface FeedInfo { feed_url: string; size: number; validation: { valid: boolean; errors: number; warnings: number; items: number; issues: { severity: string; field: string; message: string }[] } }
interface HealthRun { status: string; checks: HealthCheck[]; checked_at?: string; feed_url?: string }

export function RssTab({ p }: { p: Podcast }) {
  const toast = useToast();
  const feed = useAsync(() => get<FeedInfo>(`/podcasts/${p.id}/feed`), [p.id]);
  const history = useAsync(() => get<HealthRun[]>(`/podcasts/${p.id}/rss-health`), [p.id]);
  const [latest, setLatest] = useState<HealthRun | null>(null);
  const { run, busy } = useAction();
  const check = async () => {
    const r = await run(() => post<HealthRun>(`/podcasts/${p.id}/rss-health`), 'RSS health check completed');
    if (r) { setLatest({ ...r, checked_at: new Date().toISOString() }); history.reload(); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast('success', 'Feed URL copied'); } catch { toast('error', 'Could not copy — select the text and copy manually'); }
  };
  const shown = latest ?? history.data?.[0] ?? null;
  const v = feed.data?.validation;

  return (
    <div className="stack">
      <Card title="RSS feed">
        {feed.error ? <ErrorBox error={feed.error} onRetry={feed.reload} /> : !feed.data ? <Spinner /> : (
          <>
            <div className="field">
              <label htmlFor="feed-url">Public feed URL</label>
              <div className="c-copy">
                <input id="feed-url" className="input mono" readOnly value={feed.data.feed_url} onFocus={(e) => e.target.select()} />
                <Button onClick={() => copy(feed.data!.feed_url)}>Copy</Button>
                <LinkButton href={feed.data.feed_url} external>Open ↗</LinkButton>
              </div>
              <p className="hint">Submit this URL to Apple Podcasts, Spotify and other platforms. {p.status !== 'PUBLISHED' && 'The feed is only public once the podcast is published.'}</p>
            </div>
            {v && (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <Badge status={v.valid ? 'OK' : 'ERROR'}>{v.valid ? '✓ Valid feed' : '✕ Feed has errors'}</Badge>
                  <span className="muted small">{v.items} item(s) · {v.errors} error(s) · {v.warnings} warning(s) · {(feed.data.size / 1024).toFixed(1)} KB</span>
                </div>
                {v.issues?.length ? (
                  <ul className="checklist">
                    {v.issues.map((i, k) => (
                      <li key={k}><Badge status={i.severity === 'error' ? 'error' : 'warning'}>{i.severity}</Badge> <span><code className="mono">{i.field}</code> — {i.message}</span></li>
                    ))}
                  </ul>
                ) : <p className="alert alert--success">✓ No validation issues.</p>}
              </>
            )}
          </>
        )}
      </Card>

      <Card title="RSS health" actions={<Button size="sm" variant="primary" onClick={check} loading={busy}>Run check now</Button>}>
        {history.error && <ErrorBox error={history.error} onRetry={history.reload} />}
        {!shown ? (history.loading ? <Spinner /> : <Empty>No health checks yet. Run one now.</Empty>) : (
          <>
            <p style={{ marginTop: 0 }}><Badge status={shown.status} /> <span className="muted small">checked {fmtDate(shown.checked_at, true)}</span></p>
            <ul className="c-health">
              {shown.checks.map((c) => (
                <li key={c.key}><Badge status={c.status}>{c.status === 'ok' ? '✓ ok' : c.status}</Badge><strong>{c.label}</strong><span className="muted">{c.message}</span></li>
              ))}
            </ul>
          </>
        )}
        {history.data && history.data.length > 1 && (
          <Section title="History">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Checked</th><th>Status</th><th>Problems</th></tr></thead>
                <tbody>
                  {history.data.map((h, i) => (
                    <tr key={i}>
                      <td>{fmtDate(h.checked_at, true)}</td>
                      <td><Badge status={h.status} /></td>
                      <td className="small">{h.checks.filter((c) => c.status !== 'ok').map((c) => c.label).join(', ') || <span className="muted">none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </Card>
    </div>
  );
}
