'use client';

// Shared building blocks for the Distribution area (PRD §20–27, §95, §97).
import { useState, type ReactNode } from 'react';
import { get, post } from '@/lib/api';
import { DIST_STATUSES, type DistStatus, type Distribution, type Platform } from '@/lib/types';
import { Badge, Button, Empty, ErrorBox, Input, Modal, Select, Spinner, Textarea, fmtDate, useAction, useAsync } from '@/components/ui';

export const ISSUE_STATUSES: DistStatus[] = ['ACTION_REQUIRED', 'FAILED', 'REJECTED'];
export const isIssue = (s: DistStatus) => ISSUE_STATUSES.includes(s);

export const statusLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Leading symbol used in the PRD §24 dashboard (✓ live, ⏳ in progress, ⚠ issue, • not started). */
export function statusSymbol(s: DistStatus): string {
  if (s === 'LIVE') return '✓';
  if (isIssue(s)) return '⚠';
  if (s === 'SUBMITTED' || s === 'PENDING' || s === 'PENDING_REVIEW' || s === 'READY') return '⏳';
  if (s === 'DISCOVERY_PENDING') return '🔍';
  if (s === 'PAUSED') return '⏸';
  if (s === 'UNAVAILABLE') return '✗';
  return '•';
}

export function PlatformName({ name, color }: { name: string; color?: string }) {
  return <span><span className="platform-dot" style={{ background: color || '#94a3b8' }} aria-hidden="true" />{name}</span>;
}

/** Active platform registry (never hard-coded). */
export function usePlatforms(activeOnly = true) {
  return useAsync(() => get<Platform[]>('/platforms', activeOnly ? { active: 1 } : undefined), [activeOnly]);
}

export type EditMode = 'update' | 'submitted' | 'resolve' | 'note' | 'verify';

const MODE_TITLE: Record<EditMode, string> = { update: 'Update distribution', submitted: 'Mark submitted', resolve: 'Resolve issue', note: 'Add note', verify: 'Verify ownership' };

/**
 * Editor for one podcast × platform distribution record → POST /distribution/:podcastId/:platformId.
 * `record` may be a NOT_STARTED placeholder (id 0).
 */
export function DistributionEditor({ record, platform, mode, onClose, onSaved }: {
  record: Distribution | null; platform?: Platform; mode: EditMode; onClose: () => void; onSaved: () => void;
}) {
  const open = !!record;
  return (
    <Modal title={record ? `${MODE_TITLE[mode]} — ${record.platform_name}` : MODE_TITLE[mode]} open={open} onClose={onClose} wide={mode === 'update'}>
      {record && <EditorBody key={`${record.podcast_id}-${record.platform_id}-${mode}`} record={record} platform={platform} mode={mode} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function EditorBody({ record, platform, mode, onClose, onSaved }: { record: Distribution; platform?: Platform; mode: EditMode; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [status, setStatus] = useState<DistStatus>(mode === 'submitted' ? 'SUBMITTED' : mode === 'resolve' ? (record.external_url ? 'LIVE' : 'PENDING') : mode === 'verify' ? 'LIVE' : record.status);
  const [verificationMethod, setVerificationMethod] = useState(record.verification_method || '');
  const [externalUrl, setExternalUrl] = useState(record.external_url);
  const [externalId, setExternalId] = useState(record.external_id);
  const [notes, setNotes] = useState(record.notes);
  const [issueReason, setIssueReason] = useState(record.issue_reason);
  const [note, setNote] = useState('');
  const [accountLabel, setAccountLabel] = useState(record.account_label || '');
  const [method, setMethod] = useState<string>(record.method || 'MANUAL');

  const needsUrl = status === 'LIVE' && !externalUrl.trim() && !(externalId.trim() && platform?.url_pattern);
  const save = async () => {
    let body: Record<string, unknown>;
    if (mode === 'note') body = { note };
    else if (mode === 'submitted') body = { status: 'SUBMITTED', note: note || 'Marked submitted', account_label: accountLabel.trim(), method };
    else if (mode === 'resolve') body = { status, note: note || 'Issue resolved', ...(status === 'LIVE' ? { external_url: externalUrl.trim() } : {}) };
    else if (mode === 'verify') body = { status, external_url: externalUrl.trim(), verification_method: verificationMethod, note: note || 'Ownership verified' };
    else body = {
      status, external_url: externalUrl.trim(), external_id: externalId.trim(), notes,
      account_label: accountLabel.trim(), method,
      ...(isIssue(status) ? { issue_reason: issueReason } : {}), note,
    };
    const r = await run(() => post<Distribution>(`/distribution/${record.podcast_id}/${record.platform_id}`, body), 'Distribution updated');
    if (r) { onSaved(); onClose(); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>{record.podcast_title}</strong> on <PlatformName name={record.platform_name} color={record.platform_color} /> · currently <Badge status={record.status} />
      </p>
      {record.issue_reason && isIssue(record.status) && (
        <div className="alert alert--warn"><strong>Reason:</strong> {record.issue_reason}</div>
      )}

      {mode === 'update' && (
        <>
          {platform?.instructions && (
            <div className="alert alert--info">
              <strong>How to submit to {platform.name}:</strong>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: '8px 0 4px' }}>{platform.instructions}</pre>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {platform.submit_url && <a href={platform.submit_url} target="_blank" rel="noopener noreferrer">Open {platform.name} →</a>}
                {platform.help_url && <a href={platform.help_url} target="_blank" rel="noopener noreferrer">Help guide →</a>}
              </div>
              {platform.account_required && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Account required{platform.verification_required ? ' · Verification required' : ''}</p>}
              {platform.notes && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{platform.notes}</p>}
            </div>
          )}
          <div className="grid-2">
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as DistStatus)}
              options={DIST_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
            <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}
              options={[{ value: 'MANUAL', label: 'Manual' }, { value: 'CLAIM', label: 'Claim' }, { value: 'INDEXED', label: 'Indexed / Discovery' }, { value: 'API', label: 'API' }]} />
          </div>
          <div className="grid-2">
            <Input label="External ID" value={externalId} onChange={(e) => setExternalId(e.target.value)}
              hint={platform?.url_pattern ? <>Builds the URL from <span className="mono">{platform.url_pattern}</span></> : undefined} />
            <Input label="Account / email" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)}
              placeholder="e.g. podcast@company.com" hint="Account used for this platform." />
          </div>
          <Input label="External URL" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…"
            hint={status === 'LIVE' ? 'Required for LIVE (or an external ID when the platform has a URL pattern).' : undefined} />
          {isIssue(status) && <Input label="Issue reason" value={issueReason} onChange={(e) => setIssueReason(e.target.value)} placeholder="e.g. Artwork does not meet requirements" />}
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          <Input label="Note for history" value={note} onChange={(e) => setNote(e.target.value)} hint="Optional — recorded in the status history." />
        </>
      )}

      {mode === 'resolve' && (
        <>
          <Select label="New status" value={status} onChange={(e) => setStatus(e.target.value as DistStatus)}
            options={[{ value: 'PENDING', label: 'Pending (resubmitted / waiting)' }, { value: 'LIVE', label: 'Live' }]} />
          {status === 'LIVE' && <Input label="External URL" type="url" required value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" />}
          <Textarea label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was fixed?" />
        </>
      )}

      {mode === 'submitted' && (
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Submitted via Spotify for Creators" />
      )}

      {mode === 'verify' && (
        <>
          <p style={{ margin: 0 }}>Confirm that ownership has been verified on <strong>{record.platform_name}</strong>.</p>
          <Select label="Verification method" value={verificationMethod} onChange={(e) => setVerificationMethod(e.target.value)}
            options={[{ value: '', label: 'Select…' }, { value: 'EMAIL_CODE', label: 'Email verification code' }, { value: 'DNS_TXT', label: 'DNS TXT record' },
              { value: 'HTTP_FILE', label: 'HTTP file upload' }, { value: 'META_TAG', label: 'Meta tag' }, { value: 'MANUAL', label: 'Manual review by platform' }]} />
          <Select label="New status" value={status} onChange={(e) => setStatus(e.target.value as DistStatus)}
            options={[{ value: 'LIVE', label: 'Live — verified and listed' }, { value: 'PENDING', label: 'Pending — still waiting' }]} />
          {status === 'LIVE' && <Input label="External URL" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" />}
          <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Verified via email code on 2026-10-14" />
        </>
      )}

      {mode === 'note' && (
        <Textarea label="Note" required value={note} onChange={(e) => setNote(e.target.value)} rows={4} hint="Added to the status history." />
      )}

      {needsUrl && <p className="field-error" role="alert">LIVE requires an external URL.</p>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={needsUrl || (mode === 'note' && !note.trim())}>Save</Button>
      </div>
    </form>
  );
}

interface DistEvent { from_status: string; to_status: string; note: string; user_email: string; created_at: string }

/** Status history modal (GET /distribution/:podcastId/:platform/events). */
export function HistoryModal({ record, onClose }: { record: Distribution | null; onClose: () => void }) {
  return (
    <Modal title={record ? `History — ${record.platform_name}` : 'History'} open={!!record} onClose={onClose} wide>
      {record && <HistoryBody record={record} />}
    </Modal>
  );
}

function HistoryBody({ record }: { record: Distribution }) {
  const { data, error, loading, reload } = useAsync(() => get<DistEvent[]>(`/distribution/${record.podcast_id}/${record.platform_id}/events`), [record.podcast_id, record.platform_id]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.length) return <Empty>No status changes recorded yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>When</th><th>Change</th><th>Note</th><th>By</th></tr></thead>
        <tbody>
          {data.map((e, i) => (
            <tr key={i}>
              <td className="small">{fmtDate(e.created_at, true)}</td>
              <td>{e.from_status === e.to_status ? <Badge status={e.to_status} /> : <><Badge status={e.from_status} /> → <Badge status={e.to_status} /></>}</td>
              <td>{e.note || <span className="muted">—</span>}</td>
              <td className="small">{e.user_email || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Table of distribution records (used by status tabs). */
export function DistributionTable({ items, canManage, onEdit, onHistory }: {
  items: Distribution[]; canManage: boolean; onEdit: (d: Distribution, m: EditMode) => void; onHistory: (d: Distribution) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Podcast</th><th>Platform</th><th>Status</th><th>Link</th><th>Submitted</th><th>Approved</th><th>Last checked</th><th>Issue</th><th><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id || `${d.podcast_id}-${d.platform_id}`}>
              <td><a className="cell-title" href={`/distribution/${d.podcast_id}`}>{d.podcast_title}</a></td>
              <td style={{ whiteSpace: 'nowrap' }}><PlatformName name={d.platform_name} color={d.platform_color} /></td>
              <td><Badge status={d.status} /></td>
              <td>{d.external_url ? <a href={d.external_url} target="_blank" rel="noopener noreferrer" aria-label={`View ${d.podcast_title} on ${d.platform_name}`}>View →</a> : <span className="muted">—</span>}</td>
              <td className="small">{fmtDate(d.submitted_at)}</td>
              <td className="small">{fmtDate(d.approved_at)}</td>
              <td className="small">{fmtDate(d.last_checked_at)}</td>
              <td className="small" style={{ maxWidth: 260 }}>{d.issue_reason ? <span style={{ color: 'var(--red)' }}>{d.issue_reason}</span> : <span className="muted">—</span>}</td>
              <td>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                  {canManage && <Button size="sm" onClick={() => onEdit(d, 'update')}>Update</Button>}
                  {canManage && isIssue(d.status) && <Button size="sm" onClick={() => onEdit(d, 'resolve')}>Resolve</Button>}
                  <Button size="sm" variant="ghost" onClick={() => onHistory(d)}>History</Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { window.prompt('Copy this value', text); }
    }}>{done ? '✓ Copied' : label}</Button>
  );
}
