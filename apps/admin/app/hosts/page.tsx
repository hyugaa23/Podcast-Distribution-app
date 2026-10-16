'use client';

import { useState } from 'react';
import { del, get, post, put, uploadFile } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Host } from '@/lib/types';
import { Button, ConfirmButton, Empty, ErrorBox, ImageUpload, Input, Modal, PageHeader, Select, Spinner, Textarea, useAction, useAsync } from '@/components/ui';
import { RowsEditor, useCanEdit } from '@/components/content/common';
import { Icon } from '@/components/icons';

interface HostForm { id?: number; name: string; slug: string; photo_url: string; bio: string; website_url: string; email: string; social: { key: string; value: string }[]; tenant_id: number }

const emptyForm = (tenantId: number): HostForm => ({ name: '', slug: '', photo_url: '', bio: '', website_url: '', email: '', social: [], tenant_id: tenantId });

export default function HostsPage() {
  const { can, scopeTenantId, tenants } = useAuth();
  const tq = useTenantQuery();
  const canEdit = useCanEdit();
  const canDelete = can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR');
  const isSuper = can('SUPER_ADMIN');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useAsync(() => get<Host[]>('/hosts', tq), [scopeTenantId]);
  const [form, setForm] = useState<HostForm | null>(null);
  const { run, busy } = useAction();

  const rows = (data ?? []).filter((h) => !q.trim() || h.name.toLowerCase().includes(q.trim().toLowerCase()));
  const tenantName = (id: number | null) => (id ? tenants.find((t) => t.id === id)?.name ?? `#${id}` : 'Network');

  const openEdit = async (h: Host) => {
    // The list may omit private fields (email) — fetch the full record.
    const full = (await run(() => get<Host>(`/hosts/${h.id}`))) ?? h;
    setForm({
      id: full.id, name: full.name, slug: full.slug, photo_url: full.photo_url ?? '', bio: full.bio ?? '', website_url: full.website_url ?? '', email: full.email ?? '',
      social: Object.entries(full.social_links ?? {}).map(([key, value]) => ({ key, value })), tenant_id: full.owner_tenant_id ?? 0,
    });
  };

  const save = async () => {
    if (!form || !form.name.trim()) return;
    const body = {
      name: form.name.trim(), slug: form.slug.trim(), photo_url: form.photo_url.trim(), bio: form.bio, website_url: form.website_url.trim(), email: form.email.trim(),
      social_links: Object.fromEntries(form.social.filter((s) => s.key.trim() && s.value.trim()).map((s) => [s.key.trim().toLowerCase(), s.value.trim()])),
    };
    const r = await run(
      () => (form.id ? put<Host>(`/hosts/${form.id}`, body) : post<Host>('/hosts', body, isSuper && form.tenant_id ? { tenant_id: form.tenant_id } : undefined)),
      form.id ? 'Host saved' : 'Host created — you can now upload a photo',
    );
    if (r) {
      reload();
      if (form.id) setForm(null);
      else setForm({ ...form, id: r.id, slug: r.slug });
    }
  };

  const remove = async (h: Host) => {
    const ok = await run(async () => { await del(`/hosts/${h.id}`); return true; }, 'Host deleted');
    if (ok) reload();
  };

  return (
    <>
      <PageHeader title="Hosts" subtitle="People who host or appear on your podcasts"
        actions={canEdit && <Button variant="primary" onClick={() => setForm(emptyForm(scopeTenantId ?? 0))}>+ New host</Button>} />
      <div className="c-filters">
        <Input label="Filter" type="search" placeholder="Name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty>{q ? 'No hosts match.' : 'No hosts yet.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 52 }}><span className="sr-only">Photo</span></th><th>Name</th>{isSuper && <th>Owner</th>}<th>Website</th><th>Podcasts</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td>{h.photo_url ? <img src={h.photo_url} alt="" className="thumb" style={{ borderRadius: '50%' }} /> : <span className="thumb c-thumb--empty" style={{ borderRadius: '50%' }} aria-hidden="true"><Icon name="users" /></span>}</td>
                  <td>
                    {canEdit ? <button type="button" className="link cell-title" onClick={() => openEdit(h)}>{h.name}</button> : <strong>{h.name}</strong>}
                    <div className="muted small">/{h.slug}{h.social_links && Object.keys(h.social_links).length > 0 && ` · ${Object.keys(h.social_links).join(', ')}`}</div>
                  </td>
                  {isSuper && <td className="small">{tenantName(h.owner_tenant_id)}</td>}
                  <td className="small">{h.website_url ? <a href={h.website_url} target="_blank" rel="noopener noreferrer">{h.website_url.replace(/^https?:\/\//, '')}</a> : <span className="muted">—</span>}</td>
                  <td>{h.podcast_count}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {canEdit && <Button size="sm" onClick={() => openEdit(h)}>Edit</Button>}
                      {canDelete && <ConfirmButton size="sm" variant="danger" confirm={`Delete host “${h.name}”? They will be removed from ${h.podcast_count} podcast(s).`} onConfirm={() => remove(h)}>Delete</ConfirmButton>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal title={form?.id ? `Edit host — ${form.name}` : 'New host'} open={!!form} onClose={() => setForm(null)} wide
        footer={<><Button onClick={() => setForm(null)}>{form?.id ? 'Close' : 'Cancel'}</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form?.name.trim()}>{form?.id ? 'Save' : 'Create host'}</Button></>}>
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid-2">
              <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Slug" value={form.slug} onChange={(e) => {
                const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                setForm({ ...form, slug: val });
              }} pattern="[a-z0-9-]+" placeholder="auto from name" />
            </div>
            {isSuper && !form.id && (
              <Select label="Owner site" value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: Number(e.target.value) })}
                options={[{ value: 0, label: 'Network (shared)' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
            )}
            {form.id ? (
              <ImageUpload label="Photo" value={form.photo_url} hint="Square JPG/PNG/WebP."
                onUpload={async (f) => { const r = await uploadFile('host_photo', form.id!, f); setForm((x) => (x ? { ...x, photo_url: r.url } : x)); reload(); }} />
            ) : <p className="hint">Create the host first to upload a photo, or paste a photo URL below.</p>}
            <Input label="Photo URL" type="url" value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} placeholder="https://" />
            <Textarea label="Bio" rows={4} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} hint="Basic HTML allowed." />
            <div className="grid-2">
              <Input label="Website" type="url" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} placeholder="https://" />
              <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} hint="Not shown publicly." />
            </div>
            <RowsEditor legend="Social links" rows={form.social} onChange={(social) => setForm({ ...form, social })} empty={{ key: '', value: '' }} addLabel="+ Add link"
              fields={[{ key: 'key', label: 'Network', placeholder: 'x, linkedin, instagram…' }, { key: 'value', label: 'URL', type: 'url', placeholder: 'https://' }]} />
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </Modal>
    </>
  );
}
