'use client';

// Import / Export (PRD §18 RSS importer, §19 automatic sync, §88 CSV import + exports).
import { useState } from 'react';
import { del, download, get, post, put } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { RSSSource } from '@/lib/types';
import {
  Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, fmtDate, fmtDuration, useAction, useAsync,
} from '@/components/ui';

type TabKey = 'rss' | 'sources' | 'csv' | 'export';

const INTERVALS = [
  { value: 15, label: 'Every 15 minutes' }, { value: 30, label: 'Every 30 minutes' }, { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' }, { value: 1440, label: 'Daily' },
];
const intervalLabel = (m: number) => INTERVALS.find((i) => i.value === m)?.label ?? `Every ${m} min`;

export default function ImportsPage() {
  const [tab, setTab] = useState<TabKey>('rss');
  return (
    <>
      <PageHeader title="Import / Export" subtitle="Bring podcasts in from RSS or CSV, keep external feeds in sync, and export your data" />
      <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
        { key: 'rss', label: 'RSS Import' }, { key: 'sources', label: 'RSS Sources' }, { key: 'csv', label: 'CSV Import' }, { key: 'export', label: 'Export' },
      ]} />
      {tab === 'rss' && <RSSImport onImported={() => setTab('sources')} />}
      {tab === 'sources' && <RSSSources />}
      {tab === 'csv' && <CSVImport />}
      {tab === 'export' && <ExportTab />}
    </>
  );
}

// ---------------------------------------------------------------- RSS import
interface PreviewEpisode { guid: string; title: string; published_at: string; duration: number; audio_url: string; episode_number?: number | null; season_number?: number | null }
type FeedCategory = { Name?: string; Sub?: string; name?: string; sub?: string } | string;
interface Preview {
  feed: { title: string; description: string; author: string; owner_name?: string; owner_email: string; image_url: string; language?: string; explicit?: boolean;
    categories: FeedCategory[] | null; episodes: PreviewEpisode[] | null };
  episode_count: number;
}

const catLabel = (c: FeedCategory) => {
  if (typeof c === 'string') return c;
  const n = c.Name ?? c.name ?? '';
  const s = c.Sub ?? c.sub ?? '';
  return s ? `${n} › ${s}` : n;
};

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function RSSImport({ onImported }: { onImported: () => void }) {
  const { can, tenants, scopeTenantId } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'METADATA_ONLY' | 'MIRROR_AUDIO'>('METADATA_ONLY');
  const [sync, setSync] = useState(true);
  const [interval, setIntervalMin] = useState(60);
  const [target, setTarget] = useState<number>(scopeTenantId ?? 0);
  const pv = useAction();
  const imp = useAction();

  const doPreview = async () => {
    setPreview(null);
    const r = await pv.run(() => post<Preview>('/imports/rss/preview', { feed_url: url.trim() }));
    if (r) setPreview(r);
  };
  const doImport = async () => {
    const r = await imp.run(() => post('/imports/rss', {
      feed_url: url.trim(), mode, sync_enabled: sync, sync_interval_minutes: interval, ...(isSuper ? { tenant_id: target } : {}),
    }), 'Import queued — episodes will appear shortly');
    if (r !== undefined) { setPreview(null); setUrl(''); onImported(); }
  };

  return (
    <div className="stack">
      <Card title="Import from RSS feed">
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); doPreview(); }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Input label="RSS feed URL" type="url" required value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} placeholder="https://example.com/feed.xml" />
          </div>
          <div className="field"><Button type="submit" variant="primary" loading={pv.busy} disabled={!url.trim()}>Preview</Button></div>
        </form>
        <p className="hint" style={{ marginTop: 0 }}>The feed is fetched and validated, then podcast and episode metadata (and artwork) are imported.</p>
      </Card>

      {preview && (
        <>
          <Card title="Preview">
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              {preview.feed.image_url ? <img src={preview.feed.image_url} alt="" style={{ width: 120, height: 120, borderRadius: 10, objectFit: 'cover', flex: 'none' }} /> : <div className="imgup__preview imgup__preview--empty">No artwork</div>}
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 18 }}>{preview.feed.title || 'Untitled feed'}</h3>
                <p className="muted" style={{ margin: '4px 0' }}>{preview.feed.author || preview.feed.owner_name || 'Unknown author'}{preview.feed.owner_email && ` · ${preview.feed.owner_email}`}</p>
                <p className="small" style={{ margin: '4px 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{stripHtml(preview.feed.description || '')}</p>
                <div className="row small">
                  <Badge status="READY">{preview.episode_count} episode{preview.episode_count === 1 ? '' : 's'}</Badge>
                  {(preview.feed.categories ?? []).map((c, i) => <Badge key={i} status="NONE">{catLabel(c)}</Badge>)}
                  {preview.feed.language && <span className="muted">Language: {preview.feed.language}</span>}
                </div>
              </div>
            </div>
            {!!preview.feed.episodes?.length && (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table className="table">
                  <thead><tr><th>Episode</th><th>Published</th><th>Duration</th><th>Audio</th></tr></thead>
                  <tbody>
                    {preview.feed.episodes.map((e, i) => (
                      <tr key={e.guid || i}>
                        <td>{e.season_number || e.episode_number ? <span className="muted small">{e.season_number ? `S${e.season_number} ` : ''}{e.episode_number ? `E${e.episode_number} ` : ''}</span> : null}{e.title}</td>
                        <td className="small">{fmtDate(e.published_at)}</td>
                        <td className="small">{fmtDuration(e.duration)}</td>
                        <td className="small">{e.audio_url ? '✓' : <span style={{ color: 'var(--red)' }}>✗ missing</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.episode_count > (preview.feed.episodes?.length ?? 0) && <p className="hint">Showing the first {preview.feed.episodes?.length ?? 0} of {preview.episode_count} episodes.</p>}
          </Card>

          <Card title="Import options">
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Audio</legend>
              <label className="check"><input type="radio" name="mode" checked={mode === 'METADATA_ONLY'} onChange={() => setMode('METADATA_ONLY')} />
                <span>Import metadata only <small className="hint">— episodes keep playing from the original audio URLs</small></span></label>
              <label className="check"><input type="radio" name="mode" checked={mode === 'MIRROR_AUDIO'} onChange={() => setMode('MIRROR_AUDIO')} />
                <span>Mirror audio <small className="hint">— download and host the audio files on our storage</small></span></label>
            </fieldset>
            <div className="grid-2">
              <div>
                <Checkbox label="Automatic sync" checked={sync} onChange={setSync} hint="Import new episodes as they appear in the feed" />
                <Select label="Sync frequency" value={interval} disabled={!sync} onChange={(e) => setIntervalMin(Number(e.target.value))} options={INTERVALS} />
              </div>
              {isSuper && (
                <Select label="Target website" value={target} onChange={(e) => setTarget(Number(e.target.value))}
                  options={[{ value: 0, label: 'Central library (network)' }, ...tenants.map((t) => ({ value: t.id, label: `${t.name}${t.primary_domain ? ` — ${t.primary_domain}` : ''}` }))]}
                  hint="Library podcasts can later be assigned to any site." />
              )}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="primary" loading={imp.busy} onClick={doImport}>Import podcast</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- RSS sources
interface SyncLog { id: number; started_at: string; finished_at: string | null; status: string; new_episodes: number; updated_episodes: number; message: string }

function RSSSources() {
  const tq = useTenantQuery();
  const { scopeTenantId, can } = useAuth();
  const canEdit = can('SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR');
  const canDelete = can('SUPER_ADMIN', 'TENANT_ADMIN');
  const { data, error, loading, reload, setData } = useAsync(() => get<{ sources: RSSSource[]; intervals: number[] }>('/rss-sources', tq), [scopeTenantId]);
  const { run } = useAction();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [logsFor, setLogsFor] = useState<RSSSource | null>(null);

  const update = async (s: RSSSource, patch: Partial<Pick<RSSSource, 'sync_enabled' | 'sync_interval_minutes'>>) => {
    setBusyId(s.id);
    const r = await run(() => put(`/rss-sources/${s.id}`, patch), 'Saved');
    setBusyId(null);
    if (r !== undefined && data) setData({ ...data, sources: data.sources.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) });
  };
  const intervals = data?.intervals?.length ? data.intervals : INTERVALS.map((i) => i.value);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.sources.length) return <Empty>No RSS sources yet. Import a feed from the <strong>RSS Import</strong> tab.</Empty>;
  return (
    <>
      <div className="row row--between" style={{ marginBottom: 10 }}>
        <span className="muted small">{data.sources.length} feed{data.sources.length === 1 ? '' : 's'}</span>
        <Button size="sm" onClick={reload}>↻ Refresh</Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Podcast</th><th>Feed URL</th><th>Mode</th><th>Sync</th><th>Interval</th><th>Status</th><th>Last sync</th><th>Next sync</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.podcast_id ? <a className="cell-title" href={`/podcasts/${s.podcast_id}`}>{s.podcast_title ?? `Podcast #${s.podcast_id}`}</a> : <span className="muted">Not imported yet</span>}</td>
                <td className="small" style={{ maxWidth: 240, wordBreak: 'break-all' }}><a href={s.feed_url} target="_blank" rel="noopener noreferrer">{s.feed_url}</a></td>
                <td className="small">{s.import_mode === 'MIRROR_AUDIO' ? 'Mirror audio' : 'Metadata only'}</td>
                <td>
                  <label className="check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={s.sync_enabled} disabled={!canEdit || busyId === s.id} onChange={(e) => update(s, { sync_enabled: e.target.checked })} />
                    <span className="small">{s.sync_enabled ? 'On' : 'Off'}</span>
                  </label>
                </td>
                <td>
                  <label className="sr-only" htmlFor={`int-${s.id}`}>Sync interval</label>
                  <select id={`int-${s.id}`} className="input" style={{ width: 'auto' }} value={s.sync_interval_minutes} disabled={!canEdit || busyId === s.id}
                    onChange={(e) => update(s, { sync_interval_minutes: Number(e.target.value) })}>
                    {intervals.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
                  </select>
                </td>
                <td>
                  <Badge status={s.status} />
                  {s.last_error && <div className="small" style={{ color: 'var(--red)', maxWidth: 240 }}>{s.last_error}</div>}
                </td>
                <td className="small">{fmtDate(s.last_synced_at, true)}</td>
                <td className="small">{s.sync_enabled ? fmtDate(s.next_sync_at, true) : '—'}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    {canEdit && <Button size="sm" loading={busyId === -s.id} onClick={async () => { setBusyId(-s.id); const r = await run(() => post(`/rss-sources/${s.id}/sync`), 'Sync queued'); setBusyId(null); if (r !== undefined) reload(); }}>Sync now</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setLogsFor(s)}>Logs</Button>
                    {canDelete && <Button size="sm" variant="danger" onClick={async () => {
                      if (!window.confirm(`Stop syncing ${s.feed_url}? The imported podcast and its episodes are kept.`)) return;
                      const r = await run(() => del(`/rss-sources/${s.id}`), 'RSS source deleted');
                      if (r !== undefined) reload();
                    }}>Delete</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal title={logsFor ? `Sync logs — ${logsFor.podcast_title ?? logsFor.feed_url}` : 'Sync logs'} open={!!logsFor} onClose={() => setLogsFor(null)} wide>
        {logsFor && <SyncLogs id={logsFor.id} />}
      </Modal>
    </>
  );
}

function SyncLogs({ id }: { id: number }) {
  const { data, error, loading, reload } = useAsync(() => get<SyncLog[]>(`/rss-sources/${id}/logs`), [id]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty>No sync runs yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Started</th><th>Duration</th><th>Status</th><th>New</th><th>Updated</th><th>Message</th></tr></thead>
        <tbody>
          {data.map((l) => (
            <tr key={l.id}>
              <td className="small">{fmtDate(l.started_at, true)}</td>
              <td className="small">{l.finished_at ? `${Math.max(0, Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000))}s` : '—'}</td>
              <td><Badge status={l.status} /></td>
              <td>{l.new_episodes}</td>
              <td>{l.updated_episodes}</td>
              <td className="small">{l.message || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- CSV import
const CSV_COLUMNS: Record<'podcasts' | 'episodes', string[]> = {
  podcasts: ['title', 'slug', 'description', 'short_description', 'author', 'owner_name', 'owner_email', 'language', 'explicit', 'category', 'subcategory', 'artwork_url', 'website_url', 'copyright', 'tags', 'status'],
  episodes: ['podcast_slug', 'title', 'slug', 'description', 'short_description', 'episode_number', 'season_number', 'episode_type', 'audio_url', 'audio_size', 'duration', 'publish_date', 'explicit', 'tags', 'status', 'guid', 'transcript'],
};
const CSV_NOTES: Record<'podcasts' | 'episodes', string> = {
  podcasts: 'Required: title. tags are separated with ";" (a;b). explicit is true/false. status: DRAFT, PUBLISHED, SCHEDULED or ARCHIVED. category matches a category name or slug.',
  episodes: 'Required: podcast_slug, title. episode_type: full, trailer or bonus. duration in seconds. publish_date like 2026-10-20 09:00. tags separated with ";".',
};

function CSVImport() {
  const { can, tenants, scopeTenantId } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const [type, setType] = useState<'podcasts' | 'episodes'>('podcasts');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<number>(scopeTenantId ?? 0);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const { run, busy } = useAction();

  const template = () => {
    const blob = new Blob([CSV_COLUMNS[type].join(',') + '\n'], { type: 'text/csv' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = `${type}-template.csv`;
    a.click();
    URL.revokeObjectURL(u);
  };

  const submit = async () => {
    setResult(null);
    const csv = file ? await file.text() : text;
    const r = await run(() => post<{ created: number; errors: string[] }>('/imports/csv', { csv }, { type, ...(isSuper && type === 'podcasts' && target ? { tenant_id: target } : {}) }));
    if (r) {
      setResult({ created: r.created, errors: r.errors ?? [] });
      if (r.created && !(r.errors ?? []).length) { setFile(null); setText(''); setFileKey((k) => k + 1); }
    }
  };

  return (
    <div className="grid-2">
      <Card title="CSV import">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid-2">
            <Select label="Import type" value={type} onChange={(e) => { setType(e.target.value as 'podcasts' | 'episodes'); setResult(null); }}
              options={[{ value: 'podcasts', label: 'Podcasts' }, { value: 'episodes', label: 'Episodes' }]} />
            {isSuper && type === 'podcasts' ? (
              <Select label="Owner website" value={target} onChange={(e) => setTarget(Number(e.target.value))}
                options={[{ value: 0, label: 'Central library (network)' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
            ) : <div />}
          </div>
          <Field label="CSV file" hint="UTF-8 with a header row.">
            {(id) => <input key={fileKey} id={id} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <Textarea label="…or paste CSV" rows={8} className="mono" value={text} disabled={!!file} onChange={(e) => setText(e.target.value)}
            placeholder={CSV_COLUMNS[type].join(',')} hint={file ? 'A file is selected — the pasted text is ignored.' : undefined} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="link" onClick={template}>⇩ Download {type} template</button>
            <Button type="submit" variant="primary" loading={busy} disabled={!file && !text.trim()}>Import</Button>
          </div>
        </form>
        {result && (
          <div style={{ marginTop: 14 }}>
            <p className={`alert ${result.errors.length ? (result.created ? 'alert--warn' : 'alert--error') : 'alert--success'}`}>
              {result.created ? '✓ ' : ''}{result.created} {type} created{result.errors.length ? `, ${result.errors.length} row error(s)` : ''}.
            </p>
            {result.errors.length > 0 && (
              <ul className="small" style={{ maxHeight: 220, overflow: 'auto', margin: 0, paddingLeft: 18, color: 'var(--red)' }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>
      <Card title="Expected columns">
        <p className="small muted" style={{ marginTop: 0 }}>{CSV_NOTES[type]}</p>
        <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{CSV_COLUMNS[type].join(',')}</pre>
        <ul className="small" style={{ columns: 2, paddingLeft: 18 }}>
          {CSV_COLUMNS[type].map((c) => <li key={c} className="mono">{c}</li>)}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Export
const EXPORTS: { kind: string; title: string; desc: string; roles?: ('SUPER_ADMIN' | 'TENANT_ADMIN' | 'EDITOR' | 'VIEWER')[] }[] = [
  { kind: 'podcasts', title: 'Podcast metadata', desc: 'Titles, slugs, owners, categories, status and feed URLs.' },
  { kind: 'episodes', title: 'Episode metadata', desc: 'Every episode with numbers, dates, durations, audio URLs and GUIDs.' },
  { kind: 'distribution', title: 'Distribution status', desc: 'Every podcast × platform record with status and external links.' },
  { kind: 'analytics', title: 'Analytics', desc: 'Daily event counts per site, podcast and episode.', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR', 'VIEWER'] },
];

function ExportTab() {
  const tq = useTenantQuery();
  const { can, scopeTenantId, tenants } = useAuth();
  const { run } = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const scopeName = scopeTenantId ? tenants.find((t) => t.id === scopeTenantId)?.name : null;
  const go = async (kind: string, format: 'csv' | 'json') => {
    setBusy(`${kind}-${format}`);
    await run(() => download(`/exports/${kind}`, `${kind}.${format}`, { ...tq, format }), `Downloaded ${kind}.${format}`);
    setBusy(null);
  };
  return (
    <>
      <p className="muted">{can('SUPER_ADMIN') ? <>Exporting {scopeName ? <strong>{scopeName}</strong> : <strong>the whole network</strong>} — change the scope in the top bar.</> : 'Exports include the data of your website.'}</p>
      <div className="grid-2">
        {EXPORTS.filter((e) => !e.roles || can(...e.roles)).map((e) => (
          <Card key={e.kind} title={e.title}>
            <p className="muted small" style={{ marginTop: 0 }}>{e.desc}</p>
            <div className="row">
              <Button loading={busy === `${e.kind}-csv`} onClick={() => go(e.kind, 'csv')}>⇩ CSV</Button>
              <Button loading={busy === `${e.kind}-json`} onClick={() => go(e.kind, 'json')}>⇩ JSON</Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
