'use client';

// Per-podcast Distribution dashboard (PRD §24), readiness checklist (§26), submission (§25), issues (§97).
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { get, post } from '@/lib/api';
import type { Distribution, Platform, Podcast, Readiness } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Progress, Spinner, cx, fmtDate, useAction, useAsync } from '@/components/ui';
import { CopyButton, DistributionEditor, HistoryModal, PlatformName, isIssue, statusSymbol, usePlatforms, type EditMode } from '@/components/distribution/shared';

interface PodcastDistribution { platforms: Distribution[]; live: number; total: number; progress_percent: number; readiness: Readiness; can_manage: boolean }
interface SubmitResult { distribution: Distribution; mode: 'manual' | 'api'; submit_url?: string; feed_url?: string }

export default function PodcastDistributionPage() {
  const params = useParams<{ podcastId: string }>();
  const id = Number(params.podcastId);
  const { data, error, loading, reload } = useAsync(() => get<PodcastDistribution>(`/distribution/${id}`), [id]);
  const podcast = useAsync(() => get<Podcast>(`/podcasts/${id}`), [id]);
  const platforms = usePlatforms(false);
  const platformMap = useMemo(() => new Map((platforms.data ?? []).map((p) => [p.id, p])), [platforms.data]);

  const [edit, setEdit] = useState<{ d: Distribution; m: EditMode } | null>(null);
  const [hist, setHist] = useState<Distribution | null>(null);
  const [submitFor, setSubmitFor] = useState<Distribution | null>(null);

  if (!Number.isFinite(id) || id <= 0) return <ErrorBox error="Invalid podcast id" />;
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const title = podcast.data?.title ?? data.platforms[0]?.podcast_title ?? `Podcast #${id}`;
  const rd = data.readiness;
  const issues = data.platforms.filter((d) => isIssue(d.status));

  return (
    <>
      <PageHeader back={{ href: '/distribution?tab=podcasts', label: 'Distribution' }} title={title} subtitle="Podcast distribution"
        actions={<>
          <a className="btn btn--primary" href={`/distribution/${id}/wizard`}>Start Wizard</a>
          <a className="btn" href={`/podcasts/${id}`}>Edit podcast</a>
          <Button onClick={() => { reload(); podcast.reload(); }}>↻ Refresh</Button>
        </>} />

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title="Progress">
          <p style={{ margin: '0 0 8px' }}>
            <span style={{ fontSize: 32, fontWeight: 800 }}>{data.live} / {data.total}</span> <span className="muted">Platforms Live</span>
          </p>
          <Progress value={data.progress_percent} label="Platforms live" />
          <p className="small muted" style={{ marginBottom: 0 }}>
            <strong>{data.progress_percent}%</strong> live{issues.length > 0 && <> · <span style={{ color: 'var(--red)' }}>⚠ {issues.length} need attention</span></>}
          </p>
        </Card>
        <ReadinessCard rd={rd} />
      </div>

      {!data.can_manage && <p className="alert alert--info">You can view this podcast&apos;s distribution, but only tenant admins can change it.</p>}

      <div className="dist-grid">
        {data.platforms.map((d) => {
          const pl = platformMap.get(d.platform_id);
          const issue = isIssue(d.status);
          const canSubmit = d.status !== 'LIVE' && d.status !== 'SUBMITTED' && d.status !== 'PENDING' && d.status !== 'PENDING_REVIEW' && d.status !== 'PAUSED';
          return (
            <article key={d.platform_id} className={cx('dist-card', d.status === 'LIVE' && 'is-live', issue && 'is-issue')} aria-label={`${d.platform_name}: ${d.status.replace(/_/g, ' ')}`}>
              <div className="dist-card__head">
                <strong><span aria-hidden="true" style={{ marginRight: 4 }}>{statusSymbol(d.status)}</span><PlatformName name={d.platform_name} color={d.platform_color} /></strong>
                <Badge status={d.status} />
              </div>
              {d.status === 'LIVE' && d.external_url && (
                <a href={d.external_url} target="_blank" rel="noopener noreferrer" aria-label={`View on ${d.platform_name}`}>View →</a>
              )}
              {d.status !== 'LIVE' && d.external_url && <a className="small" href={d.external_url} target="_blank" rel="noopener noreferrer">{d.external_url}</a>}
              <dl className="kv small">
                <dt>Submitted</dt><dd>{fmtDate(d.submitted_at)}</dd>
                <dt>Approved</dt><dd>{fmtDate(d.approved_at)}</dd>
                <dt>Last checked</dt><dd>{fmtDate(d.last_checked_at, true)}</dd>
                {pl && <><dt>Type</dt><dd>{pl.submission_type === 'API' ? 'API (automated)' : 'Manual'}</dd></>}
                {d.method && d.method !== 'MANUAL' && <><dt>Method</dt><dd>{d.method}</dd></>}
                {d.account_label && <><dt>Account</dt><dd>{d.account_label}</dd></>}
                {d.submitted_by && <><dt>By</dt><dd>{d.submitted_by}</dd></>}
                {d.verified_at && <><dt>Verified</dt><dd>{fmtDate(d.verified_at)}</dd></>}
              </dl>
              {issue && d.issue_reason && <div className="alert alert--error small" style={{ margin: 0 }}><strong>Reason:</strong> {d.issue_reason}</div>}
              {d.notes && <p className="small muted" style={{ margin: 0 }}>Note: {d.notes}</p>}
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                {data.can_manage && <Button size="sm" onClick={() => setEdit({ d, m: 'update' })}>Update</Button>}
                {data.can_manage && canSubmit && (
                  <Button size="sm" variant="primary" disabled={!rd.ready} onClick={() => setSubmitFor(d)}
                    title={rd.ready ? undefined : `Readiness is ${rd.percent}% — fix: ${rd.missing.join(', ')}`}>Submit</Button>
                )}
                {data.can_manage && issue && <Button size="sm" onClick={() => setEdit({ d, m: 'resolve' })}>Resolve</Button>}
                {data.can_manage && pl?.verification_required && d.status !== 'LIVE' && d.status !== 'NOT_STARTED' && <Button size="sm" onClick={() => setEdit({ d, m: 'verify' })}>Verify</Button>}
                {data.can_manage && d.status !== 'SUBMITTED' && d.status !== 'LIVE' && <Button size="sm" onClick={() => setEdit({ d, m: 'submitted' })}>Mark Submitted</Button>}
                {data.can_manage && <Button size="sm" variant="ghost" onClick={() => setEdit({ d, m: 'note' })}>Add Note</Button>}
                {d.id > 0 && <Button size="sm" variant="ghost" onClick={() => setHist(d)}>History</Button>}
                {pl?.help_url && <a className="small" href={pl.help_url} target="_blank" rel="noopener noreferrer">Guide</a>}
              </div>
            </article>
          );
        })}
      </div>
      {data.can_manage && !rd.ready && (
        <p className="muted small" style={{ marginTop: 12 }}>Submit is disabled until Distribution Readiness reaches 100% (missing: {rd.missing.join(', ') || '—'}). You can still record manual status changes with Update.</p>
      )}

      <DistributionEditor record={edit?.d ?? null} mode={edit?.m ?? 'update'} platform={edit ? platformMap.get(edit.d.platform_id) : undefined}
        onClose={() => setEdit(null)} onSaved={reload} />
      <HistoryModal record={hist} onClose={() => setHist(null)} />
      <SubmitModal record={submitFor} platform={submitFor ? platformMap.get(submitFor.platform_id) : undefined} feedUrl={rd.feed_url}
        onClose={() => setSubmitFor(null)} onDone={reload} />
    </>
  );
}

function ReadinessCard({ rd }: { rd: Readiness }) {
  const v = rd.feed_validation;
  return (
    <Card title={<>Distribution Readiness: {rd.percent}%</>} actions={rd.ready ? <Badge status="READY">✓ Ready</Badge> : <Badge status="ACTION_REQUIRED">Not ready</Badge>}>
      <Progress value={rd.percent} label="Distribution readiness" />
      <ul className="checklist" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {rd.checklist.map((c) => (
          <li key={c.key}>
            <span className={c.passed ? 'ok' : 'no'} aria-hidden="true">{c.passed ? '✓' : '✗'}</span>
            <span>{c.label}<span className="sr-only">: {c.passed ? 'passed' : 'missing'}</span>{c.detail && <small className="muted"> ({c.detail})</small>}</span>
          </li>
        ))}
      </ul>
      {rd.missing.length > 0 && <div className="alert alert--warn" style={{ marginTop: 12 }}><strong>Missing:</strong> {rd.missing.join(', ')}</div>}
      <div style={{ marginTop: 12 }}>
        <div className="small muted">RSS feed URL</div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <code className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{rd.feed_url || '—'}</code>
          {rd.feed_url && <CopyButton text={rd.feed_url} />}
          {rd.feed_url && <a className="small" href={rd.feed_url} target="_blank" rel="noopener noreferrer">Open</a>}
        </div>
      </div>
      {v && (
        <div style={{ marginTop: 10 }}>
          <p className="small" style={{ margin: '0 0 4px' }}>
            Feed validation: {v.valid ? <Badge status="OK">✓ Valid</Badge> : <Badge status="ERROR">Invalid</Badge>} <span className="muted">{v.items} items · {v.errors} errors · {v.warnings} warnings</span>
          </p>
          {v.issues?.length > 0 && (
            <ul className="checklist small">
              {v.issues.map((i, n) => (
                <li key={n}><Badge status={i.severity === 'error' ? 'error' : 'warning'}>{i.severity}</Badge> <span><span className="mono">{i.field}</span> — {i.message}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** Submit flow: API platforms submit via their official API; manual ones open the platform's submit page and mark SUBMITTED. */
function SubmitModal({ record, platform, feedUrl, onClose, onDone }: { record: Distribution | null; platform?: Platform; feedUrl: string; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const [result, setResult] = useState<SubmitResult | null>(null);
  const isApi = platform?.submission_type === 'API';
  const close = () => { setResult(null); onClose(); };

  const submit = async () => {
    if (!record) return;
    // Open the tab synchronously (inside the click) so popup blockers allow it; navigate once we have the URL.
    const win = !isApi && platform?.submit_url ? window.open(platform.submit_url, '_blank') : null;
    if (win) win.opener = null;
    const r = await run(() => post<SubmitResult>(`/distribution/${record.podcast_id}/${record.platform_id}/submit`), isApi ? 'Submitted via API' : 'Marked as submitted');
    if (r) {
      setResult(r);
      if (!isApi && !win && r.submit_url) window.open(r.submit_url, '_blank', 'noopener');
      onDone();
    }
  };

  return (
    <Modal title={record ? `Submit to ${record.platform_name}` : 'Submit'} open={!!record} onClose={close}
      footer={result ? <Button variant="primary" onClick={close}>Done</Button> : <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={submit}>{isApi ? 'Submit via API' : `Open ${platform?.name ?? 'platform'} & mark submitted`}</Button>
      </>}>
      {record && !result && (
        <div className="stack" style={{ gap: 10 }}>
          {isApi ? (
            <p style={{ margin: 0 }}>The feed will be submitted to <strong>{record.platform_name}</strong> through its official API ({platform?.api_provider || 'API'}). The external ID is saved automatically.</p>
          ) : (
            <>
              <p style={{ margin: 0 }}>{record.platform_name} requires a manual submission. The submission page opens in a new tab and this record is marked <Badge status="SUBMITTED" />. Paste the feed URL below there.</p>
              {platform?.instructions && <div className="alert alert--info" style={{ margin: 0 }}>{platform.instructions}</div>}
            </>
          )}
          <FeedBox url={feedUrl} />
        </div>
      )}
      {result && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="alert alert--success" style={{ margin: 0 }}>✓ Status is now <strong>{result.distribution.status.replace(/_/g, ' ')}</strong>.</p>
          {result.mode === 'manual' && (
            <>
              <p style={{ margin: 0 }}>Paste this feed URL into {record?.platform_name}:</p>
              <FeedBox url={result.feed_url || feedUrl} />
              {result.submit_url && <p style={{ margin: 0 }}><a href={result.submit_url} target="_blank" rel="noopener noreferrer">Open {record?.platform_name} submission page →</a></p>}
              <p className="muted small" style={{ margin: 0 }}>Once the platform approves the show, use <strong>Update</strong> to set it LIVE with the listing URL.</p>
            </>
          )}
          {result.mode === 'api' && result.distribution.external_url && (
            <p style={{ margin: 0 }}><a href={result.distribution.external_url} target="_blank" rel="noopener noreferrer">View listing →</a></p>
          )}
        </div>
      )}
    </Modal>
  );
}

function FeedBox({ url }: { url: string }) {
  return (
    <div>
      <div className="small muted">RSS feed URL</div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="input mono" readOnly value={url} aria-label="RSS feed URL" onFocus={(e) => e.target.select()} />
        <CopyButton text={url} />
      </div>
    </div>
  );
}
