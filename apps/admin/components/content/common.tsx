'use client';

// Shared helpers for the Content area (podcasts, episodes, hosts, collections, categories).
import { useMemo, useState, type ReactNode } from 'react';
import { get, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Category, Host } from '@/lib/types';
import { Button, Field, Select, useAction, useAsync } from '@/components/ui';
import { Icon } from '../icons';

export const PODCAST_STATUSES = ['DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED'] as const;
export const EPISODE_STATUSES = ['DRAFT', 'PROCESSING', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'ARCHIVED'] as const;
export const HOST_ROLES = ['host', 'co-host', 'guest', 'producer', 'narrator'];
export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' }, { value: 'id', label: 'Indonesian' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }, { value: 'it', label: 'Italian' }, { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' }, { value: 'ko', label: 'Korean' }, { value: 'zh', label: 'Chinese' }, { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' }, { value: 'ms', label: 'Malay' },
];

export type HostLink = { host_id: number; role: string };

/** Roles that may create/edit content. */
export function useCanEdit() {
  const { can } = useAuth();
  return can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR', 'CREATOR');
}

export function parseTags(s: string): string[] {
  return Array.from(new Set(s.split(',').map((t) => t.trim()).filter(Boolean)));
}

export function numOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Formats an ISO instant as a `YYYY-MM-DDTHH:MM` value in the given IANA timezone (for datetime-local inputs). */
export function isoToZonedInput(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
  } catch {
    return d.toISOString().slice(0, 16);
  }
}

/** Timezone of the site that owns a piece of content (library content uses UTC on the backend). */
export function useOwnerTimezone(ownerTenantId: number | null | undefined): string {
  const { tenants } = useAuth();
  if (!ownerTenantId) return 'UTC';
  return tenants.find((t) => t.id === ownerTenantId)?.timezone || 'UTC';
}

export function useCategories() {
  const r = useAsync(() => get<Category[]>('/categories'), []);
  const all = r.data ?? [];
  const parents = all.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const childrenOf = (id: number | null | undefined) =>
    id ? all.filter((c) => c.parent_id === id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)) : [];
  return { ...r, all, parents, childrenOf };
}

export function useHosts() {
  const tq = useTenantQuery();
  const { scopeTenantId } = useAuth();
  return useAsync(() => get<Host[]>('/hosts', tq), [scopeTenantId]);
}

/** Category + subcategory pair of selects (subcategories are categories with parent_id). */
export function CategorySelects({ categoryId, subcategoryId, onChange, disabled }: {
  categoryId: number | null; subcategoryId: number | null; disabled?: boolean;
  onChange: (categoryId: number | null, subcategoryId: number | null) => void;
}) {
  const { parents, childrenOf, loading } = useCategories();
  const subs = childrenOf(categoryId);
  return (
    <div className="grid-2">
      <Select label="Category" disabled={disabled || loading} value={categoryId ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, null)}
        options={[{ value: '', label: loading ? 'Loading…' : '— None —' }, ...parents.map((c) => ({ value: c.id, label: c.name }))]} />
      <Select label="Subcategory" disabled={disabled || !subs.length} value={subcategoryId ?? ''}
        onChange={(e) => onChange(categoryId, e.target.value ? Number(e.target.value) : null)}
        hint={categoryId && !subs.length ? 'This category has no subcategories' : undefined}
        options={[{ value: '', label: '— None —' }, ...subs.map((c) => ({ value: c.id, label: c.name }))]} />
    </div>
  );
}

/** Edits a list of host assignments ({host_id, role}) with an inline "quick add host". */
export function HostsEditor({ value, onChange, label = 'Hosts', defaultRole = 'host', disabled }: {
  value: HostLink[]; onChange: (v: HostLink[]) => void; label?: string; defaultRole?: string; disabled?: boolean;
}) {
  const hosts = useHosts();
  const tq = useTenantQuery();
  const { run, busy } = useAction();
  const [pick, setPick] = useState('');
  const [newName, setNewName] = useState('');
  const list = hosts.data ?? [];
  const byId = useMemo(() => new Map(list.map((h) => [h.id, h])), [list]);
  const available = list.filter((h) => !value.some((v) => v.host_id === h.id));

  const add = (id: number) => {
    if (!id || value.some((v) => v.host_id === id)) return;
    onChange([...value, { host_id: id, role: defaultRole }]);
    setPick('');
  };
  const quickAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const h = await run(() => post<Host>('/hosts', { name }, tq), `Host “${name}” created`);
    if (h) {
      setNewName('');
      hosts.reload();
      onChange([...value, { host_id: h.id, role: defaultRole }]);
    }
  };

  return (
    <fieldset className="c-fieldset" disabled={disabled}>
      <legend>{label}</legend>
      {value.length === 0 ? <p className="muted small">None assigned.</p> : (
        <ul className="sortable">
          {value.map((v, i) => {
            const h = byId.get(v.host_id);
            return (
              <li key={v.host_id}>
                {h?.photo_url ? <img src={h.photo_url} alt="" className="c-avatar" /> : <span className="c-avatar c-avatar--empty" aria-hidden="true"><Icon name="users" /></span>}
                <span className="grow">{h?.name ?? `Host #${v.host_id}`}</span>
                <label className="sr-only" htmlFor={`role-${label}-${v.host_id}`}>Role for {h?.name ?? v.host_id}</label>
                <select id={`role-${label}-${v.host_id}`} className="input c-inline-select" value={v.role}
                  onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                  {Array.from(new Set([...HOST_ROLES, v.role])).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Button size="sm" variant="ghost" aria-label={`Remove ${h?.name ?? 'host'}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid-2" style={{ marginTop: 8 }}>
        <Field label={`Add ${defaultRole === 'guest' ? 'guest' : 'host'}`}>
          {(id) => (
            <select id={id} value={pick} disabled={hosts.loading} onChange={(e) => add(Number(e.target.value))}>
              <option value="">{hosts.loading ? 'Loading…' : available.length ? '— Choose existing —' : 'No more hosts'}</option>
              {available.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Quick add new host">
          {(id) => (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id={id} className="input" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); quickAdd(); } }} />
              <Button size="sm" onClick={quickAdd} loading={busy} disabled={!newName.trim()}>Add</Button>
            </div>
          )}
        </Field>
      </div>
    </fieldset>
  );
}

/** Editable list of rows (key/value pairs, FAQ items, citations…). */
export function RowsEditor<T extends Record<string, string>>({ legend, rows, onChange, fields, empty, addLabel }: {
  legend: string; rows: T[]; onChange: (rows: T[]) => void; empty: T; addLabel: string;
  fields: { key: keyof T & string; label: string; placeholder?: string; multiline?: boolean; type?: string }[];
}) {
  return (
    <fieldset className="c-fieldset">
      <legend>{legend}</legend>
      {rows.length === 0 && <p className="muted small">Nothing added yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="c-rowedit">
          {fields.map((f) => (
            <Field key={f.key} label={`${f.label} ${i + 1}`}>
              {(id) => f.multiline
                ? <textarea id={id} rows={2} placeholder={f.placeholder} value={r[f.key]} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))} />
                : <input id={id} type={f.type ?? 'text'} placeholder={f.placeholder} value={r[f.key]} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))} />}
            </Field>
          ))}
          <Button size="sm" variant="danger" className="c-rowedit__remove" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...rows, { ...empty }])}>{addLabel}</Button>
    </fieldset>
  );
}

/** Result of a bulk operation. */
export function BulkResult({ result, onClose, noun }: { result: { ok: number[]; skipped: number[] } | null; onClose: () => void; noun: string }) {
  if (!result) return null;
  return (
    <div className={`alert ${result.skipped.length ? 'alert--warn' : 'alert--success'} row row--between`} role="status">
      <span>
        ✓ {result.ok.length} {noun}{result.ok.length === 1 ? '' : 's'} updated
        {result.skipped.length > 0 && <> · {result.skipped.length} skipped (no permission or not eligible: #{result.skipped.join(', #')})</>}
      </span>
      <Button size="sm" variant="ghost" onClick={onClose} aria-label="Dismiss result">✕</Button>
    </div>
  );
}

export function Thumb({ src, alt = '' }: { src?: string; alt?: string }) {
  return src ? <img src={src} alt={alt} className="thumb" loading="lazy" /> : <span className="thumb c-thumb--empty" aria-hidden="true"><Icon name="podcasts" /></span>;
}

/** Step indicator for wizards. */
export function Steps({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (i: number) => void }) {
  return (
    <ol className="c-steps" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}>
          {onJump && i < current
            ? <button type="button" className="link" onClick={() => onJump(i)}><span className="c-steps__n">{i < current ? '✓' : i + 1}</span>{s}</button>
            : <span><span className="c-steps__n">{i < current ? '✓' : i + 1}</span>{s}</span>}
        </li>
      ))}
    </ol>
  );
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="c-section">
      <h3>{title}</h3>
      {hint && <p className="muted small" style={{ marginTop: 0 }}>{hint}</p>}
      {children}
    </div>
  );
}
