'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { download, list, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Podcast } from '@/lib/types';
import { Badge, Button, Checkbox, Empty, ErrorBox, Field, LinkButton, PageHeader, Pager, Select, Spinner, fmtDate, useAction, useAsync } from '@/components/ui';
import { BulkResult, PODCAST_STATUSES, Thumb, useCanEdit, useCategories } from '@/components/content/common';

type BulkAction = 'publish' | 'unpublish' | 'archive' | 'category' | 'assign_tenants' | 'delete';

export default function PodcastsPage() {
  const { can, scopeTenantId, tenants } = useAuth();
  const tq = useTenantQuery();
  const canEdit = useCanEdit();
  const isSuper = can('SUPER_ADMIN');
  const cats = useCategories();

  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('updated');
  const [library, setLibrary] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [action, setAction] = useState<BulkAction | ''>('');
  const [bulkCat, setBulkCat] = useState('');
  const [bulkTenants, setBulkTenants] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ ok: number[]; skipped: number[] } | null>(null);
  const { run, busy } = useAction();
  const exp = useAction();

  const { data, error, loading, reload } = useAsync(
    () => list<Podcast>('/podcasts', { ...tq, q, status, category_id: category, sort, page, per_page: 25, library: library ? 1 : undefined }),
    [scopeTenantId, q, status, category, sort, page, library],
  );
  const rows = data?.data ?? [];
  const editable = rows.filter((p) => p.can_edit);
  const allSelected = editable.length > 0 && editable.every((p) => selected.has(p.id));

  const resetPage = () => { setPage(1); setSelected(new Set()); };
  useEffect(() => {
    setPage(1); setSelected(new Set()); setAction(''); setResult(null);
  }, [scopeTenantId]);
  const onSearch = (e: FormEvent) => { e.preventDefault(); setQ(qInput.trim()); resetPage(); };

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(editable.map((p) => p.id)));

  const applyBulk = async () => {
    if (loading || !action || selected.size === 0) return;
    if (action === 'category' && !bulkCat) return;
    if (action === 'assign_tenants' && bulkTenants.size === 0) return;
    if (action === 'delete' && !window.confirm(`Delete ${selected.size} podcast(s) and all their episodes? This cannot be undone.`)) return;
    const body: Record<string, unknown> = { action, ids: [...selected] };
    if (action === 'category') body.category_id = Number(bulkCat);
    if (action === 'assign_tenants') body.tenant_ids = [...bulkTenants];
    const r = await run(() => post<{ ok: number[]; skipped: number[] }>('/podcasts/bulk', body), 'Bulk action applied');
    if (r) { setResult(r); setSelected(new Set()); setAction(''); reload(); }
  };

  const exportCsv = () => exp.run(() => download('/exports/podcasts', 'podcasts.csv', tq));

  const actions = [
    { value: '', label: '— Choose action —' },
    { value: 'publish', label: 'Publish' },
    { value: 'unpublish', label: 'Unpublish (back to draft)' },
    { value: 'archive', label: 'Archive' },
    { value: 'category', label: 'Set category' },
    ...(isSuper ? [{ value: 'assign_tenants', label: 'Assign to sites' }] : []),
    { value: 'delete', label: 'Delete' },
  ];

  return (
    <>
      <PageHeader
        title="Podcasts"
        subtitle={data ? `${data.meta.total.toLocaleString()} podcast${data.meta.total === 1 ? '' : 's'}` : 'Podcast library'}
        actions={<>
          <Button onClick={exportCsv} loading={exp.busy}>⇩ Export CSV</Button>
          {can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR') && <LinkButton href="/podcasts/new" variant="primary">+ New podcast</LinkButton>}
        </>}
      />

      <form className="c-filters" onSubmit={onSearch} role="search">
        <Field label="Search">
          {(id) => <input id={id} type="search" placeholder="Title, author, description…" value={qInput} onChange={(e) => setQInput(e.target.value)} />}
        </Field>
        <Button type="submit">Search</Button>
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }}
          options={[{ value: '', label: 'All statuses' }, ...PODCAST_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))]} />
        <Field label="Category">
          {(id) => (
            <select id={id} value={category} onChange={(e) => { setCategory(e.target.value); resetPage(); }}>
              <option value="">All categories</option>
              {cats.parents.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name} (all)</option>
                  {cats.childrenOf(c.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <Select label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); resetPage(); }}
          options={[{ value: 'updated', label: 'Recently updated' }, { value: 'created', label: 'Newest' }, { value: 'title', label: 'Title A–Z' }]} />
        {isSuper && <div style={{ paddingBottom: 4 }}><Checkbox label="Central library only" checked={library} onChange={(v) => { setLibrary(v); resetPage(); }} /></div>}
      </form>

      <BulkResult result={result} onClose={() => setResult(null)} noun="podcast" />

      {canEdit && selected.size > 0 && (
        <div className="c-bulkbar" role="region" aria-label="Bulk actions">
          <strong style={{ alignSelf: 'center' }}>{selected.size} selected</strong>
          <Select label="Bulk action" value={action} onChange={(e) => setAction(e.target.value as BulkAction)} options={actions} />
          {action === 'category' && (
            <Field label="Category">
              {(id) => (
                <select id={id} value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
                  <option value="">— Choose —</option>
                  {cats.parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </Field>
          )}
          {action === 'assign_tenants' && (
            <fieldset className="c-fieldset" style={{ margin: 0, flex: '1 1 100%' }}>
              <legend>Add to sites</legend>
              <div className="c-checkgrid">
                {tenants.map((t) => (
                  <Checkbox key={t.id} label={`${t.name}${t.content_mode === 'INDEPENDENT' ? ' (independent)' : ''}`} checked={bulkTenants.has(t.id)}
                    onChange={(v) => setBulkTenants((s) => { const n = new Set(s); if (v) n.add(t.id); else n.delete(t.id); return n; })} />
                ))}
              </div>
              <p className="hint">Independent sites only show their own podcasts and will be skipped.</p>
            </fieldset>
          )}
          <Button variant={action === 'delete' ? 'danger' : 'primary'} onClick={applyBulk} loading={busy}
            disabled={loading || !action || (action === 'category' && !bulkCat) || (action === 'assign_tenants' && bulkTenants.size === 0)}>Apply</Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty>
          {q || status || category || library ? 'No podcasts match these filters.' : 'No podcasts yet.'}
          {can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR') && !q && !status && !category && <p><a href="/podcasts/new">Create your first podcast →</a></p>}
        </Empty>
      ) : (
        <div className="table-wrap" aria-busy={loading}>
          <table className="table">
            <thead>
              <tr>
                {canEdit && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={toggleAll} disabled={!editable.length} /></th>}
                <th style={{ width: 52 }}><span className="sr-only">Artwork</span></th>
                <th>Podcast</th>
                <th>Owner site</th>
                <th>Category</th>
                <th>Status</th>
                <th>Episodes</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  {canEdit && <td><input type="checkbox" aria-label={`Select ${p.title}`} checked={selected.has(p.id)} disabled={!p.can_edit} onChange={() => toggle(p.id)} /></td>}
                  <td><Thumb src={p.artwork_url} /></td>
                  <td>
                    <a className="cell-title" href={`/podcasts/${p.id}`}>{p.title}</a>
                    <div className="muted small">{p.author || '—'}{p.source_type === 'IMPORTED' && <> · imported</>}</div>
                  </td>
                  <td>{p.owner_tenant_id ? p.owner_tenant_name : <span className="muted">Central library</span>}</td>
                  <td>{p.category?.name ?? <span className="muted">—</span>}{p.subcategory && <span className="muted small"> › {p.subcategory.name}</span>}</td>
                  <td><Badge status={p.status} />{p.status === 'SCHEDULED' && p.scheduled_at && <div className="muted small">{fmtDate(p.scheduled_at, true)}</div>}</td>
                  <td>{p.episode_count}</td>
                  <td>{fmtDate(p.updated_at)}</td>
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
