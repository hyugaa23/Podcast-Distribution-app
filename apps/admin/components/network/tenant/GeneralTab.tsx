'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { del, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Tenant, Theme } from '@/lib/types';
import { Button, Card, Input, Select, Stat, useAction } from '@/components/ui';
import { CONTENT_MODES, LANGUAGES, ThemePicker, TimezoneField } from '../common';

export interface TenantStats { podcasts: number; episodes: number; domains: number; users: number }

export function GeneralTab({ tenant, stats, themes, onSaved }: { tenant: Tenant; stats: TenantStats; themes: Theme[]; onSaved: () => void }) {
  const { can, reloadTenants } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const router = useRouter();
  const { run, busy } = useAction();
  const [f, setF] = useState({ name: tenant.name, theme: tenant.theme_key, content_mode: tenant.content_mode, status: tenant.status, language: tenant.language, timezone: tenant.timezone });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const langs = LANGUAGES.some((l) => l.value === f.language) ? LANGUAGES : [...LANGUAGES, { value: f.language, label: f.language }];

  const save = async () => {
    const body: Record<string, unknown> = { name: f.name.trim(), theme: f.theme, language: f.language, timezone: f.timezone };
    if (isSuper) { body.content_mode = f.content_mode; body.status = f.status; }
    const r = await run(() => put(`/tenants/${tenant.id}`, body), 'Website saved');
    if (r !== undefined) { await reloadTenants(); onSaved(); }
  };

  return (
    <div className="stack">
      <div className="grid-4">
        <Stat label="Podcasts" value={stats.podcasts} />
        <Stat label="Episodes" value={stats.episodes} />
        <Stat label="Domains" value={stats.domains} />
        <Stat label="Users" value={stats.users} href="/users" />
      </div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Card title="Website">
          <div className="grid-2">
            <Input label="Site name" required value={f.name} onChange={(e) => set('name', e.target.value)} />
            <Input label="Slug" value={tenant.slug} readOnly disabled hint="Internal identifier (not editable)." />
            <Select label="Language" value={f.language} onChange={(e) => set('language', e.target.value)} options={langs} />
            <TimezoneField value={f.timezone} onChange={(v) => set('timezone', v)} />
          </div>
          {isSuper && (
            <div className="grid-2">
              <Select label="Content mode" value={f.content_mode} onChange={(e) => set('content_mode', e.target.value as Tenant['content_mode'])}
                options={CONTENT_MODES.map((m) => ({ value: m.value, label: m.label }))}
                hint={CONTENT_MODES.find((m) => m.value === f.content_mode)?.help} />
              <Select label="Status" value={f.status} onChange={(e) => set('status', e.target.value as Tenant['status'])}
                options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled (site offline)' }]} />
            </div>
          )}
          {!isSuper && <p className="hint">Content mode: <strong>{CONTENT_MODES.find((m) => m.value === tenant.content_mode)?.label}</strong> · Status: <strong>{tenant.status}</strong> (managed by the network admin).</p>}
        </Card>
        <Card title="Theme">
          <ThemePicker themes={themes} value={f.theme} onChange={(k) => set('theme', k)} />
          <p className="hint" style={{ marginTop: 8 }}>Changing the theme changes layout, cards, player and typography. Your branding colours and overrides are kept.</p>
        </Card>
        <div><Button type="submit" variant="primary" loading={busy} disabled={!f.name.trim()}>Save changes</Button></div>
      </form>
      {isSuper && (
        <Card title="Danger zone" className="nw-danger">
          <p className="small">Deleting a website removes its settings, domains and site-specific content links. This cannot be undone.</p>
          <Button variant="danger" onClick={async () => {
            const typed = window.prompt(`Type the site name "${tenant.name}" to permanently delete it:`);
            if (typed !== tenant.name) return;
            const r = await run(() => del(`/tenants/${tenant.id}`), 'Website deleted');
            if (r !== undefined) { await reloadTenants(); router.push('/tenants'); }
          }}>Delete website…</Button>
        </Card>
      )}
    </div>
  );
}
