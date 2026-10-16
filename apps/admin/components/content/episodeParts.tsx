'use client';

import { useRef, useState, type DragEvent } from 'react';
import { ApiError, post, put, uploadFile } from '@/lib/api';
import type { AudioFile, Episode } from '@/lib/types';
import { Badge, Button, Card, Field, Input, Progress, Select, Textarea, cx, errMsg, fmtBytes, fmtDate, fmtDuration, useAction, useToast } from '@/components/ui';

const AUDIO_EXT = ['mp3', 'm4a', 'wav'];
const AUDIO_ACCEPT = '.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav';
const MAX_AUDIO = 1024 * 1024 * 1024; // 1 GB

// ---------------------------------------------------------------- Audio
export function AudioCard({ ep, audio, readOnly, onChanged }: { ep: Episode; audio: AudioFile | null; readOnly: boolean; onChanged: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState('');
  const [showExternal, setShowExternal] = useState(!audio && !!ep.audio_url);
  const [ext, setExt] = useState({ url: audio ? '' : ep.audio_url, size: ep.audio_size ? String(ep.audio_size) : '', duration: ep.duration ? String(ep.duration) : '' });
  const { run, busy } = useAction();

  const processing = audio?.status === 'PROCESSING' || audio?.status === 'UPLOADED' || ep.status === 'PROCESSING';
  const failed = audio?.status === 'FAILED' || ep.status === 'FAILED';
  const ready = audio?.status === 'READY' || (!audio && !!ep.audio_url);

  const upload = async (f: File) => {
    const extn = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!AUDIO_EXT.includes(extn)) { toast('error', 'Unsupported file. Please upload an MP3, M4A or WAV file.'); return; }
    if (f.size > MAX_AUDIO) { toast('error', 'File is too large (max 1 GB).'); return; }
    setFileName(f.name);
    setProgress(0);
    try {
      await uploadFile('episode_audio', ep.id, f, (p) => setProgress(p));
      toast('success', 'Audio uploaded — processing started');
      onChanged();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setProgress(null);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (readOnly || progress !== null) return;
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };
  const retry = async () => {
    const ok = await run(async () => { await post(`/episodes/${ep.id}/audio/retry`); return true; }, 'Audio processing re-queued');
    if (ok) onChanged();
  };
  const saveExternal = async () => {
    const url = ext.url.trim();
    if (!/^https?:\/\//i.test(url)) { toast('error', 'Audio URL must start with http:// or https://'); return; }
    const ok = await run(async () => {
      await put(`/episodes/${ep.id}`, { audio_url: url, audio_size: Number(ext.size) || 0, duration: Number(ext.duration) || 0 });
      return true;
    }, 'External audio saved');
    if (ok) onChanged();
  };

  return (
    <Card title="Audio" actions={audio ? <Badge status={audio.status} /> : ep.audio_url ? <Badge status="READY">External URL</Badge> : <Badge status="NONE">No audio</Badge>}>
      {failed && (
        <div className="alert alert--error" role="alert">
          <strong>Audio processing failed.</strong> Reason: {audio?.error_message || ep.processing_error || 'unknown error'}
          {!readOnly && <> <Button size="sm" onClick={retry} loading={busy}>Retry</Button></>}
          <div className="small" style={{ marginTop: 4 }}>You can also upload a different file below.</div>
        </div>
      )}
      {processing && !failed && (
        <div className="alert alert--info" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Processing audio (FFmpeg: metadata, normalisation, MP3 output)… This page refreshes automatically.
        </div>
      )}

      {audio && (
        <dl className="kv" style={{ marginBottom: 12 }}>
          <dt>File</dt><dd>{audio.original_name || '—'}</dd>
          <dt>Status</dt><dd><Badge status={audio.status} />{audio.attempts > 0 && <span className="muted small"> · {audio.attempts} attempt(s)</span>}</dd>
          <dt>Codec</dt><dd>{audio.codec || '—'}{audio.sample_rate ? ` · ${(audio.sample_rate / 1000).toFixed(1)} kHz` : ''}{audio.channels ? ` · ${audio.channels === 1 ? 'mono' : audio.channels === 2 ? 'stereo' : `${audio.channels} ch`}` : ''}</dd>
          <dt>Bitrate</dt><dd>{audio.bitrate ? `${Math.round(audio.bitrate / 1000)} kbps` : '—'}</dd>
          <dt>Duration</dt><dd>{fmtDuration(audio.duration || ep.duration)}</dd>
          <dt>Size</dt><dd>{fmtBytes(audio.processed_size || audio.original_size)}</dd>
          <dt>Uploaded</dt><dd>{fmtDate(audio.created_at, true)}</dd>
        </dl>
      )}
      {!audio && ep.audio_url && (
        <dl className="kv" style={{ marginBottom: 12 }}>
          <dt>URL</dt><dd className="mono">{ep.audio_url}</dd>
          <dt>Duration</dt><dd>{fmtDuration(ep.duration)}</dd>
          <dt>Size</dt><dd>{fmtBytes(ep.audio_size)}</dd>
        </dl>
      )}
      {ready && ep.audio_url && <audio controls preload="none" src={ep.audio_url} style={{ width: '100%', marginBottom: 12 }}>Your browser does not support audio playback.</audio>}

      {!readOnly && (
        <>
          <div className={cx('upload-zone', drag && 'is-drag')} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            {progress !== null ? (
              <div style={{ textAlign: 'left' }}>
                <p style={{ marginTop: 0 }}>Uploading <strong>{fileName}</strong>… {Math.round(progress * 100)}%</p>
                <Progress value={progress * 100} label="Upload progress" />
              </div>
            ) : (
              <>
                <p style={{ margin: '0 0 8px' }}><strong>{audio || ep.audio_url ? 'Replace audio' : 'Upload audio'}</strong> — drag & drop a file here, or</p>
                <input ref={inputRef} id={`audio-${ep.id}`} type="file" accept={AUDIO_ACCEPT} className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
                <Button onClick={() => inputRef.current?.click()}>Choose file…</Button>
                <p className="hint" style={{ marginTop: 8 }}>MP3, M4A or WAV. Converted to MP3 (128–192 kbps) for publishing. GUID stays the same when you replace audio.</p>
              </>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="link" aria-expanded={showExternal} onClick={() => setShowExternal((v) => !v)}>
              {showExternal ? '▾' : '▸'} Use an external audio URL instead
            </button>
            {showExternal && (
              <div style={{ marginTop: 10 }}>
                <Input label="Audio URL" type="url" placeholder="https://cdn.example.com/episode.mp3" value={ext.url} onChange={(e) => setExt({ ...ext, url: e.target.value })} />
                <div className="grid-2">
                  <Input label="File size (bytes)" type="number" min={0} value={ext.size} onChange={(e) => setExt({ ...ext, size: e.target.value })} hint="Required for the RSS enclosure." />
                  <Input label="Duration (seconds)" type="number" min={0} value={ext.duration} onChange={(e) => setExt({ ...ext, duration: e.target.value })} />
                </div>
                <Button onClick={saveExternal} loading={busy} disabled={!ext.url.trim()}>Save external audio</Button>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Transcript
export function TranscriptCard({ ep, transcript, format, onTranscript, onFormat, readOnly, onReload, onApproved }: {
  ep: Episode; transcript: string; format: string; onTranscript: (v: string) => void; onFormat: (v: string) => void; readOnly: boolean;
  onReload: () => void; onApproved: (e: Episode) => void;
}) {
  const toast = useToast();
  const { run, busy } = useAction();
  const [genMsg, setGenMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);

  const generate = async () => {
    setGenBusy(true);
    setGenMsg(null);
    try {
      await post(`/episodes/${ep.id}/transcript/generate`);
      setGenMsg({ kind: 'info', text: 'AI transcript generation queued. It appears here when ready — use “Reload transcript”. AI transcripts must be reviewed before they are shown publicly.' });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'not_configured' || e.status === 422)) {
        setGenMsg({ kind: 'warn', text: `AI transcription isn’t available: ${e.message}. Ask a super admin to configure a transcription provider in System settings, or paste/upload a transcript.` });
      } else toast('error', errMsg(e));
    } finally {
      setGenBusy(false);
    }
  };
  const approve = async () => {
    const r = await run(() => put<Episode>(`/episodes/${ep.id}`, { transcript_approved: true }), 'Transcript approved');
    if (r) onApproved(r);
  };

  return (
    <Card title="Transcript" actions={ep.transcript_source && <span className="muted small">Source: {ep.transcript_source}{ep.transcript_approved ? ' · approved' : ''}</span>}>
      {ep.transcript_source === 'ai' && !ep.transcript_approved && ep.transcript && (
        <div className="alert alert--warn row row--between" role="status">
          <span>⚠ AI transcript needs review before it is published on the site.</span>
          {!readOnly && <Button size="sm" onClick={approve} loading={busy}>Approve transcript</Button>}
        </div>
      )}
      {genMsg && <div className={`alert alert--${genMsg.kind}`} role="status">{genMsg.text}</div>}
      <p className="muted small" style={{ marginTop: 0 }}>Transcripts improve accessibility, SEO and answer-engine discoverability.</p>
      <Textarea label="Transcript text" rows={10} value={transcript} onChange={(e) => onTranscript(e.target.value)} readOnly={readOnly} className="mono" />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ width: 160 }}>
          <Select label="Format" value={format || 'txt'} onChange={(e) => onFormat(e.target.value)} disabled={readOnly}
            options={[{ value: 'txt', label: 'Plain text (TXT)' }, { value: 'srt', label: 'SubRip (SRT)' }, { value: 'vtt', label: 'WebVTT (VTT)' }]} />
        </div>
        {!readOnly && (
          <>
            <Field label="Upload transcript file">
              {(id) => (
                <input id={id} type="file" accept=".txt,.srt,.vtt,text/plain,text/vtt,application/x-subrip" disabled={upBusy} onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setUpBusy(true);
                  try { await uploadFile('transcript', ep.id, f); toast('success', 'Transcript uploaded'); onReload(); } catch (err) { toast('error', errMsg(err)); } finally { setUpBusy(false); }
                }} />
              )}
            </Field>
            <div className="field"><Button onClick={generate} loading={genBusy}>Generate with AI</Button></div>
            <div className="field"><Button variant="ghost" onClick={onReload}>Reload transcript</Button></div>
          </>
        )}
      </div>
      {ep.transcript_url && <p className="small muted">Transcript file: <a href={ep.transcript_url} target="_blank" rel="noopener noreferrer">{ep.transcript_url}</a></p>}
    </Card>
  );
}
