'use client';

import { useState } from 'react';
import { get, put, uploadFile } from '@/lib/api';
import type { SEOSettings, Tenant, TenantSettings } from '@/lib/types';
import { Button, Card, ErrorBox, ImageUpload, Input, Select, Spinner, Textarea, useAction, useAsync } from '@/components/ui';
import { siteUrl } from '../common';

/** SEO settings. */
export function SeoTab({ tenant }: { tenant: Tenant }) {
  const { data, error, loading, reload } = useAsync(() => get<SEOSettings>(`/tenants/${tenant.id}/seo`), [tenant.id]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return <SeoForm key={data.tenant_id} tenant={tenant} initial={data} onSaved={reload} />;
}

function SeoForm({ tenant, initial, onSaved }: { tenant: Tenant; initial: SEOSettings; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [s, setS] = useState<SEOSettings>(initial);
  const set = <K extends keyof SEOSettings>(k: K, v: SEOSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const tplOk = !s.title_template || s.title_template.includes('%s');
  const host = s.canonical_domain || tenant.primary_domain;
  const sample = (s.title_template || '%s').replace('%s', 'My Business Podcast');
  const descLen = s.meta_description.length;

  const save = async () => {
    const r = await run(() => put(`/tenants/${tenant.id}/seo`, {
      site_title: s.site_title, title_template: s.title_template, meta_description: s.meta_description, default_og_image: s.default_og_image,
      twitter_card: s.twitter_card, twitter_handle: s.twitter_handle, organization_name: s.organization_name, organization_logo: s.organization_logo,
      canonical_domain: s.canonical_domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), index_policy: s.index_policy, robots_extra: s.robots_extra,
    }), 'SEO settings saved');
    if (r !== undefined) onSaved();
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (tplOk) save(); }}>
      <Card title="Titles & description">
        <div className="grid-2">
          <Input label="Site title" value={s.site_title} onChange={(e) => set('site_title', e.target.value)} placeholder={tenant.name} />
          <Input label="Title template" value={s.title_template} onChange={(e) => set('title_template', e.target.value)} placeholder={`%s | ${tenant.name}`}
            hint={tplOk ? <>Preview: <em>{sample}</em></> : undefined} />
        </div>
        {!tplOk && <p className="field-error" role="alert">The title template must contain <code>%s</code> (replaced by the page title).</p>}
        <Textarea label="Meta description" rows={3} value={s.meta_description} onChange={(e) => set('meta_description', e.target.value)}
          hint={<span style={{ color: descLen > 160 ? 'var(--amber)' : undefined }}>{descLen}/160 characters recommended</span>} />
        <div className="alert alert--info small">
          <strong>Dynamic page titles</strong> — generated automatically:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Podcast: <code>{'{podcast_title} | {site_name}'}</code></li>
            <li>Episode: <code>{'{episode_title} – {podcast_title}'}</code></li>
            <li>Category: <code>{'Best {category} Podcasts | {site_name}'}</code></li>
          </ul>
        </div>
      </Card>

      <Card title="Social sharing">
        <div className="grid-2">
          <ImageUpload label="Default OG image" value={s.default_og_image} hint="1200×630 recommended. Uploads save immediately."
            onUpload={async (f) => { const r = await uploadFile('og_image', tenant.id, f); set('default_og_image', r.url); }} />
          <Input label="…or OG image URL" value={s.default_og_image} onChange={(e) => set('default_og_image', e.target.value)} placeholder="https://…/og.jpg" />
          <Select label="Twitter card" value={s.twitter_card || 'summary_large_image'} onChange={(e) => set('twitter_card', e.target.value)}
            options={[{ value: 'summary_large_image', label: 'Summary with large image' }, { value: 'summary', label: 'Summary' }]} />
          <Input label="Twitter / X handle" value={s.twitter_handle} onChange={(e) => set('twitter_handle', e.target.value)} placeholder="@businessvoice" />
        </div>
      </Card>

      <Card title="Organization (structured data)">
        <div className="grid-2">
          <Input label="Organization name" value={s.organization_name} onChange={(e) => set('organization_name', e.target.value)} placeholder={tenant.name} />
          <Input label="Organization logo URL" value={s.organization_logo} onChange={(e) => set('organization_logo', e.target.value)} placeholder="https://…/logo.png" />
        </div>
      </Card>

      <Card title="Indexing & canonical">
        <div className="grid-2">
          <Input label="Canonical domain" value={s.canonical_domain} onChange={(e) => set('canonical_domain', e.target.value)} placeholder={tenant.primary_domain || 'example.com'}
            hint="Leave empty to use the primary domain. Per-podcast canonical (self / primary tenant) is set on each podcast." />
          <div className="field">
            <span className="nw-label">Search engine indexing</span>
            <label className="check">
              <input type="checkbox" checked={s.index_policy === 'index'} onChange={(e) => set('index_policy', e.target.checked ? 'index' : 'noindex')} />
              <span>{s.index_policy === 'index' ? 'Allow indexing (index, follow)' : 'Block indexing (noindex)'}</span>
            </label>
            {s.index_policy === 'noindex' && <p className="alert alert--warn small">Search engines will be told not to index this site.</p>}
          </div>
        </div>
        <Textarea label="robots.txt extra lines" rows={4} className="mono" value={s.robots_extra} onChange={(e) => set('robots_extra', e.target.value)}
          placeholder={'Disallow: /private\nUser-agent: GPTBot\nAllow: /'} hint="Appended to the generated robots.txt." />
        {host && (
          <div className="row">
            <a className="btn btn--sm" href={siteUrl(host, '/robots.txt')} target="_blank" rel="noopener noreferrer">View /robots.txt ↗</a>
            <a className="btn btn--sm" href={siteUrl(host, '/sitemap.xml')} target="_blank" rel="noopener noreferrer">View /sitemap.xml ↗</a>
          </div>
        )}
      </Card>
      <div><Button type="submit" variant="primary" loading={busy} disabled={!tplOk}>Save SEO settings</Button></div>
    </form>
  );
}

/** About page content editor. */
export function AboutTab({ tenant, settings, onSaved }: { tenant: Tenant; settings: TenantSettings; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [html, setHtml] = useState(settings.about_content ?? '');
  const [preview, setPreview] = useState(false);
  const save = async () => {
    const r = await run(() => put(`/tenants/${tenant.id}/settings`, { about_content: html }), 'About page saved');
    if (r !== undefined) onSaved();
  };
  return (
    <Card title="About page" actions={<>
      <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>{preview ? 'Edit' : 'Preview'}</Button>
      {tenant.primary_domain && <a className="btn btn--sm" href={siteUrl(tenant.primary_domain, '/about')} target="_blank" rel="noopener noreferrer">View /about ↗</a>}
    </>}>
      {preview ? (
        // Sandboxed (no scripts) so unsaved HTML can never run in the admin origin.
        <iframe className="nw-html-preview" title="About page preview" sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 system-ui,sans-serif;margin:16px;color:#111}img{max-width:100%}</style>${html || '<p style="color:#888">Empty</p>'}`} />
      ) : (
        <Textarea label="Content (HTML)" rows={14} className="mono" value={html} onChange={(e) => setHtml(e.target.value)}
          hint="Basic HTML: <p>, <h2>, <ul>, <a>, <strong>, <img>. Content is sanitized on save." />
      )}
      <Button variant="primary" loading={busy} onClick={save}>Save about page</Button>
    </Card>
  );
}
