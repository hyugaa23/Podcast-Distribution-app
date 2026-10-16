'use client';

import type { Podcast } from '@/lib/types';
import { Checkbox, Input, Select, Textarea } from '@/components/ui';
import { LANGUAGES, isoToZonedInput, parseTags, type HostLink } from './common';

export interface PodcastDraft {
  title: string; slug: string; short_description: string; description: string; author: string; language: string;
  podcast_type: 'episodic' | 'serial'; explicit: boolean; copyright: string; website_url: string;
  artwork_url: string; banner_url: string; category_id: number | null; subcategory_id: number | null; tags: string;
  hosts: HostLink[]; owner_name: string; owner_email: string; status: Podcast['status']; scheduled_at: string;
  owner_tenant_id: number; canonical_tenant_id: number;
}

export const emptyPodcastDraft = (): PodcastDraft => ({
  title: '', slug: '', short_description: '', description: '', author: '', language: 'en', podcast_type: 'episodic', explicit: false,
  copyright: '', website_url: '', artwork_url: '', banner_url: '', category_id: null, subcategory_id: null, tags: '', hosts: [],
  owner_name: '', owner_email: '', status: 'DRAFT', scheduled_at: '', owner_tenant_id: 0, canonical_tenant_id: 0,
});

export function podcastToDraft(p: Podcast, tz: string): PodcastDraft {
  return {
    title: p.title, slug: p.slug, short_description: p.short_description ?? '', description: p.description ?? '', author: p.author ?? '',
    language: p.language || 'en', podcast_type: p.podcast_type || 'episodic', explicit: !!p.explicit, copyright: p.copyright ?? '',
    website_url: p.website_url ?? '', artwork_url: p.artwork_url ?? '', banner_url: p.banner_url ?? '', category_id: p.category_id,
    subcategory_id: p.subcategory_id, tags: (p.tags ?? []).join(', '), hosts: (p.hosts ?? []).map((h) => ({ host_id: h.id, role: h.role || 'host' })),
    owner_name: p.owner_name ?? '', owner_email: p.owner_email ?? '', status: p.status, scheduled_at: isoToZonedInput(p.scheduled_at, tz),
    owner_tenant_id: p.owner_tenant_id ?? 0, canonical_tenant_id: p.canonical_tenant_id ?? 0,
  };
}

/** Builds the API payload. `includeOwner` only for create (super admin). */
export function draftToBody(d: PodcastDraft, opts: { includeOwner?: boolean; includeCanonical?: boolean } = {}) {
  const body: Record<string, unknown> = {
    title: d.title.trim(), description: d.description, short_description: d.short_description, author: d.author, language: d.language,
    podcast_type: d.podcast_type, explicit: d.explicit, copyright: d.copyright, website_url: d.website_url.trim(),
    artwork_url: d.artwork_url.trim(), banner_url: d.banner_url.trim(), category_id: d.category_id ?? 0, subcategory_id: d.subcategory_id ?? 0,
    tags: parseTags(d.tags), hosts: d.hosts, owner_name: d.owner_name, owner_email: d.owner_email.trim(), status: d.status,
  };
  if (d.slug.trim()) body.slug = d.slug.trim();
  if (d.status === 'SCHEDULED') body.scheduled_at = d.scheduled_at;
  if (opts.includeOwner) body.owner_tenant_id = d.owner_tenant_id;
  if (opts.includeCanonical) body.canonical_tenant_id = d.canonical_tenant_id;
  return body;
}

type Set = <K extends keyof PodcastDraft>(k: K, v: PodcastDraft[K]) => void;

/** PRD §84 step 1 fields — Podcast Details. */
export function PodcastDetailsFields({ d, set, slugHint }: { d: PodcastDraft; set: Set; slugHint?: string }) {
  return (
    <>
      <div className="grid-2">
        <Input label="Title" required value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={255} />
        <Input label="Slug" value={d.slug} onChange={(e) => set('slug', e.target.value)} placeholder="auto-generated from title"
          hint={slugHint ?? 'Optional. Lowercase letters, numbers and dashes.'} />
      </div>
      <Input label="Short description" value={d.short_description} onChange={(e) => set('short_description', e.target.value)} maxLength={300}
        hint="One sentence used on cards and in search results." />
      <Textarea label="Description" rows={6} value={d.description} onChange={(e) => set('description', e.target.value)}
        hint="Basic HTML allowed (p, a, strong, em, ul, li). Shown on the show page and in the RSS feed." />
      <div className="grid-3">
        <Input label="Author" value={d.author} onChange={(e) => set('author', e.target.value)} />
        <Select label="Language" value={d.language} onChange={(e) => set('language', e.target.value)}
          options={LANGUAGES.some((l) => l.value === d.language) ? LANGUAGES : [...LANGUAGES, { value: d.language, label: d.language }]} />
        <Select label="Podcast type" value={d.podcast_type} onChange={(e) => set('podcast_type', e.target.value as PodcastDraft['podcast_type'])}
          options={[{ value: 'episodic', label: 'Episodic (newest first)' }, { value: 'serial', label: 'Serial (in order)' }]} />
      </div>
      <div className="grid-2">
        <Input label="Copyright" value={d.copyright} onChange={(e) => set('copyright', e.target.value)} placeholder="© 2026 Your Company" />
        <Input label="Website" type="url" value={d.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://" />
      </div>
      <Checkbox label="Explicit content" hint="marks the show as explicit in RSS and on platforms" checked={d.explicit} onChange={(v) => set('explicit', v)} />
    </>
  );
}

/** PRD §84 owner step fields. */
export function PodcastOwnerFields({ d, set }: { d: PodcastDraft; set: Set }) {
  return (
    <div className="grid-2">
      <Input label="Owner name" value={d.owner_name} onChange={(e) => set('owner_name', e.target.value)} hint="itunes:owner name in the RSS feed" />
      <Input label="Owner email" type="email" value={d.owner_email} onChange={(e) => set('owner_email', e.target.value)}
        hint="Required by Apple Podcasts and Spotify to verify ownership." />
    </div>
  );
}
