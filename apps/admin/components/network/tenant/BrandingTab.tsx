'use client';

import { useMemo, useState } from 'react';
import { readableOn } from '@podcast/config';
import { put, uploadFile } from '@/lib/api';
import type { Branding, Tenant, TenantSettings, Theme } from '@/lib/types';
import { Button, Card, Field, ImageUpload, Input, Textarea, useAction } from '@/components/ui';
import { ColorField, GOOGLE_FONTS, KeyValueRows, fromRows, toRows } from '../common';

const OVERRIDES: { key: string; label: string; kind: 'color' | 'text'; hint?: string }[] = [
  { key: 'background', label: 'Background', kind: 'color' },
  { key: 'surface', label: 'Surface (cards)', kind: 'color' },
  { key: 'text', label: 'Text', kind: 'color' },
  { key: 'radius', label: 'Border radius', kind: 'text', hint: 'CSS length, e.g. 8px, 0px, 999px' },
  { key: 'playerStyle', label: 'Player style', kind: 'text', hint: 'bar, inline, ticker, minimal, floating, large, dock, pill, elegant' },
];
const PLAYER_STYLES = ['bar', 'inline', 'ticker', 'minimal', 'floating', 'large', 'dock', 'pill', 'elegant'];
// Keys managed elsewhere (branding colours / fonts) — kept out of the generic extra rows.
const MANAGED = new Set([...OVERRIDES.map((o) => o.key), 'primary', 'secondary', 'accent', 'fontHeading', 'fontBody', 'theme']);

function fontsHref(fonts: string[]): string | null {
  const fams = Array.from(new Set(fonts.map((f) => f.trim()).filter(Boolean)));
  if (!fams.length) return null;
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;700`).join('&')}&display=swap`;
}

export function BrandingTab({ tenant, settings, theme, onSaved }: { tenant: Tenant; settings: TenantSettings; theme?: Theme; onSaved: () => void }) {
  const { run, busy } = useAction();
  const def = theme?.default_config ?? {};
  const tc = settings.theme_config ?? {};
  const [b, setB] = useState<Branding>({ ...settings.branding });
  const [social, setSocial] = useState<[string, string][]>(toRows(settings.branding.social_links));
  const [ov, setOv] = useState<Record<string, string>>(() => Object.fromEntries(OVERRIDES.map((o) => [o.key, typeof tc[o.key] === 'string' ? (tc[o.key] as string) : ''])));
  const [extra, setExtra] = useState<[string, string][]>(() => toRows(Object.fromEntries(Object.entries(tc).filter(([k]) => !MANAGED.has(k)))));
  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setB((x) => ({ ...x, [k]: v }));

  const upload = (purpose: string, field: 'logo_url' | 'favicon_url' | 'default_cover_url') => async (f: File) => {
    const r = await uploadFile(purpose, tenant.id, f);
    set(field, r.url);
  };

  const eff = {
    primary: b.primary_color || def.primary || '#1457FF',
    secondary: b.secondary_color || def.secondary || '#111827',
    accent: b.accent_color || def.accent || b.primary_color || '#1457FF',
    background: ov.background || def.background || '#FFFFFF',
    surface: ov.surface || def.surface || '#F3F4F6',
    text: ov.text || def.text || '#111827',
    radius: ov.radius || def.radius || '8px',
    heading: b.heading_font || def.fontHeading || 'Inter',
    body: b.body_font || def.fontBody || 'Inter',
  };
  const href = useMemo(() => fontsHref([eff.heading, eff.body]), [eff.heading, eff.body]);

  const save = async () => {
    const theme_config: Record<string, unknown> = {};
    // Keep unknown keys that may have been set by other tools, then apply the edited ones.
    for (const [k, v] of Object.entries(tc)) if (MANAGED.has(k)) theme_config[k] = v;
    for (const o of OVERRIDES) { if (ov[o.key].trim()) theme_config[o.key] = ov[o.key].trim(); else delete theme_config[o.key]; }
    Object.assign(theme_config, fromRows(extra));
    const branding: Branding = { ...b, social_links: fromRows(social) };
    const r = await run(() => put(`/tenants/${tenant.id}/settings`, { branding, theme_config }), 'Branding saved');
    if (r !== undefined) onSaved();
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <datalist id="nw-fonts">{GOOGLE_FONTS.map((f) => <option key={f} value={f} />)}</datalist>
      <datalist id="nw-player">{PLAYER_STYLES.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="nw-split">
        <div className="stack">
          <Card title="Images">
            <div className="grid-3">
              <ImageUpload label="Logo" value={b.logo_url} onUpload={upload('tenant_logo', 'logo_url')} hint="PNG/SVG/WebP, transparent background recommended" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              <ImageUpload label="Favicon" value={b.favicon_url} onUpload={upload('tenant_favicon', 'favicon_url')} hint="Square, at least 64×64" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/webp" />
              <ImageUpload label="Default cover" value={b.default_cover_url} onUpload={upload('tenant_cover', 'default_cover_url')} hint="Fallback artwork / share image" />
            </div>
            <p className="hint">Uploads are saved immediately.</p>
          </Card>
          <Card title="Identity">
            <Input label="Site tagline" value={b.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Insights for builders, operators and investors." />
            <Textarea label="Footer text" rows={2} value={b.footer_text} onChange={(e) => set('footer_text', e.target.value)} placeholder={`© ${new Date().getFullYear()} ${tenant.name}. All rights reserved.`} />
          </Card>
          <Card title="Colours & typography">
            <div className="grid-3">
              <ColorField label="Primary" value={b.primary_color} onChange={(v) => set('primary_color', v)} placeholder={def.primary} />
              <ColorField label="Secondary" value={b.secondary_color} onChange={(v) => set('secondary_color', v)} placeholder={def.secondary} />
              <ColorField label="Accent" value={b.accent_color} onChange={(v) => set('accent_color', v)} placeholder={def.accent} />
            </div>
            <div className="grid-2">
              <Input label="Heading font" list="nw-fonts" value={b.heading_font} onChange={(e) => set('heading_font', e.target.value)} placeholder={def.fontHeading || 'Inter'} hint="Any Google Fonts family" />
              <Input label="Body font" list="nw-fonts" value={b.body_font} onChange={(e) => set('body_font', e.target.value)} placeholder={def.fontBody || 'Inter'} />
            </div>
            <p className="hint">Leave empty to use the theme defaults (shown as placeholders).</p>
          </Card>
          <Card title="Social links">
            <KeyValueRows rows={social} onChange={setSocial} keyLabel="Network" valueLabel="URL" keyPlaceholder="instagram, x, youtube…" valuePlaceholder="https://…" addLabel="+ Add social link" />
          </Card>
          <Card title="Advanced theme configuration" actions={<span className="small muted">PRD §51</span>}>
            <div className="grid-2">
              {OVERRIDES.map((o) => o.kind === 'color' ? (
                <ColorField key={o.key} label={o.label} value={ov[o.key]} onChange={(v) => setOv((x) => ({ ...x, [o.key]: v }))} placeholder={def[o.key]} />
              ) : (
                <Input key={o.key} label={o.label} list={o.key === 'playerStyle' ? 'nw-player' : undefined} value={ov[o.key]} placeholder={def[o.key]} hint={o.hint}
                  onChange={(e) => setOv((x) => ({ ...x, [o.key]: e.target.value }))} />
              ))}
            </div>
            <Field label="Additional keys">
              {() => <KeyValueRows rows={extra} onChange={setExtra} keyPlaceholder="e.g. muted" valuePlaceholder="value" addLabel="+ Add override" />}
            </Field>
          </Card>
        </div>
        <aside className="nw-preview-wrap" aria-label="Live preview">
          {href && <link rel="stylesheet" href={href} />}
          <p className="small muted" style={{ margin: '0 0 6px' }}>Live preview</p>
          <div className="nw-preview" style={{ background: eff.background, color: eff.text, fontFamily: `'${eff.body}', system-ui, sans-serif` }}>
            <div className="nw-preview__bar" style={{ borderColor: `${eff.text}22` }}>
              {b.logo_url ? <img src={b.logo_url} alt="" /> : <span className="nw-preview__logo" style={{ background: eff.primary }} aria-hidden="true" />}
              <strong style={{ fontFamily: `'${eff.heading}', system-ui, sans-serif` }}>{tenant.name}</strong>
            </div>
            <h3 style={{ fontFamily: `'${eff.heading}', system-ui, sans-serif` }}>{b.tagline || 'Your next favourite podcast'}</h3>
            <div className="nw-preview__card" style={{ background: eff.surface, borderRadius: eff.radius }}>
              <span className="nw-preview__art" style={{ background: `linear-gradient(135deg, ${eff.primary}, ${eff.accent})`, borderRadius: eff.radius }} />
              <div>
                <strong style={{ fontFamily: `'${eff.heading}', system-ui, sans-serif` }}>Episode 12</strong>
                <p>Body text in {eff.body}.</p>
              </div>
            </div>
            <div className="row">
              <span className="nw-preview__btn" style={{ background: eff.primary, color: readableOn(eff.primary), borderRadius: eff.radius }}>▶ Play</span>
              <span className="nw-preview__btn" style={{ background: eff.secondary, color: readableOn(eff.secondary), borderRadius: eff.radius }}>Follow</span>
              <span style={{ color: eff.accent, fontWeight: 700 }}>Accent link →</span>
            </div>
            <p className="nw-preview__foot" style={{ borderColor: `${eff.text}22` }}>{b.footer_text || `© ${tenant.name}`}</p>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>Approximation — layout depends on the theme. Player style: {ov.playerStyle || def.playerStyle || 'default'}.</p>
        </aside>
      </div>
      <div><Button type="submit" variant="primary" loading={busy}>Save branding</Button></div>
    </form>
  );
}
