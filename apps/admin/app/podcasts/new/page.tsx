'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Podcast } from '@/lib/types';
import { Button, Card, Empty, Field, Input, PageHeader, Select, errMsg, useToast } from '@/components/ui';
import { CategorySelects, HostsEditor, Steps, parseTags, useCategories } from '@/components/content/common';
import { PodcastDetailsFields, PodcastOwnerFields, draftToBody, emptyPodcastDraft, type PodcastDraft } from '@/components/content/podcastForm';
import { Icon } from '@/components/icons';

const STEPS = ['Podcast details', 'Artwork', 'Category', 'Owner', 'Create'];
const MAX_ART = 10 * 1024 * 1024;

export default function NewPodcastPage() {
  const router = useRouter();
  const toast = useToast();
  const { can, user, tenants, scopeTenantId } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const cats = useCategories();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<PodcastDraft>(() => ({ ...emptyPodcastDraft(), owner_tenant_id: scopeTenantId ?? 0 }));
  const [artFile, setArtFile] = useState<File | null>(null);
  const [artPreview, setArtPreview] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const set = <K extends keyof PodcastDraft>(k: K, v: PodcastDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!artFile) { setArtPreview(''); return; }
    const u = URL.createObjectURL(artFile);
    setArtPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [artFile]);

  if (!can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR')) {
    return <><PageHeader title="New podcast" back={{ href: '/podcasts', label: 'Podcasts' }} /><Empty>You don’t have permission to create podcasts.</Empty></>;
  }

  const validate = (s: number): string => {
    if (s === 0 && !d.title.trim()) return 'Title is required.';
    if (s === 0 && d.website_url && !/^https?:\/\//i.test(d.website_url.trim())) return 'Website must start with http:// or https://';
    if (s === 1 && d.artwork_url && !/^https?:\/\//i.test(d.artwork_url.trim())) return 'Artwork URL must start with http:// or https://';
    if (s === 3 && d.owner_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.owner_email.trim())) return 'Owner email is not valid.';
    return '';
  };
  const next = () => {
    const e = validate(step);
    setErr(e);
    if (!e) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const create = async () => {
    for (let s = 0; s < 4; s++) { const e = validate(s); if (e) { setErr(e); setStep(s); return; } }
    setErr('');
    setBusy('Creating podcast…');
    try {
      const p = await post<Podcast>('/podcasts', { ...draftToBody({ ...d, status: 'DRAFT' }, { includeOwner: isSuper }) });
      if (artFile) {
        setBusy('Uploading artwork…');
        try { await uploadFile('podcast_artwork', p.id, artFile); } catch (e) { toast('error', `Podcast created, but artwork upload failed: ${errMsg(e)}`); }
      }
      toast('success', 'Podcast created as draft');
      router.push(`/podcasts/${p.id}?created=1`);
    } catch (e) {
      setErr(errMsg(e));
      setBusy('');
    }
  };

  const catName = (id: number | null) => cats.all.find((c) => c.id === id)?.name;
  const ownerLabel = isSuper ? (d.owner_tenant_id ? tenants.find((t) => t.id === d.owner_tenant_id)?.name : 'Central library') : tenants.find((t) => t.id === user?.tenant_id)?.name ?? 'Your website';

  return (
    <>
      <PageHeader title="New podcast" subtitle="Create a podcast in a few steps. It is saved as a draft — you can publish it later." back={{ href: '/podcasts', label: 'Podcasts' }} />
      <Steps steps={STEPS} current={step} onJump={(i) => { setErr(''); setStep(i); }} />
      <form onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) next(); else create(); }} noValidate>
        <Card title={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {err && <div className="alert alert--error" role="alert">{err}</div>}

          {step === 0 && <PodcastDetailsFields d={d} set={set} />}

          {step === 1 && (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>Square artwork, at least 1400×1400 px (3000×3000 recommended), JPG or PNG. Required by Apple Podcasts and Spotify.</p>
              <div className="imgup">
                {artPreview || d.artwork_url ? <img src={artPreview || d.artwork_url} alt="Artwork preview" className="imgup__preview" style={{ width: 140, height: 140 }} />
                  : <div className="imgup__preview imgup__preview--empty" style={{ width: 140, height: 140 }}>No artwork</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Upload artwork file" hint="Uploaded right after the podcast is created.">
                    {(id) => (
                      <input id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        if (f && f.size > MAX_ART) { setErr('Artwork must be smaller than 10 MB.'); e.target.value = ''; return; }
                        setErr('');
                        setArtFile(f);
                        if (f) set('artwork_url', '');
                      }} />
                    )}
                  </Field>
                  {artFile && <Button size="sm" variant="ghost" onClick={() => setArtFile(null)}>Remove selected file</Button>}
                  <p className="muted small" style={{ margin: '8px 0' }}>— or —</p>
                  <Input label="Artwork URL" type="url" placeholder="https://…/artwork.jpg" value={d.artwork_url} disabled={!!artFile}
                    onChange={(e) => set('artwork_url', e.target.value)} />
                </div>
              </div>
              <p className="hint">You can skip this step and add artwork later from the podcast page.</p>
            </div>
          )}

          {step === 2 && (
            <>
              <CategorySelects categoryId={d.category_id} subcategoryId={d.subcategory_id}
                onChange={(c, s) => setD((x) => ({ ...x, category_id: c, subcategory_id: s }))} />
              <Input label="Tags" value={d.tags} onChange={(e) => set('tags', e.target.value)} placeholder="business, interviews, startups"
                hint="Comma separated." />
              <HostsEditor value={d.hosts} onChange={(v) => set('hosts', v)} />
            </>
          )}

          {step === 3 && (
            <>
              <PodcastOwnerFields d={d} set={set} />
              {isSuper ? (
                <Select label="Owner site" value={d.owner_tenant_id} onChange={(e) => set('owner_tenant_id', Number(e.target.value))}
                  hint="Central library podcasts can be syndicated to Shared/Syndicated sites from the Sites tab."
                  options={[{ value: 0, label: 'Central library (no owner site)' }, ...tenants.map((t) => ({ value: t.id, label: `${t.name}${t.primary_domain ? ` — ${t.primary_domain}` : ''}` }))]} />
              ) : <p className="muted small">The podcast will belong to <strong>{ownerLabel}</strong>.</p>}
            </>
          )}

          {step === 4 && (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>Review and create. The podcast is created as a <strong>Draft</strong>.</p>
              <div className="c-hero">
                {artPreview || d.artwork_url ? <img src={artPreview || d.artwork_url} alt="" /> : <span className="c-hero__ph" aria-hidden="true"><Icon name="podcasts" width={28} height={28} /></span>}
                <div><strong style={{ fontSize: 16 }}>{d.title || 'Untitled'}</strong><div className="muted">{d.short_description}</div></div>
              </div>
              <dl className="kv">
                <dt>Slug</dt><dd>{d.slug || <span className="muted">auto</span>}</dd>
                <dt>Author</dt><dd>{d.author || '—'}</dd>
                <dt>Language / type</dt><dd>{d.language} · {d.podcast_type}{d.explicit ? ' · explicit' : ''}</dd>
                <dt>Category</dt><dd>{catName(d.category_id) ?? '—'}{d.subcategory_id ? ` › ${catName(d.subcategory_id)}` : ''}</dd>
                <dt>Tags</dt><dd>{parseTags(d.tags).join(', ') || '—'}</dd>
                <dt>Hosts</dt><dd>{d.hosts.length}</dd>
                <dt>Owner</dt><dd>{d.owner_name || '—'} {d.owner_email && `<${d.owner_email}>`}</dd>
                <dt>Site</dt><dd>{ownerLabel}</dd>
                <dt>Artwork</dt><dd>{artFile ? `${artFile.name} (upload)` : d.artwork_url || <span className="muted">none — add later</span>}</dd>
              </dl>
            </div>
          )}

          <div className="row row--between" style={{ marginTop: 16 }}>
            <Button onClick={() => { setErr(''); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0 || !!busy}>← Back</Button>
            {step < STEPS.length - 1
              ? <Button type="submit" variant="primary">Next →</Button>
              : <Button type="submit" variant="primary" loading={!!busy}>{busy || 'Create podcast'}</Button>}
          </div>
        </Card>
      </form>
    </>
  );
}
