'use client';

// Distribution platform registry (PRD §21): extensible, super admin manages it; everyone else reads it.
import { useState } from 'react';
import { ApiError, del, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Platform } from '@/lib/types';
import { Badge, Button, Checkbox, Empty, ErrorBox, Input, Modal, PageHeader, Select, Spinner, Textarea, useAction, useToast } from '@/components/ui';
import { PlatformName, usePlatforms } from '@/components/distribution/shared';

type Form = {
  name: string; key: string; website_url: string; submit_url: string; color: string; submission_type: 'MANUAL' | 'API';
  api_provider: string; url_pattern: string; instructions: string; is_active: boolean; sort_order: number;
  help_url: string; account_required: boolean; verification_required: boolean; supports_api: boolean; auto_discovery: boolean; notes: string;
};
const fullBody = (p: Platform, patch: Partial<Form> = {}) => ({
  key: p.key, name: p.name, website_url: p.website_url, submit_url: p.submit_url, color: p.color, submission_type: p.submission_type,
  api_provider: p.api_provider, url_pattern: p.url_pattern, instructions: p.instructions, is_active: p.is_active, sort_order: p.sort_order,
  help_url: p.help_url, account_required: p.account_required, verification_required: p.verification_required,
  supports_api: p.supports_api, auto_discovery: p.auto_discovery, notes: p.notes, ...patch,
});
const EMPTY: Form = { name: '', key: '', website_url: '', submit_url: '', color: '#1457ff', submission_type: 'MANUAL', api_provider: '', url_pattern: '', instructions: '', is_active: true, sort_order: 100, help_url: '', account_required: true, verification_required: false, supports_api: false, auto_discovery: false, notes: '' };

export default function PlatformsPage() {
  const { can } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const { data, error, loading, reload } = usePlatforms(false);
  const [editing, setEditing] = useState<Platform | 'new' | null>(null);
  const { run } = useAction();
  const toast = useToast();

  const remove = async (p: Platform) => {
    if (!window.confirm(`Delete platform "${p.name}"? This cannot be undone.`)) return;
    try {
      await del(`/platforms/${p.id}`);
      toast('success', 'Platform deleted');
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (window.confirm(`${e.message}\n\nDeactivate "${p.name}" instead? It will be hidden from new distributions but history is kept.`)) {
          const r = await run(() => put(`/platforms/${p.id}`, fullBody(p, { is_active: false })), 'Platform deactivated');
          if (r !== undefined) reload();
        }
      } else toast('error', e instanceof Error ? e.message : String(e));
    }
  };

  const sorted = [...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader back={{ href: '/distribution', label: 'Distribution' }} title="Distribution platforms"
        subtitle={isSuper ? 'The registry of listening platforms every podcast can be distributed to.' : 'Read-only: only super admins can change the registry.'}
        actions={isSuper && <Button variant="primary" onClick={() => setEditing('new')}>+ Add platform</Button>} />
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !sorted.length ? <Empty>No platforms yet.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Platform</th><th>Key</th><th>Type</th><th>Submit URL</th><th>Acct</th><th>Verify</th><th>Order</th><th>Active</th>{isSuper && <th><span className="sr-only">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong><PlatformName name={p.name} color={p.color} /></strong>
                    <div className="small muted mono">{p.color}{p.is_default && ' · default'}</div>
                  </td>
                  <td className="mono">{p.key}</td>
                  <td><Badge status={p.submission_type === 'API' ? 'READY' : 'NOT_STARTED'}>{p.submission_type}{p.api_provider && ` · ${p.api_provider}`}</Badge></td>
                  <td className="small" style={{ maxWidth: 220, wordBreak: 'break-all' }}>{p.submit_url ? <a href={p.submit_url} target="_blank" rel="noopener noreferrer">{p.submit_url}</a> : '—'}</td>
                  <td>{p.account_required ? '✓' : '—'}</td>
                  <td>{p.verification_required ? '✓' : '—'}</td>
                  <td>{p.sort_order}</td>
                  <td>{p.is_active ? <Badge status="ACTIVE" /> : <Badge status="DISABLED">Inactive</Badge>}</td>
                  {isSuper && (
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                        <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                        <Button size="sm" onClick={async () => { const r = await run(() => put(`/platforms/${p.id}`, fullBody(p, { is_active: !p.is_active })), p.is_active ? 'Deactivated' : 'Activated'); if (r !== undefined) reload(); }}>
                          {p.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => remove(p)}>Delete</Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isSuper && (
        <Modal title={editing === 'new' ? 'Add platform' : editing ? `Edit ${editing.name}` : 'Platform'} open={!!editing} onClose={() => setEditing(null)} wide>
          {editing && <PlatformForm key={editing === 'new' ? 'new' : editing.id} platform={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
        </Modal>
      )}
    </>
  );
}

function PlatformForm({ platform, onClose, onSaved }: { platform: Platform | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(platform ? {
    name: platform.name, key: platform.key, website_url: platform.website_url, submit_url: platform.submit_url, color: platform.color || '#1457ff',
    submission_type: platform.submission_type, api_provider: platform.api_provider, url_pattern: platform.url_pattern, instructions: platform.instructions,
    is_active: platform.is_active, sort_order: platform.sort_order,
    help_url: platform.help_url || '', account_required: platform.account_required, verification_required: platform.verification_required,
    supports_api: platform.supports_api, auto_discovery: platform.auto_discovery, notes: platform.notes || '',
  } : EMPTY);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const { run, busy } = useAction();
  const patternBad = !!f.url_pattern && !f.url_pattern.includes('{id}');

  const save = async () => {
    const body = { ...f, key: f.key.trim() || undefined, api_provider: f.submission_type === 'API' ? f.api_provider || 'podcastindex' : '', sort_order: Number(f.sort_order) || 0 };
    const r = await run(() => (platform ? put(`/platforms/${platform.id}`, body) : post('/platforms', body)), platform ? 'Platform saved' : 'Platform added');
    if (r !== undefined) { onSaved(); onClose(); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid-2">
        <Input label="Name" required value={f.name} onChange={(e) => set('name', e.target.value)} />
        <Input label="Key" value={f.key} onChange={(e) => set('key', e.target.value)} placeholder="auto from name" hint="Lowercase identifier, e.g. spotify. Leave empty to derive from the name." />
        <Input label="Website URL" type="url" value={f.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://…" />
        <Input label="Submit URL" type="url" value={f.submit_url} onChange={(e) => set('submit_url', e.target.value)} placeholder="https://…" hint="Where admins submit the RSS feed." />
        <Input label="Colour" type="color" value={f.color} onChange={(e) => set('color', e.target.value)} />
        <Input label="Sort order" type="number" value={f.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} />
        <Select label="Submission type" value={f.submission_type} onChange={(e) => set('submission_type', e.target.value as Form['submission_type'])}
          options={[{ value: 'MANUAL', label: 'Manual — admin submits and records the URL' }, { value: 'API', label: 'API — submitted through an official API' }]} />
        {f.submission_type === 'API' ? (
          <Select label="API provider" value={f.api_provider || 'podcastindex'} onChange={(e) => set('api_provider', e.target.value)} options={[{ value: 'podcastindex', label: 'Podcast Index' }]}
            hint="Requires API credentials in System settings." />
        ) : <div />}
      </div>
      <Input label="Listing URL pattern" value={f.url_pattern} onChange={(e) => set('url_pattern', e.target.value)} placeholder="https://open.example.com/show/{id}"
        hint="Use {id} where the external ID goes — lets admins mark LIVE with just an ID." />
      {patternBad && <p className="field-error" role="alert">The pattern must contain {'{id}'}.</p>}
      <Textarea label="Instructions" rows={4} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} hint="Step-by-step submission guide shown to admins." />
      <Input label="Help / documentation URL" type="url" value={f.help_url} onChange={(e) => set('help_url', e.target.value)} placeholder="https://…" hint="Official guide or help article." />
      <Textarea label="Notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} hint="Internal notes about this platform (caveats, regional limits, etc)." />
      <div className="grid-2" style={{ marginTop: 8 }}>
        <Checkbox label="Account required" checked={f.account_required} onChange={(v) => set('account_required', v)} hint="Operator needs an account on this platform" />
        <Checkbox label="Verification required" checked={f.verification_required} onChange={(v) => set('verification_required', v)} hint="Platform requires ownership verification" />
        <Checkbox label="Supports API" checked={f.supports_api} onChange={(v) => set('supports_api', v)} hint="Has an official submission API" />
        <Checkbox label="Auto-discovery" checked={f.auto_discovery} onChange={(v) => set('auto_discovery', v)} hint="May index from Apple/other catalogs automatically" />
      </div>
      <Checkbox label="Active" checked={f.is_active} onChange={(v) => set('is_active', v)} hint="Inactive platforms are hidden from new distributions" />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!f.name.trim() || patternBad}>Save</Button>
      </div>
    </form>
  );
}
