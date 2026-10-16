'use client';

import { useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { get, post } from '@/lib/api';
import type { Distribution, DistStatus, Platform, Readiness } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, PageHeader, Progress, Spinner, cx, fmtDate, useAction, useAsync } from '@/components/ui';
import { CopyButton, PlatformName, statusSymbol, usePlatforms } from '@/components/distribution/shared';

interface PodcastDistribution { platforms: Distribution[]; live: number; total: number; progress_percent: number; readiness: Readiness; can_manage: boolean }

export default function DistributionWizardPage() {
  const params = useParams<{ podcastId: string }>();
  const router = useRouter();
  const id = Number(params.podcastId);
  const { data, error, loading, reload } = useAsync(() => get<PodcastDistribution>(`/distribution/${id}`), [id]);
  const platforms = usePlatforms(false);
  const platformMap = useMemo(() => new Map((platforms.data ?? []).map((p) => [p.id, p])), [platforms.data]);

  const initialOrderRef = useRef<number[] | null>(null);

  const sorted = useMemo(() => {
    if (!data) return [];
    const order: Record<string, number> = { NOT_STARTED: 0, READY: 1, SUBMITTED: 2, PENDING: 3, PENDING_REVIEW: 4, DISCOVERY_PENDING: 5, LIVE: 6, PAUSED: 7, REJECTED: 8, FAILED: 9, ACTION_REQUIRED: 10, UNAVAILABLE: 11 };
    if (!initialOrderRef.current) {
      // First load: sort by status and store the platform_id order
      const initial = [...data.platforms].sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99));
      initialOrderRef.current = initial.map((p) => p.platform_id);
      return initial;
    }
    // Subsequent reloads: preserve original order, update data in place
    const byId = new Map(data.platforms.map((p) => [p.platform_id, p]));
    const result: Distribution[] = [];
    for (const pid of initialOrderRef.current) {
      const p = byId.get(pid);
      if (p) { result.push(p); byId.delete(pid); }
    }
    // Append any new platforms not in the original order
    for (const p of byId.values()) result.push(p);
    return result;
  }, [data]);

  const [stepIdx, setStepIdx] = useState(0);
  const current = sorted[stepIdx];
  const currentPlatform = current ? platformMap.get(current.platform_id) : undefined;

  if (!Number.isFinite(id) || id <= 0) return <ErrorBox error="Invalid podcast id" />;
  if ((loading && !data) || platforms.loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const rd = data.readiness;
  const notStarted = sorted.filter((d) => d.status === 'NOT_STARTED' || d.status === 'READY');
  const inProgress = sorted.filter((d) => ['SUBMITTED', 'PENDING', 'PENDING_REVIEW', 'DISCOVERY_PENDING'].includes(d.status));
  const done = sorted.filter((d) => d.status === 'LIVE');

  return (
    <>
      <PageHeader back={{ href: `/distribution/${id}`, label: 'Dashboard' }} title="Distribution Wizard"
        subtitle={`Step-by-step submission guide — ${data.live}/${data.total} platforms live`}
        actions={<Button onClick={() => router.push(`/distribution/${id}`)}>Exit Wizard</Button>} />

      {!rd.ready && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}>
          <strong>Readiness {rd.percent}%</strong> — fix missing items before submitting: {rd.missing.join(', ')}
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title="Progress">
          <Progress value={data.progress_percent} label="Distribution progress" />
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {done.length} live · {inProgress.length} in progress · {notStarted.length} not started
          </p>
        </Card>
        <Card title="Feed URL">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <code className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{rd.feed_url || '—'}</code>
            {rd.feed_url && <CopyButton text={rd.feed_url} />}
          </div>
          <p className="small muted" style={{ margin: '4px 0 0' }}>Copy and paste this into each platform.</p>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <strong>Platforms</strong>
          </div>
          <nav style={{ maxHeight: 480, overflowY: 'auto' }}>
            {sorted.map((d, i) => (
              <button key={d.platform_id} onClick={() => setStepIdx(i)}
                className={cx('wizard-step', i === stepIdx && 'is-active')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 16px', border: 'none', background: i === stepIdx ? 'var(--surface-hover)' : 'transparent', cursor: 'pointer', textAlign: 'left', borderLeft: i === stepIdx ? '3px solid var(--primary)' : '3px solid transparent' }}>
                <span style={{ width: 20, textAlign: 'center' }}>{statusSymbol(d.status)}</span>
                <span style={{ flex: 1 }}><PlatformName name={d.platform_name} color={d.platform_color} /></span>
                <Badge status={d.status} />
              </button>
            ))}
          </nav>
        </div>

        {current && (
          <StepDetail
            key={current.platform_id}
            dist={current}
            platform={currentPlatform}
            feedUrl={rd.feed_url}
            ready={rd.ready}
            canManage={data.can_manage}
            onPrev={stepIdx > 0 ? () => setStepIdx(stepIdx - 1) : undefined}
            onNext={stepIdx < sorted.length - 1 ? () => setStepIdx(stepIdx + 1) : undefined}
            onReload={reload}
          />
        )}
      </div>
    </>
  );
}

function StepDetail({ dist, platform, feedUrl, ready, canManage, onPrev, onNext, onReload }: {
  dist: Distribution; platform?: Platform; feedUrl: string; ready: boolean; canManage: boolean;
  onPrev?: () => void; onNext?: () => void; onReload: () => void;
}) {
  const { run, busy } = useAction();
  const [done, setDone] = useState(false);
  const isApi = platform?.submission_type === 'API';
  const canSubmit = dist.status !== 'LIVE' && dist.status !== 'SUBMITTED' && dist.status !== 'PENDING' && dist.status !== 'PENDING_REVIEW' && dist.status !== 'PAUSED';

  const submit = async () => {
    const win = !isApi && platform?.submit_url ? window.open(platform.submit_url, '_blank') : null;
    if (win) win.opener = null;
    const r = await run(() => post<{ distribution: Distribution }>(`/distribution/${dist.podcast_id}/${dist.platform_id}/submit`), isApi ? 'Submitted via API' : 'Marked as submitted');
    if (r) {
      setDone(true);
      if (!isApi && !win && platform?.submit_url) window.open(platform.submit_url, '_blank', 'noopener');
      onReload();
    }
  };

  return (
    <Card title={<><PlatformName name={dist.platform_name} color={dist.platform_color} /> <Badge status={dist.status} /></>}>
      {dist.status === 'LIVE' && (
        <div className="alert alert--success">
          <strong>Live!</strong> This podcast is available on {dist.platform_name}.
          {dist.external_url && <> <a href={dist.external_url} target="_blank" rel="noopener noreferrer">View listing →</a></>}
        </div>
      )}

      {dist.status === 'DISCOVERY_PENDING' && (
        <div className="alert alert--info">
          This platform auto-indexes from other catalogs. No manual submission needed — we&apos;ll check periodically.
        </div>
      )}

      {canSubmit && platform?.instructions && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>How to submit</h4>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            {platform.instructions.split('\n').filter(Boolean).map((line, i) => (
              <li key={i}>{line.replace(/^\d+\.\s*/, '')}</li>
            ))}
          </ol>
        </div>
      )}

      {canSubmit && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>Feed URL</h4>
          <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 8 }}>
            <input className="input mono" readOnly value={feedUrl} aria-label="RSS feed URL" onFocus={(e) => e.target.select()} />
            <CopyButton text={feedUrl} />
          </div>
          {platform?.submit_url && (
            <a href={platform.submit_url} target="_blank" rel="noopener noreferrer" className="btn btn--sm">
              Open {platform.name} submission page →
            </a>
          )}
          {platform?.help_url && (
            <a href={platform.help_url} target="_blank" rel="noopener noreferrer" className="btn btn--sm btn--ghost" style={{ marginLeft: 8 }}>
              Help guide →
            </a>
          )}
        </div>
      )}

      {platform && (
        <dl className="kv small" style={{ marginBottom: 16 }}>
          <dt>Type</dt><dd>{isApi ? 'API (automated)' : 'Manual submission'}</dd>
          {platform.account_required && <><dt>Account</dt><dd>Required</dd></>}
          {platform.verification_required && <><dt>Verification</dt><dd>Required</dd></>}
          {platform.auto_discovery && <><dt>Discovery</dt><dd>Auto-indexes from other catalogs</dd></>}
          {platform.notes && <><dt>Notes</dt><dd>{platform.notes}</dd></>}
          {dist.submitted_at && <><dt>Submitted</dt><dd>{fmtDate(dist.submitted_at)}</dd></>}
          {dist.approved_at && <><dt>Approved</dt><dd>{fmtDate(dist.approved_at)}</dd></>}
        </dl>
      )}

      {done && <div className="alert alert--success" style={{ marginBottom: 12 }}>Submitted! Move to the next platform.</div>}

      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div>{onPrev && <Button onClick={onPrev}>← Previous</Button>}</div>
        <div className="row" style={{ gap: 8 }}>
          {canManage && canSubmit && !done && (
            <Button variant="primary" loading={busy} disabled={!ready} onClick={submit}
              title={ready ? undefined : 'Fix readiness issues first'}>
              {isApi ? 'Submit via API' : 'Mark as Submitted'}
            </Button>
          )}
          {onNext && <Button variant={done || dist.status === 'LIVE' ? 'primary' : undefined} onClick={onNext}>Next platform →</Button>}
        </div>
      </div>
    </Card>
  );
}
