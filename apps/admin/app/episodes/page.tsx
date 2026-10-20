'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { download, list, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Episode, Podcast } from '@/lib/types';
import { Badge, Button, Empty, ErrorBox, Field, LinkButton, PageHeader, Pager, Select, Spinner, fmtDate, fmtDuration, useAction, useAsync } from '@/components/ui';
import { BulkResult, EPISODE_STATUSES, Thumb, useCanEdit } from '@/components/content/common';

type BulkAction = 'publish' | 'unpublish' | 'archive' | 'delete';

function EpisodesList() {
  const sp = useSearchParams();
  const { scopeTenantId } = useAuth();
  const tq = useTenantQuery();
  const canEdit = useCanEdit();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [podcast, setPodcast] = useState(sp.get('podcast') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [action, setAction] = useState<BulkAction | ''>('');
  const [result, setResult] = useState<{ ok: number[]; skipped: number[] } | null>(null);
  const { run, busy } = useAction();
  const exp = useAction();

  const podcasts = useAsync(() => list<Podcast>('/podcasts', { ...tq, sort: 'title', per_page: 100 }), [scopeTenantId]);
  const { data, error, loading, reload } = useAsync(
    () => list<Episode>('/episodes', { ...tq, podcast_id: podcast, status, q, page, per_page: 25 }),
    [scopeTenantId, podcast, status, q, page],
  );
  const rows = data?.data ?? [];
  const allSelected = rows.length > 0 && rows.every((e) => selected.has(e.id));
  const resetPage = () => { setPage(1); setSelected(new Set()); };
  const previousScope = useRef(scopeTenantId);
  useEffect(() => {
    if (previousScope.current === scopeTenantId) return;
    previousScope.current = scopeTenantId;
    setPage(1); setSelected(new Set()); setPodcast(''); setAction(''); setResult(null);
  }, [scopeTenantId]);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const applyBulk = async () => {
    if (loading || !action || !selected.size) return;
    if (action === 'delete' && !window.confirm(`Delete ${selected.size} episode(s)? This cannot be undone.`)) return;
    const r = await run(() => post<{ ok: number[]; skipped: number[] }>('/episodes/bulk', { action, ids: [...selected] }), 'Bulk action applied');
    if (r) { setResult(r); setSelected(new Set()); setAction(''); reload(); }
  };

  const newHref = podcast ? `/episodes/new?podcast=${podcast}` : '/episodes/new';

  return (
    <>
      <PageHeader
        title="Episodes"
        subtitle={data ? `${data.meta.total.toLocaleString()} episode${data.meta.total === 1 ? '' : 's'}` : 'All episodes across your podcasts'}
        actions={<>
          <Button onClick={() => exp.run(() => download('/exports/episodes', 'episodes.csv', { ...tq, podcast_id: podcast || undefined }))} loading={exp.busy}>⇩ Export CSV</Button>
          {canEdit && <LinkButton href={newHref} variant="primary">+ New episode</LinkButton>}
        </>}
      />

      <form className="c-filters" role="search" onSubmit={(e: FormEvent) => { e.preventDefault(); setQ(qInput.trim()); resetPage(); }}>
        <Field label="Search">
          {(id) => <input id={id} type="search" placeholder="Episode title…" value={qInput} onChange={(e) => setQInput(e.target.value)} />}
        </Field>
        <Button type="submit">Search</Button>
        <Select label="Podcast" value={podcast} onChange={(e) => { setPodcast(e.target.value); resetPage(); }}
          options={[{ value: '', label: podcasts.loading ? 'Loading…' : 'All podcasts' }, ...(podcasts.data?.data ?? []).map((p) => ({ value: p.id, label: p.title }))]} />
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }}
          options={[{ value: '', label: 'All statuses' }, ...EPISODE_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))]} />
      </form>

      <BulkResult result={result} onClose={() => setResult(null)} noun="episode" />

      {canEdit && selected.size > 0 && (
        <div className="c-bulkbar" role="region" aria-label="Bulk actions">
          <strong style={{ alignSelf: 'center' }}>{selected.size} selected</strong>
          <Select label="Bulk action" value={action} onChange={(e) => setAction(e.target.value as BulkAction)}
            options={[{ value: '', label: '— Choose action —' }, { value: 'publish', label: 'Publish' }, { value: 'unpublish', label: 'Unpublish (back to draft)' },
              { value: 'archive', label: 'Archive' }, { value: 'delete', label: 'Delete' }]} />
          <Button variant={action === 'delete' ? 'danger' : 'primary'} onClick={applyBulk} loading={busy} disabled={loading || !action}>Apply</Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          <p className="hint" style={{ flexBasis: '100%' }}>Episodes without audio can’t be published and will be skipped.</p>
        </div>
      )}

      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty>{q || status || podcast ? 'No episodes match these filters.' : 'No episodes yet.'}{canEdit && <p><a href={newHref}>Create an episode →</a></p>}</Empty>
      ) : (
        <div className="table-wrap" aria-busy={loading}>
          <table className="table">
            <thead>
              <tr>
                {canEdit && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((e) => e.id)))} /></th>}
                <th style={{ width: 52 }}><span className="sr-only">Artwork</span></th>
                <th>Episode</th>
                <th>Podcast</th>
                <th>#</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  {canEdit && <td><input type="checkbox" aria-label={`Select ${e.title}`} checked={selected.has(e.id)} onChange={() => toggle(e.id)} /></td>}
                  <td><Thumb src={e.artwork_url || e.podcast_artwork_url} /></td>
                  <td><a className="cell-title" href={`/episodes/${e.id}`}>{e.title}</a>{e.episode_type !== 'full' && <span className="muted small"> · {e.episode_type}</span>}</td>
                  <td><a href={`/podcasts/${e.podcast_id}`}>{e.podcast_title}</a></td>
                  <td className="muted">{e.season_number ? `S${e.season_number} ` : ''}{e.episode_number ? `E${e.episode_number}` : '—'}</td>
                  <td>{fmtDuration(e.duration)}</td>
                  <td><Badge status={e.status} />{e.status === 'FAILED' && e.processing_error && <div className="small" style={{ color: 'var(--red)' }}>Audio failed</div>}</td>
                  <td>{e.status === 'SCHEDULED' ? <>⏰ {fmtDate(e.scheduled_at, true)}</> : fmtDate(e.published_at ?? e.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.meta.page} pages={data.meta.pages} onPage={(p) => { setPage(p); setSelected(new Set()); }} />}
    </>
  );
}

export default function EpisodesPage() {
  return <Suspense fallback={<Spinner />}><EpisodesList /></Suspense>;
}
