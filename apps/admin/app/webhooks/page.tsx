'use client';

import { useState } from 'react';
import { del, get, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Input, Modal, PageHeader, Spinner, fmtDate, useAction, useAsync } from '@/components/ui';
import { NoAccess, SecretOnce, TenantSelect } from '@/components/network/common';

interface Webhook { id: number; tenant_id: number | null; url: string; events: string[]; is_active: boolean; created_at: string; last_delivery_at: string | null; last_succeeded: boolean | null }
interface Delivery { id: number; event: string; status_code: number; success: boolean; error: string; created_at: string }

const EVENT_HELP: Record<string, string> = {
  'episode.published': 'An episode goes live',
  'podcast.created': 'A new podcast is created',
  'distribution.live': 'A podcast becomes live on a platform',
  'distribution.failed': 'A platform submission fails or is rejected',
  'rss.synced': 'An imported RSS feed finished syncing',
};

function CreateModal({ events, onClose, onCreated }: { events: string[]; onClose: () => void; onCreated: () => void }) {
  const { can, tenants, scopeTenantId } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const { run, busy } = useAction();
  const [url, setUrl] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [tid, setTid] = useState<number | ''>(scopeTenantId ?? '');
  const [secret, setSecret] = useState<string | null>(null);
  const urlOk = /^https:\/\/[^\s/]+\.[^\s]+/.test(url.trim());
  const valid = urlOk && sel.length > 0;

  const create = async () => {
    const r = await run(() => post<{ id: number; secret: string }>('/webhooks', { url: url.trim(), events: sel, ...(isSuper && tid ? { tenant_id: tid } : {}) }), 'Webhook created');
    if (r) { setSecret(r.secret); onCreated(); }
  };

  return (
    <Modal title={secret ? 'Webhook created' : 'New webhook'} open onClose={onClose} wide
      footer={secret ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={create}>Create webhook</Button></>}>
      {secret ? (
        <SecretOnce title="Signing secret" value={secret}>
          <p className="small" style={{ margin: '10px 0 0' }}>Use it to verify the <code>X-Podcast-Signature</code> header of each delivery.</p>
        </SecretOnce>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (valid) create(); }}>
          <Input label="Endpoint URL" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/podcast"
            hint={url && !urlOk ? 'Must be a public https:// URL.' : 'Receives a JSON POST for each selected event.'} />
          {isSuper && <TenantSelect tenants={tenants} value={tid} onChange={setTid} allowAll allLabel="All sites (network-wide)" />}
          <fieldset className="nw-fieldset">
            <legend>Events</legend>
            <div className="nw-checklist">
              {events.map((ev) => (
                <label key={ev} className="check">
                  <input type="checkbox" checked={sel.includes(ev)} onChange={(e) => setSel(e.target.checked ? [...sel, ev] : sel.filter((x) => x !== ev))} />
                  <span><span className="mono">{ev}</span>{EVENT_HELP[ev] && <small className="hint"> — {EVENT_HELP[ev]}</small>}</span>
                </label>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSel(sel.length === events.length ? [] : events)}>{sel.length === events.length ? 'Clear all' : 'Select all'}</Button>
          </fieldset>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}

function DeliveriesModal({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const { data, error, loading, reload } = useAsync(() => get<Delivery[]>(`/webhooks/${hook.id}/deliveries`), [hook.id]);
  return (
    <Modal title={`Deliveries — ${hook.url}`} open onClose={onClose} wide footer={<><Button onClick={reload}>Refresh</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.length ? <Empty>No deliveries yet.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Event</th><th>Result</th><th>HTTP</th><th>Error</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="small">{fmtDate(d.created_at, true)}</td>
                  <td className="mono">{d.event}</td>
                  <td><Badge status={d.success ? 'SUCCESS' : 'FAILED'} /></td>
                  <td className="mono">{d.status_code || '—'}</td>
                  <td className="small">{d.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 8 }}>Last 50 deliveries; history is kept for 30 days.</p>
    </Modal>
  );
}

/** Webhooks (PRD §105). */
export default function WebhooksPage() {
  const { can, scopeTenantId, tenants } = useAuth();
  const tq = useTenantQuery();
  const isSuper = can('SUPER_ADMIN');
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Webhook | null>(null);
  const { data, error, loading, reload } = useAsync(() => get<{ webhooks: Webhook[]; events: string[] }>('/webhooks', tq), [scopeTenantId]);
  if (!can('SUPER_ADMIN', 'TENANT_ADMIN')) return <NoAccess what="webhooks" />;
  const tname = (id: number | null) => (id ? tenants.find((t) => t.id === id)?.name ?? `#${id}` : 'All sites');

  return (
    <>
      <PageHeader title="Webhooks" subtitle="Notify external systems when things happen" actions={<Button variant="primary" disabled={!data} onClick={() => setOpen(true)}>+ New webhook</Button>} />
      <div className="nw-split nw-split--narrow">
        <div>
          {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data?.webhooks.length ? <Empty>No webhooks yet.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Endpoint</th><th>Events</th>{isSuper && <th>Website</th>}<th>Last delivery</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.webhooks.map((h) => (
                    <tr key={h.id}>
                      <td className="mono" style={{ wordBreak: 'break-all' }}>{h.url}{!h.is_active && <> <Badge status="DISABLED" /></>}</td>
                      <td><div className="row" style={{ gap: 4 }}>{h.events.map((e) => <span key={e} className="badge badge--gray">{e}</span>)}</div></td>
                      {isSuper && <td>{tname(h.tenant_id)}</td>}
                      <td>{h.last_delivery_at ? <><Badge status={h.last_succeeded ? 'SUCCESS' : 'FAILED'} /><div className="small muted">{fmtDate(h.last_delivery_at, true)}</div></> : <span className="muted small">Never</span>}</td>
                      <td className="small">{fmtDate(h.created_at)}</td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <Button size="sm" onClick={() => setView(h)}>Deliveries</Button>
                          <ConfirmButton size="sm" variant="danger" confirm={`Delete webhook ${h.url}?`}
                            onConfirm={async () => { if ((await run(() => del(`/webhooks/${h.id}`), 'Webhook deleted')) !== undefined) reload(); }}>Delete</ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Card title="Verifying deliveries">
          <p className="small" style={{ marginTop: 0 }}>Each request is a JSON <code>POST</code> signed with your secret:</p>
          <pre className="code">{'X-Podcast-Event: episode.published\nX-Podcast-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>'}</pre>
          <p className="small">Compute the HMAC of the <strong>raw request body</strong> with the signing secret and compare in constant time:</p>
          <pre className="code">{`const sig = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(rawBody).digest('hex');
crypto.timingSafeEqual(
  Buffer.from(sig),
  Buffer.from(req.headers['x-podcast-signature']));`}</pre>
          <p className="hint">Respond with a 2xx status quickly; non-2xx responses are recorded as failed deliveries.</p>
        </Card>
      </div>
      {open && data && <CreateModal events={data.events} onClose={() => setOpen(false)} onCreated={reload} />}
      {view && <DeliveriesModal hook={view} onClose={() => setView(null)} />}
    </>
  );
}
