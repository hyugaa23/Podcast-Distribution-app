'use client';

import { useState } from 'react';
import { del, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Category } from '@/lib/types';
import { Button, ConfirmButton, Empty, ErrorBox, Input, Modal, PageHeader, Select, Spinner, Textarea, useAction, useAsync } from '@/components/ui';

interface Form { id?: number; name: string; slug: string; parent_id: number; description: string; itunes_name: string; sort_order: string }

export default function CategoriesPage() {
  const { can } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const { data, error, loading, reload } = useAsync(() => get<Category[]>('/categories'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [q, setQ] = useState('');
  const { run, busy } = useAction();

  const all = data ?? [];
  const sorter = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const parents = all.filter((c) => !c.parent_id).sort(sorter);
  const childrenOf = (id: number) => all.filter((c) => c.parent_id === id).sort(sorter);
  const needle = q.trim().toLowerCase();
  const match = (c: Category) => !needle || c.name.toLowerCase().includes(needle) || c.itunes_name?.toLowerCase().includes(needle);

  const openNew = (parent = 0) => setForm({ name: '', slug: '', parent_id: parent, description: '', itunes_name: '', sort_order: '0' });
  const openEdit = (c: Category) => setForm({ id: c.id, name: c.name, slug: c.slug, parent_id: c.parent_id ?? 0, description: c.description ?? '', itunes_name: c.itunes_name ?? '', sort_order: String(c.sort_order ?? 0) });

  const save = async () => {
    if (!form || !form.name.trim()) return;
    const body = {
      name: form.name.trim(), slug: form.slug.trim(), parent_id: form.parent_id || null, description: form.description,
      itunes_name: form.itunes_name.trim(), sort_order: Number(form.sort_order) || 0,
    };
    const r = await run(async () => { if (form.id) await put(`/categories/${form.id}`, body); else await post('/categories', body); return true; }, form.id ? 'Category saved' : 'Category created');
    if (r) { setForm(null); reload(); }
  };
  const remove = async (c: Category) => {
    const ok = await run(async () => { await del(`/categories/${c.id}`); return true; }, 'Category deleted');
    if (ok) reload();
  };

  if (!isSuper) return <><PageHeader title="Categories" /><Empty>Only super admins can manage categories.</Empty></>;

  const Row = ({ c, isChild }: { c: Category; isChild?: boolean }) => (
    <div className="c-tree__row">
      <span className="grow">
        <strong>{c.name}</strong> <span className="muted small">/{c.slug}</span>
        {c.itunes_name && c.itunes_name !== c.name && <div className="muted small">Apple: {c.itunes_name}</div>}
      </span>
      <span className="muted small" style={{ minWidth: 90 }}>{c.podcast_count} podcast{c.podcast_count === 1 ? '' : 's'}</span>
      <span className="muted small" style={{ minWidth: 60 }}>order {c.sort_order}</span>
      <span className="row">
        {!isChild && <Button size="sm" variant="ghost" onClick={() => openNew(c.id)} aria-label={`Add subcategory to ${c.name}`}>+ Sub</Button>}
        <Button size="sm" onClick={() => openEdit(c)}>Edit</Button>
        <ConfirmButton size="sm" variant="danger" onConfirm={() => remove(c)}
          confirm={`Delete “${c.name}”?${!isChild && childrenOf(c.id).length ? ' Its subcategories will be affected too.' : ''}${c.podcast_count ? ` ${c.podcast_count} podcast(s) will lose this category.` : ''}`}>Delete</ConfirmButton>
      </span>
    </div>
  );

  const visibleParents = parents.filter((p) => match(p) || childrenOf(p.id).some(match));

  return (
    <>
      <PageHeader title="Categories" subtitle="Network-wide taxonomy (mapped to Apple Podcasts categories)" actions={<Button variant="primary" onClick={() => openNew()}>+ New category</Button>} />
      <div className="c-filters"><Input label="Filter" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Category name…" /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : visibleParents.length === 0 ? (
        <Empty>{q ? 'No categories match.' : 'No categories yet.'}</Empty>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <ul className="c-tree" aria-label="Categories">
            {visibleParents.map((p) => {
              const kids = childrenOf(p.id).filter((k) => match(k) || match(p));
              return (
                <li key={p.id}>
                  <Row c={p} />
                  {kids.length > 0 && <ul>{kids.map((k) => <li key={k.id}><Row c={k} isChild /></li>)}</ul>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal title={form?.id ? `Edit category — ${form.name}` : 'New category'} open={!!form} onClose={() => setForm(null)}
        footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form?.name.trim()}>{form?.id ? 'Save' : 'Create'}</Button></>}>
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid-2">
              <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Slug" value={form.slug} onChange={(e) => {
                const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                setForm({ ...form, slug: val });
              }} pattern="[a-z0-9-]+" placeholder="auto from name" />
            </div>
            <Select label="Parent" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: Number(e.target.value) })}
              hint="Choose a parent to make this a subcategory."
              options={[{ value: 0, label: '— Top level —' }, ...parents.filter((p) => p.id !== form.id).map((p) => ({ value: p.id, label: p.name }))]} />
            <div className="grid-2">
              <Input label="iTunes / Apple name" value={form.itunes_name} onChange={(e) => setForm({ ...form, itunes_name: e.target.value })} hint="Exact Apple Podcasts category name used in RSS." />
              <Input label="Sort order" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
            <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </Modal>
    </>
  );
}
