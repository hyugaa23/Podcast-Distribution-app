'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Tenant, Theme } from '@/lib/types';
import { Button, Card, ErrorBox, Input, PageHeader, Select, Spinner, useAction, useAsync } from '@/components/ui';
import { CONTENT_MODES, ColorField, LANGUAGES, NoAccess, ThemePicker, TimezoneField, themeLabel } from '@/components/network/common';

/** Create Website wizard (PRD §9). */
export default function NewTenantPage() {
  const { can, reloadTenants } = useAuth();
  const router = useRouter();
  const { run, busy } = useAction();
  const themes = useAsync(() => get<Theme[]>('/themes'), []);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [theme, setTheme] = useState('business');
  const [logo, setLogo] = useState('');
  const [colors, setColors] = useState({ primary: '#1457FF', secondary: '#111827', accent: '#1457FF' });
  const [touched, setTouched] = useState(false);
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  });
  const [mode, setMode] = useState<Tenant['content_mode']>('INDEPENDENT');

  const selected = themes.data?.find((t) => t.key === theme);
  // Colours follow the chosen theme until the user edits them.
  useEffect(() => {
    if (!selected || touched) return;
    const c = selected.default_config;
    setColors({ primary: (c.primary || '#1457FF').toUpperCase(), secondary: (c.secondary || '#111827').toUpperCase(), accent: (c.accent || c.primary || '#1457FF').toUpperCase() });
  }, [selected, touched]);

  if (!can('SUPER_ADMIN')) return <NoAccess what="website creation (super admin only)" />;

  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const submit = async () => {
    const t = await run(() => post<Tenant>('/tenants', {
      name: name.trim(), domain: cleanDomain || undefined, theme, logo_url: logo.trim() || undefined,
      primary_color: colors.primary, secondary_color: colors.secondary, accent_color: colors.accent,
      language, timezone, content_mode: mode,
    }), 'Website created');
    if (t) {
      await reloadTenants();
      router.push(`/tenants/${t.id}`);
    }
  };
  const setColor = (k: keyof typeof colors) => (v: string) => { setTouched(true); setColors((c) => ({ ...c, [k]: v })); };

  return (
    <>
      <PageHeader title="Create website" subtitle="Launch a new podcast website on its own domain" back={{ href: '/tenants', label: 'Websites' }} />
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) submit(); }}>
        <Card title="1. Site">
          <div className="grid-2">
            <Input label="Site name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Business Voice" />
            <Input label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="businessvoice.com"
              hint="Primary domain (optional now — you can add domains later). Use name.localhost for local testing." />
          </div>
        </Card>

        <Card title="2. Theme" actions={selected && <span className="muted small">{themeLabel(selected)}</span>}>
          {themes.loading ? <Spinner /> : themes.error ? <ErrorBox error={themes.error} onRetry={themes.reload} /> : (
            <ThemePicker themes={themes.data ?? []} value={theme} onChange={setTheme} label="Choose one of the 10 themes" />
          )}
        </Card>

        <Card title="3. Branding">
          <div className="grid-2">
            <Input label="Logo URL" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" hint="Optional — you can upload a logo after creation." />
            <div />
          </div>
          <div className="grid-3">
            <ColorField label="Primary colour" value={colors.primary} onChange={setColor('primary')} />
            <ColorField label="Secondary colour" value={colors.secondary} onChange={setColor('secondary')} />
            <ColorField label="Accent colour" value={colors.accent} onChange={setColor('accent')} />
          </div>
          {touched && <Button size="sm" variant="ghost" onClick={() => setTouched(false)}>Reset to theme defaults</Button>}
        </Card>

        <Card title="4. Locale & content">
          <div className="grid-2">
            <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
            <TimezoneField value={timezone} onChange={setTimezone} />
          </div>
          <fieldset className="nw-fieldset">
            <legend>Content mode</legend>
            <div className="nw-radios">
              {CONTENT_MODES.map((m) => (
                <label key={m.value} className={`nw-radio${mode === m.value ? ' is-on' : ''}`}>
                  <input type="radio" name="content_mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
                  <span><strong>{m.label}</strong><small>{m.help}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <div className="row">
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Create website</Button>
          <a className="btn btn--ghost" href="/tenants">Cancel</a>
        </div>
      </form>
    </>
  );
}
