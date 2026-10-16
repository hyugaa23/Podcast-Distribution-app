'use client';

import { useState } from 'react';
import { del, get, list, post, put, uploadFile } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Collection, Podcast } from '@/lib/types';
import { Badge, Button, Checkbox, ConfirmButton, Empty, ErrorBox, Field, ImageUpload, Input, Modal, PageHeader, Select, Spinner, Textarea, useAction, useAsync } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Form { id?: number; tenant_id: number; title: string; slug: string; description: string; cover_url: string; is_published: boolean; sort_order: string; podcast_ids: number[] }

export default function CollectionsPage() {
  const { can, scopeTenantId, tenants, user } = useAuth();
  const tq = useTenantQuery();
  const isSuper = can('SUPER_ADMIN');
  const canEdit = can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR');
  const { data, error, loading, reload } = useAsync(() => get<Collection[]>('/collections', tq), [scopeTenantId]);
  const [form, setForm] = useState<Form | null>(null);
  const { run, busy } = useAction();

  // Podcasts available on the collection's site (for the picker).
  const formTenant = form?.tenant_id || 0;
  const pods = useAsync(
    () => (form ? list<Podcast>('/podcasts', { tenant_id: isSuper ? formTenant || undefined : undefined, sort: 'title', per_page: 200 }) : Promise.resolve(undefined)),
    [!!form, formTenant],
  );
  const podMap = new Map((pods.data?.data ?? []).map((p) => [p.id, p]));
  const [pick, setPick] = useState('');

  const tenantName = (id: number) => tenants.find((t) => t.id === id)?.name ?? `#${id}`;
  const defaultTenant = isSuper ? scopeTenantId ?? 0 : user?.tenant_id ?? 0;

  const openNew = () => setForm({ tenant_id: defaultTenant, title: '', slug: '', description: '', cover_url: '', is_published: true, sort_order: '0', podcast_ids: [] });
  const openEdit = (c: Collection) => setForm({ id: c.id, tenant_id: c.tenant_id, title: c.title, slug: c.slug, description: c.description ?? '', cover_url: c.cover_url ?? '', is_published: c.is_published, sort_order: String(c.sort_order ?? 0), podcast_ids: c.podcast_ids ?? [] });

  const save = async () => {
    if (!form || !form.title.trim()) return;
    if (!form.tenant_id) { window.alert('Choose the website for this collection.'); return; }
    const body = {
      tenant_id: form.tenant_id, title: form.title.trim(), slug: form.slug.trim(), description: form.description, cover_url: form.cover_url.trim(),
      is_published: form.is_published, sort_order: Number(form.sort_order) || 0, podcast_ids: form.podcast_ids,
    };
    const r = await run(() => (form.id ? put<Collection>(`/collections/${form.id}`, body) : post<Collection>('/collections', body)), form.id ? 'Collection saved' : 'Collection created');
    if (r) {
      reload();
      if (form.id) setForm(null);
      else setForm({ ...form, id: r.id, slug: r.slug ?? form.slug });
    }
  };
  const remove = async (c: Collection) => {
    const ok = await run(async () => { await del(`/collections/${c.id}`); return true; }, 'Collection deleted');
    if (ok) reload();
  };
  const move = (i: number, dir: -1 | 1) => {
    if (!form) return;
    const ids = [...form.podcast_ids];
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setForm({ ...form, podcast_ids: ids });
  };

  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Collections" subtitle="Curated lists like “Best Marketing Podcasts” or “Editor’s Picks” — published at /collection/{slug}"
        actions={canEdit && <Button variant="primary" onClick={openNew}>+ New collection</Button>} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty>No collections yet.{canEdit && <p><button type="button" className="link" onClick={openNew}>Create the first collection →</button></p>}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 52 }}><span className="sr-only">Cover</span></th><th>Collection</th>{isSuper && <th>Website</th>}<th>Podcasts</th><th>Status</th><th>Order</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.cover_url ? <img src={c.cover_url} alt="" className="thumb" /> : <span className="thumb c-thumb--empty" aria-hidden="true"><Icon name="collections" /></span>}</td>
                  <td>
                    {canEdit ? <button type="button" className="link cell-title" onClick={() => openEdit(c)}>{c.title}</button> : <strong>{c.title}</strong>}
                    <div className="muted small">/collection/{c.slug}</div>
                  </td>
                  {isSuper && <td className="small">{tenantName(c.tenant_id)}</td>}
                  <td>{c.podcast_ids?.length ?? 0}</td>
                  <td><Badge status={c.is_published ? 'PUBLISHED' : 'DRAFT'} /></td>
                  <td>{c.sort_order}</td>
                  <td>
                    {canEdit && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" onClick={() => openEdit(c)}>Edit</Button>
                        <ConfirmButton size="sm" variant="danger" confirm={`Delete collection “${c.title}”?`} onConfirm={() => remove(c)}>Delete</ConfirmButton>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal title={form?.id ? `Edit collection — ${form.title}` : 'New collection'} open={!!form} onClose={() => setForm(null)} wide
        footer={<><Button onClick={() => setForm(null)}>{form?.id ? 'Close' : 'Cancel'}</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form?.title.trim()}>{form?.id ? 'Save' : 'Create collection'}</Button></>}>
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            {isSuper && (
              <Select label="Website" required value={form.tenant_id} disabled={!!form.id}
                onChange={(e) => setForm({ ...form, tenant_id: Number(e.target.value), podcast_ids: [] })}
                hint={form.id ? 'A collection belongs to one website.' : 'Collections are shown on one website.'}
                options={[{ value: 0, label: '— Choose website —' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
            )}
            <div className="grid-2">
              <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Input label="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto from title" />
            </div>
            <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid-2">
              <Input label="Sort order" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} hint="Lower numbers show first." />
              <div className="field" style={{ justifyContent: 'flex-end' }}><Checkbox label="Published" checked={form.is_published} onChange={(v) => setForm({ ...form, is_published: v })} /></div>
            </div>
            {form.id ? (
              <ImageUpload label="Cover image" value={form.cover_url}
                onUpload={async (f) => { const r = await uploadFile('collection_cover', form.id!, f); setForm((x) => (x ? { ...x, cover_url: r.url } : x)); reload(); }} />
            ) : <p className="hint">Create the collection first to upload a cover, or paste an image URL.</p>}
            <Input label="Cover URL" type="url" value={form.cover_url} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} placeholder="https://" />

            <fieldset className="c-fieldset">
              <legend>Podcasts ({form.podcast_ids.length})</legend>
              {form.podcast_ids.length === 0 ? <p className="muted small">No podcasts yet — add some below.</p> : (
                <ol className="sortable">
                  {form.podcast_ids.map((pid, i) => {
                    const p = podMap.get(pid);
                    return (
                      <li key={pid}>
                        <span className="muted small" style={{ width: 20 }}>{i + 1}.</span>
                        {p?.artwork_url ? <img src={p.artwork_url} alt="" className="c-avatar" style={{ borderRadius: 6 }} /> : null}
                        <span className="grow">{p?.title ?? `Podcast #${pid}`}</span>
                        <Button size="sm" variant="ghost" aria-label={`Move ${p?.title ?? pid} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                        <Button size="sm" variant="ghost" aria-label={`Move ${p?.title ?? pid} down`} disabled={i === form.podcast_ids.length - 1} onClick={() => move(i, 1)}>↓</Button>
                        <Button size="sm" variant="ghost" aria-label={`Remove ${p?.title ?? pid}`} onClick={() => setForm({ ...form, podcast_ids: form.podcast_ids.filter((x) => x !== pid) })}>✕</Button>
                      </li>
                    );
                  })}
                </ol>
              )}
              <Field label="Add podcast" hint={isSuper && !form.tenant_id ? 'Choose a website first.' : 'Podcasts visible on this website.'}>
                {(id) => (
                  <select id={id} value={pick} disabled={pods.loading || (isSuper && !form.tenant_id)} onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v && !form.podcast_ids.includes(v)) setForm({ ...form, podcast_ids: [...form.podcast_ids, v] });
                    setPick('');
                  }}>
                    <option value="">{pods.loading ? 'Loading…' : '— Choose podcast —'}</option>
                    {(pods.data?.data ?? []).filter((p) => !form.podcast_ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                )}
              </Field>
            </fieldset>
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </Modal>
    </>
  );
}
