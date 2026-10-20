'use client';

import { useState } from 'react';
import { put } from '@/lib/api';
import type { HomepageSection, NavItem, Tenant, TenantSettings } from '@/lib/types';
import { Button, Card, Empty, useAction } from '@/components/ui';

export function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const SECTION_TYPES: { type: string; label: string; title: string; limit?: number }[] = [
  { type: 'hero', label: 'Hero', title: '' },
  { type: 'featured', label: 'Featured Podcasts', title: 'Featured Podcasts', limit: 8 },
  { type: 'trending', label: 'Trending', title: 'Trending', limit: 10 },
  { type: 'latest_episodes', label: 'Latest Episodes', title: 'Latest Episodes', limit: 8 },
  { type: 'popular', label: 'Popular Shows', title: 'Popular Shows', limit: 10 },
  { type: 'categories', label: 'Categories', title: 'Categories', limit: 12 },
  { type: 'editors_picks', label: "Editor's Picks", title: "Editor's Picks", limit: 6 },
  { type: 'new_podcasts', label: 'New Podcasts', title: 'New Podcasts', limit: 8 },
  { type: 'collections', label: 'Collections', title: 'Collections', limit: 6 },
  { type: 'newsletter', label: 'Follow / Social', title: 'Follow the show' },
  { type: 'cta', label: 'Call to action', title: 'Never miss an episode' },
];
const HAS_LIMIT = new Set(SECTION_TYPES.filter((s) => s.limit).map((s) => s.type));
const HAS_BUTTON = new Set(['cta', 'newsletter']);

function SortControls({ i, n, onMove, name }: { i: number; n: number; onMove: (dir: -1 | 1) => void; name: string }) {
  return (
    <span className="nw-sort">
      <button type="button" className="icon-btn" disabled={i === 0} onClick={() => onMove(-1)} aria-label={`Move ${name} up`}>↑</button>
      <button type="button" className="icon-btn" disabled={i === n - 1} onClick={() => onMove(1)} aria-label={`Move ${name} down`}>↓</button>
    </span>
  );
}

/** Homepage page builder (PRD §53): enable / disable / reorder sections. */
export function HomepageTab({ tenant, settings, onSaved }: { tenant: Tenant; settings: TenantSettings; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [items, setItems] = useState<HomepageSection[]>(settings.homepage_sections ?? []);
  const [dirty, setDirty] = useState(false);
  const update = (next: HomepageSection[]) => { setItems(next); setDirty(true); };
  const patch = (i: number, p: Partial<HomepageSection>) => update(items.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const missing = SECTION_TYPES.filter((t) => !items.some((s) => s.type === t.type));
  const label = (type: string) => SECTION_TYPES.find((t) => t.type === type)?.label ?? type;

  const save = async () => {
    const r = await run(() => put(`/tenants/${tenant.id}/settings`, { homepage_sections: items }), 'Homepage saved');
    if (r !== undefined) { setDirty(false); onSaved(); }
  };

  return (
    <div className="stack">
      <Card title="Homepage sections" actions={<span className="small muted">{items.filter((s) => s.enabled).length} of {items.length} enabled</span>}>
        <p className="hint" style={{ marginBottom: 10 }}>Sections render top-to-bottom in this order on the homepage. Disabled sections are hidden but keep their settings.</p>
        {items.length === 0 ? <Empty>No sections. Add one below.</Empty> : (
          <ol className="sortable">
            {items.map((s, i) => (
              <li key={`${s.type}-${i}`} className={s.enabled ? '' : 'nw-off'}>
                <SortControls i={i} n={items.length} name={label(s.type)} onMove={(d) => update(move(items, i, d))} />
                <div className="grow stack" style={{ gap: 6 }}>
                  <div className="row row--between">
                    <strong>{i + 1}. {label(s.type)} <span className="small muted mono">{s.type}</span></strong>
                    <div className="row">
                      <label className="check" style={{ margin: 0 }}>
                        <input type="checkbox" checked={s.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                        <span>{s.enabled ? 'Enabled' : 'Disabled'}</span>
                      </label>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${label(s.type)}`} onClick={() => update(items.filter((_, j) => j !== i))}>Remove</Button>
                    </div>
                  </div>
                  <div className="nw-inline-fields">
                    <label>Title<input className="input" value={s.title ?? ''} onChange={(e) => patch(i, { title: e.target.value })} placeholder={s.type === 'hero' ? 'Defaults to site tagline' : ''} /></label>
                    <label>Subtitle<input className="input" value={s.subtitle ?? ''} onChange={(e) => patch(i, { subtitle: e.target.value || undefined })} /></label>
                    {HAS_LIMIT.has(s.type) && (
                      <label className="nw-narrow">Limit<input className="input" type="number" min={1} max={50} value={s.limit ?? ''}
                        onChange={(e) => patch(i, { limit: e.target.value ? Math.max(1, Math.min(50, Number(e.target.value))) : undefined })} /></label>
                    )}
                    {HAS_BUTTON.has(s.type) && (
                      <label>Button label<input className="input" value={s.button_label ?? ''} onChange={(e) => patch(i, { button_label: e.target.value || undefined })} /></label>
                    )}
                    {s.type === 'cta' && (
                      <label>Button link<input className="input" value={s.button_href ?? ''} onChange={(e) => patch(i, { button_href: e.target.value || undefined })} placeholder="/podcasts" /></label>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {missing.length > 0 && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small muted">Add section:</span>
            {missing.map((m) => (
              <Button key={m.type} size="sm" onClick={() => update([...items, { type: m.type, enabled: true, title: m.title, ...(m.limit ? { limit: m.limit } : {}),
                ...(m.type === 'cta' ? { button_label: 'Browse podcasts', button_href: '/podcasts' } : {}), ...(m.type === 'newsletter' ? { button_label: 'Subscribe' } : {}) }])}>
                + {m.label}
              </Button>
            ))}
          </div>
        )}
      </Card>
      <div className="row">
        <Button variant="primary" loading={busy} onClick={save}>Save homepage</Button>
        {dirty && <span className="small muted">Unsaved changes</span>}
      </div>
    </div>
  );
}

const NAV_TYPES: { type: string; label: string; href: string }[] = [
  { type: 'home', label: 'Home', href: '/' }, { type: 'podcasts', label: 'Podcasts', href: '/podcasts' },
  { type: 'episodes', label: 'Episodes', href: '/episodes' }, { type: 'categories', label: 'Categories', href: '/categories' },
  { type: 'hosts', label: 'Hosts', href: '/hosts' }, { type: 'collections', label: 'Collections', href: '/collections' },
  { type: 'about', label: 'About', href: '/about' }, { type: 'search', label: 'Search', href: '/search' },
  { type: 'custom', label: 'Custom link', href: '' },
];

/** Navigation manager (PRD §54). */
export function NavigationTab({ tenant, settings, onSaved }: { tenant: Tenant; settings: TenantSettings; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [items, setItems] = useState<NavItem[]>(settings.navigation ?? []);
  const [dirty, setDirty] = useState(false);
  const update = (next: NavItem[]) => { setItems(next); setDirty(true); };
  const patch = (i: number, p: Partial<NavItem>) => update(items.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const changeType = (i: number, type: string) => {
    const t = NAV_TYPES.find((x) => x.type === type)!;
    const cur = items[i];
    const prev = NAV_TYPES.find((x) => x.type === cur.type);
    const label = !cur.label || cur.label === prev?.label ? (type === 'custom' ? cur.label : t.label) : cur.label;
    patch(i, { type, href: type === 'custom' ? (cur.type === 'custom' ? cur.href : '') : t.href, label });
  };
  const invalid = items.some((n) => !n.label.trim() || !n.href.trim());

  const save = async () => {
    const navigation = items.map((n) => ({ ...n, label: n.label.trim(), href: n.href.trim(), ...(n.type === 'custom' ? { external: /^https?:\/\//.test(n.href.trim()) } : {}) }));
    const r = await run(() => put(`/tenants/${tenant.id}/settings`, { navigation }), 'Navigation saved');
    if (r !== undefined) { setDirty(false); onSaved(); }
  };

  return (
    <div className="stack">
      <Card title="Main navigation" actions={<Button size="sm" onClick={() => update([...items, { label: '', type: 'custom', href: '', enabled: true }])}>+ Add custom link</Button>}>
        {items.length === 0 ? <Empty>No navigation items.</Empty> : (
          <ol className="sortable">
            {items.map((n, i) => (
              <li key={i} className={n.enabled ? '' : 'nw-off'}>
                <SortControls i={i} n={items.length} name={n.label || `item ${i + 1}`} onMove={(d) => update(move(items, i, d))} />
                <div className="grow nw-inline-fields">
                  <label>Label<input className="input" value={n.label} required onChange={(e) => patch(i, { label: e.target.value })} /></label>
                  <label className="nw-narrow">Type
                    <select className="input" value={n.type} onChange={(e) => changeType(i, e.target.value)}>
                      {NAV_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                    </select>
                  </label>
                  <label>Link<input className="input mono" value={n.href} readOnly={n.type !== 'custom'} onChange={(e) => patch(i, { href: e.target.value })}
                    placeholder={n.type === 'custom' ? '/page or https://…' : ''} /></label>
                </div>
                <label className="check" style={{ margin: 0 }}>
                  <input type="checkbox" checked={n.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                  <span className="small">Shown</span>
                </label>
                <Button size="sm" variant="ghost" aria-label={`Remove ${n.label || 'item'}`} onClick={() => update(items.filter((_, j) => j !== i))}>✕</Button>
              </li>
            ))}
          </ol>
        )}
        <p className="hint" style={{ marginTop: 8 }}>Built-in types link to the site’s standard pages. Custom links may be relative paths or full URLs (opened in a new tab).</p>
      </Card>
      <div className="row">
        <Button variant="primary" loading={busy} disabled={invalid} onClick={save}>Save navigation</Button>
        {invalid && <span className="small" style={{ color: 'var(--red)' }}>Every item needs a label and link.</span>}
        {dirty && !invalid && <span className="small muted">Unsaved changes</span>}
      </div>
    </div>
  );
}
