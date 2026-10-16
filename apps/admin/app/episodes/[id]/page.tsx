'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, del, get, post, put, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AudioFile, Episode, Podcast } from '@/lib/types';
import {
  Badge, Button, Card, Checkbox, ConfirmButton, ErrorBox, Field, ImageUpload, Input, PageHeader, Select, Spinner, Textarea, errMsg, fmtDate,
  useAction, useAsync, useToast,
} from '@/components/ui';
import { HostsEditor, RowsEditor, isoToZonedInput, numOrNull, parseTags, useOwnerTimezone, type HostLink } from '@/components/content/common';
import { AudioCard, TranscriptCard } from '@/components/content/episodeParts';

interface Draft {
  title: string; slug: string; short_description: string; description: string; show_notes: string; episode_number: string; season_number: string;
  episode_type: Episode['episode_type']; explicit: boolean; artwork_url: string; tags: string; hosts: HostLink[]; publish_date: string;
  seo_title: string; meta_description: string; canonical_url: string; key_topics: string; faq: { question: string; answer: string }[];
  citations: { title: string; url: string }[]; transcript: string; transcript_format: string;
}

function toDraft(e: Episode, tz: string): Draft {
  return {
    title: e.title, slug: e.slug, short_description: e.short_description ?? '', description: e.description ?? '', show_notes: e.show_notes ?? '',
    episode_number: e.episode_number != null ? String(e.episode_number) : '', season_number: e.season_number != null ? String(e.season_number) : '',
    episode_type: e.episode_type || 'full', explicit: !!e.explicit, artwork_url: e.artwork_url ?? '', tags: (e.tags ?? []).join(', '),
    hosts: (e.hosts ?? []).map((h) => ({ host_id: h.id, role: h.role || 'guest' })), publish_date: isoToZonedInput(e.published_at, tz),
    seo_title: e.seo_title ?? '', meta_description: e.meta_description ?? '', canonical_url: e.canonical_url ?? '', key_topics: (e.key_topics ?? []).join('\n'),
    faq: e.faq ?? [], citations: e.citations ?? [], transcript: e.transcript ?? '', transcript_format: e.transcript_format || 'txt',
  };
}

function toBody(d: Draft, orig: Episode, tz: string, includeTranscript: boolean) {
  const en = numOrNull(d.episode_number), sn = numOrNull(d.season_number);
  const body: Record<string, unknown> = {
    title: d.title.trim(), short_description: d.short_description, description: d.description, show_notes: d.show_notes, episode_type: d.episode_type,
    explicit: d.explicit, artwork_url: d.artwork_url.trim(), tags: parseTags(d.tags), hosts: d.hosts, seo_title: d.seo_title, meta_description: d.meta_description,
    canonical_url: d.canonical_url.trim(), key_topics: d.key_topics.split('\n').map((s) => s.trim()).filter(Boolean),
    faq: d.faq.filter((f) => f.question.trim() || f.answer.trim()), citations: d.citations.filter((c) => c.title.trim() || c.url.trim()),
  };
  if (includeTranscript) { body.transcript = d.transcript; body.transcript_format = d.transcript_format; }
  if (d.slug.trim() && d.slug.trim() !== orig.slug) body.slug = d.slug.trim();
  if (en === null) body.clear_episode_number = true; else body.episode_number = en;
  if (sn === null) body.clear_season_number = true; else body.season_number = sn;
  if (d.publish_date && d.publish_date !== isoToZonedInput(orig.published_at, tz)) body.publish_date = d.publish_date;
  return body;
}

type Loaded = { data: Episode; audio: AudioFile | null };
const WORKFLOW = ['Draft', 'Upload audio', 'Processing', 'Metadata', 'SEO', 'Preview', 'Publish'];

export default function EpisodeEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, loading, reload, setData } = useAsync(() => api<Loaded>(`/episodes/${id}`), [id]);
  const ep = data?.data;
  const audio = data?.audio ?? null;
  const pod = useAsync(() => (ep ? get<Podcast>(`/podcasts/${ep.podcast_id}`) : Promise.resolve(undefined)), [ep?.podcast_id]);
  const tz = useOwnerTimezone(pod.data?.owner_tenant_id);
  const [d, setD] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tDirty, setTDirty] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [sched, setSched] = useState({ date: '', time: '09:00' });
  const { run, busy } = useAction();
  const loadedFor = useRef<string>('');

  // Initialise the draft once per episode (polling must not clobber edits).
  useEffect(() => {
    if (!ep || !pod.data) return;
    const key = `${ep.id}`;
    if (loadedFor.current !== key) { loadedFor.current = key; setD(toDraft(ep, tz)); setDirty(false); setTDirty(false); }
  }, [ep, pod.data, tz]);

  // Keep the transcript in sync with the server (AI generation / uploads) unless the user is editing it.
  useEffect(() => {
    if (!ep || tDirty) return;
    setD((x) => (x && (x.transcript !== (ep.transcript ?? '') || x.transcript_format !== (ep.transcript_format || 'txt'))
      ? { ...x, transcript: ep.transcript ?? '', transcript_format: ep.transcript_format || 'txt' } : x));
  }, [ep, tDirty]);

  // Poll every 3s while audio is processing.
  const processing = !!ep && (ep.status === 'PROCESSING' || audio?.status === 'PROCESSING' || audio?.status === 'UPLOADED');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => { api<Loaded>(`/episodes/${id}`).then(setData).catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [processing, id, setData]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (error) return <><PageHeader title="Episode" back={{ href: '/episodes', label: 'Episodes' }} /><ErrorBox error={error} onRetry={reload} /></>;
  if (!ep || !d || (loading && !data)) return pod.error ? <ErrorBox error={pod.error} onRetry={pod.reload} /> : <Spinner />;

  const readOnly = can('VIEWER') || (pod.data ? !pod.data.can_edit : false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => (x ? { ...x, [k]: v } : x)); setDirty(true); };
  const setEp = (e: Episode) => setData({ data: e, audio });

  const save = async (silent = false): Promise<boolean> => {
    if (!d.title.trim()) { toast('error', 'Title is required.'); return false; }
    const r = await run(() => put<Episode>(`/episodes/${ep.id}`, toBody(d, ep, tz, tDirty)), silent ? undefined : 'Episode saved');
    if (!r) return false;
    setEp(r);
    setD(toDraft(r, tz));
    setDirty(false);
    setTDirty(false);
    return true;
  };
  const publish = async () => {
    if (!window.confirm('Publish this episode? It will go live immediately.')) return;
    if (dirty && !(await save(true))) return;
    const r = await run(() => post<Episode | { queued: boolean; message: string }>(`/episodes/${ep.id}/publish`));
    if (!r) return;
    if ('queued' in r && r.queued) toast('info', r.message || 'Audio is still processing; the episode will publish automatically when ready.');
    else toast('success', 'Episode published — RSS, sitemap and cache are being updated');
    reload();
  };
  const unpublish = async () => {
    if (!window.confirm('Unpublish this episode? It will be removed from the RSS feed and website.')) return;
    const r = await run(() => post<Episode>(`/episodes/${ep.id}/unpublish`), 'Episode moved back to draft');
    if (r) reload();
  };
  const schedule = async () => {
    if (!sched.date || !sched.time) { toast('error', 'Choose a date and time.'); return; }
    if (dirty && !(await save(true))) return;
    const r = await run(() => post<Episode>(`/episodes/${ep.id}/schedule`, { publish_at: `${sched.date} ${sched.time}` }), `Scheduled for ${sched.date} ${sched.time} (${tz})`);
    if (r !== undefined) reload();
  };
  const preview = async () => {
    const w = window.open('', '_blank');
    try {
      const r = await post<{ token: string; url: string }>(`/episodes/${ep.id}/preview-token`);
      if (w) { w.opener = null; w.location.href = r.url; } else window.location.assign(r.url);
      setPreviewed(true);
    } catch (e) {
      w?.close();
      toast('error', errMsg(e));
    }
  };
  const remove = async () => {
    const ok = await run(async () => { await del(`/episodes/${ep.id}`); return true; }, 'Episode deleted');
    if (ok) { setDirty(false); router.push(`/podcasts/${ep.podcast_id}?tab=episodes`); }
  };

  const hasAudio = !!audio || !!ep.audio_url;
  const done = [
    true,
    hasAudio,
    audio ? audio.status === 'READY' : !!ep.audio_url,
    !!(ep.title && (ep.description || ep.short_description)),
    !!(ep.seo_title || ep.meta_description || (ep.key_topics?.length ?? 0) > 0),
    previewed || ep.status === 'PUBLISHED',
    ep.status === 'PUBLISHED',
  ];
  const current = done.findIndex((x) => !x);

  return (
    <>
      <PageHeader
        back={{ href: `/podcasts/${ep.podcast_id}?tab=episodes`, label: ep.podcast_title || 'Podcast' }}
        title={ep.title || 'Untitled episode'}
        subtitle={<><Badge status={ep.status} /> {ep.season_number ? `· Season ${ep.season_number} ` : ''}{ep.episode_number ? `· Episode ${ep.episode_number} ` : ''}· {ep.episode_type}{dirty && <strong> · unsaved changes</strong>}</>}
        actions={!readOnly && <>
          <Button onClick={preview}>Preview</Button>
          <Button variant="primary" onClick={() => save()} loading={busy} disabled={!dirty}>Save</Button>
        </>}
      />

      <ol className="c-steps" aria-label="Publishing workflow">
        {WORKFLOW.map((s, i) => (
          <li key={s} className={done[i] ? 'is-done' : i === current ? 'is-current' : ''} aria-current={i === current ? 'step' : undefined}>
            <span><span className="c-steps__n">{done[i] ? '✓' : i + 1}</span>{s}</span>
          </li>
        ))}
      </ol>

      {readOnly && <div className="alert alert--info">You can view this episode but not edit it.</div>}

      <div className="c-editor">
        <div className="stack">
          <AudioCard key={`${ep.id}-${audio?.id ?? 0}`} ep={ep} audio={audio} readOnly={readOnly} onChanged={reload} />

          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="stack">
            <fieldset disabled={readOnly} className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <Card title="Metadata">
                <div className="grid-2">
                  <Input label="Title" required value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={255} />
                  <Input label="Slug" value={d.slug} onChange={(e) => set('slug', e.target.value)} hint="Changing the slug creates a 301 redirect." />
                </div>
                <Input label="Short description" value={d.short_description} onChange={(e) => set('short_description', e.target.value)} maxLength={300} />
                <Textarea label="Description (HTML)" rows={6} value={d.description} onChange={(e) => set('description', e.target.value)}
                  hint="Allowed: p, a, strong, em, ul, ol, li, h2–h4, blockquote. Used in the RSS feed." />
                <Textarea label="Show notes" rows={6} value={d.show_notes} onChange={(e) => set('show_notes', e.target.value)} hint="Links, timestamps and resources (HTML allowed)." />
                <div className="grid-3">
                  <Input label="Episode number" type="number" min={0} value={d.episode_number} onChange={(e) => set('episode_number', e.target.value)} />
                  <Input label="Season number" type="number" min={0} value={d.season_number} onChange={(e) => set('season_number', e.target.value)} />
                  <Select label="Episode type" value={d.episode_type} onChange={(e) => set('episode_type', e.target.value as Episode['episode_type'])}
                    options={[{ value: 'full', label: 'Full' }, { value: 'trailer', label: 'Trailer' }, { value: 'bonus', label: 'Bonus' }]} />
                </div>
                <div className="grid-2">
                  <Input label="Publish date" type="datetime-local" value={d.publish_date} onChange={(e) => set('publish_date', e.target.value)}
                    hint={`Date shown in the feed (${tz}). Leave empty to use the publish time.`} />
                  <Input label="Tags" value={d.tags} onChange={(e) => set('tags', e.target.value)} hint="Comma separated." />
                </div>
                <Checkbox label="Explicit content" checked={d.explicit} onChange={(v) => set('explicit', v)} />
                <div className="grid-2">
                  <ImageUpload label="Episode cover" value={d.artwork_url || ep.podcast_artwork_url} hint={d.artwork_url ? 'Square JPG/PNG.' : 'Using the podcast artwork. Upload to override.'}
                    onUpload={async (f) => {
                      if (readOnly) return;
                      const r = await uploadFile('episode_artwork', ep.id, f);
                      setD((x) => (x ? { ...x, artwork_url: r.url } : x));
                      setEp({ ...ep, artwork_url: r.url });
                    }} />
                  <Input label="…or cover URL" type="url" value={d.artwork_url} onChange={(e) => set('artwork_url', e.target.value)} placeholder="https://" />
                </div>
                <HostsEditor label="Hosts & guests" defaultRole="guest" value={d.hosts} onChange={(v) => set('hosts', v)} disabled={readOnly} />
              </Card>

              <Card title="SEO & AEO">
                <div className="grid-2">
                  <Input label="SEO title" value={d.seo_title} onChange={(e) => set('seo_title', e.target.value)} maxLength={120}
                    hint={`${d.seo_title.length}/60 recommended. Defaults to the episode title.`} />
                  <Input label="Canonical URL" type="url" value={d.canonical_url} onChange={(e) => set('canonical_url', e.target.value)} placeholder="https://" hint="Leave empty for the default." />
                </div>
                <Textarea label="Meta description" rows={3} value={d.meta_description} onChange={(e) => set('meta_description', e.target.value)} maxLength={320}
                  hint={`${d.meta_description.length}/160 recommended.`} />
                <Textarea label="Key topics" rows={4} value={d.key_topics} onChange={(e) => set('key_topics', e.target.value)} hint="One topic per line. Helps search and answer engines understand the episode." />
                <RowsEditor legend="FAQ" rows={d.faq} onChange={(v) => set('faq', v)} empty={{ question: '', answer: '' }} addLabel="+ Add question"
                  fields={[{ key: 'question', label: 'Question' }, { key: 'answer', label: 'Answer', multiline: true }]} />
                <RowsEditor legend="Citations / sources" rows={d.citations} onChange={(v) => set('citations', v)} empty={{ title: '', url: '' }} addLabel="+ Add citation"
                  fields={[{ key: 'title', label: 'Title' }, { key: 'url', label: 'URL', type: 'url', placeholder: 'https://' }]} />
              </Card>
            </fieldset>

            <TranscriptCard ep={ep} transcript={d.transcript} format={d.transcript_format} readOnly={readOnly}
              onTranscript={(v) => { set('transcript', v); setTDirty(true); }} onFormat={(v) => { set('transcript_format', v); setTDirty(true); }}
              onApproved={(e) => setEp(e)}
              onReload={async () => {
                try {
                  const r = await api<Loaded>(`/episodes/${ep.id}`);
                  if (tDirty && !window.confirm('Discard your unsaved transcript edits and load the saved transcript?')) return;
                  setTDirty(false);
                  setData(r);
                } catch (e) { toast('error', errMsg(e)); }
              }} />

            {!readOnly && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save episode</Button>
              </div>
            )}
          </form>
        </div>

        <aside className="c-editor__side" aria-label="Publishing">
          <Card title="Publishing">
            <p style={{ marginTop: 0 }}><Badge status={ep.status} /></p>
            <dl className="kv small" style={{ marginBottom: 12 }}>
              {ep.published_at && <><dt>Published</dt><dd>{fmtDate(ep.published_at, true)}</dd></>}
              {ep.scheduled_at && <><dt>Scheduled</dt><dd>{fmtDate(ep.scheduled_at, true)}</dd></>}
              <dt>Updated</dt><dd>{fmtDate(ep.updated_at, true)}</dd>
            </dl>
            <Field label="GUID" hint="Permanent unique ID used by podcast apps. It never changes — not even when audio or the slug changes — so listeners don’t get duplicates.">
              {(fid) => <input id={fid} className="mono" readOnly value={ep.guid} onFocus={(e) => e.target.select()} />}
            </Field>
            {!readOnly && (
              <div className="stack" style={{ gap: 10 }}>
                {!hasAudio && <p className="alert alert--warn small" style={{ margin: 0 }}>Upload audio before publishing.</p>}
                <div className="row">
                  {ep.status !== 'PUBLISHED' && <Button variant="primary" onClick={publish} loading={busy}>Publish now</Button>}
                  {(ep.status === 'PUBLISHED' || ep.status === 'SCHEDULED') && <Button onClick={unpublish} loading={busy}>Unpublish</Button>}
                  <Button onClick={preview}>Preview</Button>
                </div>
                {ep.status !== 'PUBLISHED' && (
                  <fieldset className="c-fieldset" style={{ margin: 0 }}>
                    <legend>Schedule</legend>
                    <div className="grid-2" style={{ gap: 8 }}>
                      <Input label="Date" type="date" value={sched.date} onChange={(e) => setSched({ ...sched, date: e.target.value })} />
                      <Input label="Time" type="time" value={sched.time} onChange={(e) => setSched({ ...sched, time: e.target.value })} />
                    </div>
                    <p className="hint" style={{ marginBottom: 8 }}>Interpreted in the site’s timezone: <strong>{tz}</strong>.</p>
                    <Button onClick={schedule} loading={busy} disabled={!sched.date}>⏰ Schedule</Button>
                  </fieldset>
                )}
              </div>
            )}
          </Card>
          {!readOnly && (
            <Card title="Danger zone">
              <ConfirmButton variant="danger" confirm={`Delete “${ep.title}”? This cannot be undone.`} onConfirm={remove} disabled={busy}>Delete episode</ConfirmButton>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
