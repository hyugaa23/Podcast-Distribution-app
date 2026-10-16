'use client';

// Shared helpers for the Network & Administration area (websites, domains, users, keys, system).
import { useState, type ReactNode } from 'react';
import type { Tenant, Theme } from '@/lib/types';
import { Button, Field, useToast } from '@/components/ui';

/** Public URL for a tenant host: http for *.localhost / localhost, https otherwise. */
export function siteUrl(host?: string | null, path = ''): string {
  if (!host) return '';
  const h = host.toLowerCase();
  const local = h === 'localhost' || h.endsWith('.localhost') || h.startsWith('localhost:') || /\.localhost:\d+$/.test(h);
  return `${local ? 'http' : 'https'}://${host}${path}`;
}

export const CONTENT_MODES: { value: Tenant['content_mode']; label: string; help: string }[] = [
  { value: 'INDEPENDENT', label: 'Independent', help: 'Podcasts are only available on this website.' },
  { value: 'SHARED', label: 'Shared', help: 'Podcasts come from the central network library.' },
  { value: 'SYNDICATED', label: 'Syndicated', help: 'Podcasts can be published on several websites while keeping one source record.' },
];

export const LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'id', label: 'Indonesian' }, { value: 'es', label: 'Spanish' }, { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'it', label: 'Italian' }, { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' }, { value: 'ko', label: 'Korean' }, { value: 'zh', label: 'Chinese' }, { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' }, { value: 'ms', label: 'Malay' }, { value: 'th', label: 'Thai' }, { value: 'vi', label: 'Vietnamese' },
];

export const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'America/Mexico_City', 'America/Toronto',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Istanbul', 'Africa/Lagos', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Manila', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
];

export const GOOGLE_FONTS = ['Inter', 'Playfair Display', 'Source Serif 4', 'Roboto', 'Roboto Condensed', 'DM Sans', 'Poppins', 'Bebas Neue', 'Barlow',
  'Space Grotesk', 'JetBrains Mono', 'Archivo Black', 'Nunito', 'Cormorant Garamond', 'Lora'];

export function themeLabel(t: Pick<Theme, 'number' | 'name'>) {
  return `Theme ${String(t.number).padStart(2, '0')} — ${t.name}`;
}

/** Visual theme picker (PRD §40–50). */
export function ThemePicker({ themes, value, onChange, label = 'Theme' }: { themes: Theme[]; value: string; onChange: (key: string) => void; label?: string }) {
  return (
    <fieldset className="nw-fieldset">
      <legend>{label}</legend>
      <div className="theme-picker">
        {themes.map((t) => {
          const c = t.default_config ?? {};
          return (
            <button key={t.key} type="button" className="theme-opt" aria-pressed={value === t.key} onClick={() => onChange(t.key)}
              aria-label={`${themeLabel(t)}: ${t.description}`}>
              <div className="theme-opt__swatch" style={{ background: c.background || '#fff' }} aria-hidden="true">
                <i style={{ background: c.primary }} /><i style={{ background: c.secondary }} /><i style={{ background: c.accent || c.primary }} />
              </div>
              <div className="theme-opt__body">
                <strong>{String(t.number).padStart(2, '0')} · {t.name}</strong>
                <small>{t.description}</small>
              </div>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Select of IANA zones with free-text fallback. */
export function TimezoneField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = TIMEZONES.includes(value);
  const [custom, setCustom] = useState(!known && !!value);
  return (
    <Field label="Timezone" hint={custom ? 'Any IANA zone name, e.g. Europe/Lisbon' : undefined}>
      {(id) => (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {custom ? (
            <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Region/City" />
          ) : (
            <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
              {!value && <option value="">Select…</option>}
              {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          )}
          <Button size="sm" variant="ghost" onClick={() => setCustom((c) => !c)}>{custom ? 'List' : 'Other…'}</Button>
        </div>
      )}
    </Field>
  );
}

export function ColorField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <Field label={label}>
      {(id) => (
        <div className="nw-color">
          <input type="color" aria-label={`${label} picker`} value={valid ? value : (placeholder && /^#[0-9a-fA-F]{6}$/.test(placeholder) ? placeholder : '#000000')}
            onChange={(e) => onChange(e.target.value.toUpperCase())} />
          <input id={id} value={value} placeholder={placeholder || '#RRGGBB'} onChange={(e) => onChange(e.target.value)} className="mono" />
        </div>
      )}
    </Field>
  );
}

/** Tenant select (super admin). */
export function TenantSelect({ tenants, value, onChange, label = 'Website', allowAll, allLabel = 'All sites', required }:
  { tenants: Tenant[]; value: number | ''; onChange: (v: number | '') => void; label?: string; allowAll?: boolean; allLabel?: string; required?: boolean }) {
  return (
    <Field label={label} required={required}>
      {(id) => (
        <select id={id} value={value} required={required} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
          <option value="">{allowAll ? allLabel : 'Select a website…'}</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.primary_domain ? ` — ${t.primary_domain}` : ''}</option>)}
        </select>
      )}
    </Field>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Button size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast('success', 'Copied to clipboard'); } catch { toast('error', 'Copy failed — select the text manually'); }
    }}>{label}</Button>
  );
}

/** Secret shown once (API key / webhook secret). */
export function SecretOnce({ value, title, children }: { value: string; title: string; children?: ReactNode }) {
  return (
    <div className="alert alert--success">
      <strong>{title}</strong>
      <p className="small" style={{ margin: '4px 0 8px' }}>Copy it now — it will not be shown again.</p>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <code className="nw-secret mono">{value}</code>
        <CopyButton text={value} />
      </div>
      {children}
    </div>
  );
}

/** Editable key/value rows (social links, theme overrides). */
export function KeyValueRows({ rows, onChange, keyLabel = 'Key', valueLabel = 'Value', keyPlaceholder, valuePlaceholder, addLabel = '+ Add row' }:
  { rows: [string, string][]; onChange: (r: [string, string][]) => void; keyLabel?: string; valueLabel?: string; keyPlaceholder?: string; valuePlaceholder?: string; addLabel?: string }) {
  const set = (i: number, k: 0 | 1, v: string) => onChange(rows.map((r, j) => (j === i ? (k === 0 ? [v, r[1]] : [r[0], v]) : r)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="nw-kv-row">
          <input aria-label={`${keyLabel} ${i + 1}`} value={r[0]} placeholder={keyPlaceholder} onChange={(e) => set(i, 0, e.target.value)} className="input" />
          <input aria-label={`${valueLabel} ${i + 1}`} value={r[1]} placeholder={valuePlaceholder} onChange={(e) => set(i, 1, e.target.value)} className="input" />
          <Button size="sm" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
      <div><Button size="sm" onClick={() => onChange([...rows, ['', '']])}>{addLabel}</Button></div>
    </div>
  );
}

export function toRows(o?: Record<string, unknown> | null): [string, string][] {
  return Object.entries(o ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
}
export function fromRows(rows: [string, string][]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of rows) if (k.trim()) o[k.trim()] = v.trim();
  return o;
}

/** Simple "Yes/No" boolean display. */
export function YesNo({ v }: { v: boolean }) {
  return v ? <span className="badge badge--green">Yes</span> : <span className="badge badge--gray">No</span>;
}

/** Access-denied card for role-restricted pages. */
export function NoAccess({ what = 'this page' }: { what?: string }) {
  return <div className="alert alert--warn" role="alert">You do not have permission to view {what}.</div>;
}
