'use client';

// Small admin UI kit (no external dependencies).
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError } from '@/lib/api';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- async data
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current()
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(errMsg(e)); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as { missing?: string[] } | undefined;
    return d?.missing?.length ? `${e.message}. Missing: ${d.missing.join(', ')}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast toast--${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Runs an async action with toast feedback; returns the result or undefined on error. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast('success', success);
      return r;
    } catch (e) {
      toast('error', errMsg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, busy };
}

// ---------------------------------------------------------------- primitives
export function Button({ variant = 'default', size, className, loading, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm'; loading?: boolean }) {
  return (
    <button type="button" {...p} disabled={p.disabled || loading} className={cx('btn', `btn--${variant}`, size && `btn--${size}`, className)}>
      {loading && <span className="spinner" aria-hidden="true" />}{children}
    </button>
  );
}

export function LinkButton({ href, variant = 'default', size, children, external }: { href: string; variant?: 'default' | 'primary' | 'ghost'; size?: 'sm'; children: ReactNode; external?: boolean }) {
  return <a href={href} className={cx('btn', `btn--${variant}`, size && `btn--${size}`)} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span aria-hidden="true" className="req"> *</span>}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function Input({ label, hint, required, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return <Field label={label} hint={hint} required={required}>{(id) => <input id={id} required={required} {...p} />}</Field>;
}
export function Textarea({ label, hint, required, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) {
  return <Field label={label} hint={hint} required={required}>{(id) => <textarea id={id} required={required} rows={4} {...p} />}</Field>;
}
export function Select({ label, hint, options, required, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; options: { value: string | number; label: string }[] }) {
  return (
    <Field label={label} hint={hint} required={required}>
      {(id) => (
        <select id={id} required={required} {...p}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}
export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <small className="hint"> — {hint}</small>}</span>
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && <header className="card__head">{title && <h2>{title}</h2>}{actions && <div className="card__actions">{actions}</div>}</header>}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="page-head">
      <div>
        {back && <a className="back" href={back.href}>← {back.label}</a>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: 'green', LIVE: 'green', READY: 'blue', ACTIVE: 'green', VERIFIED: 'green', OK: 'green', SUCCEEDED: 'green', SUCCESS: 'green', HEALTHY: 'green', success: 'green',
  DRAFT: 'gray', NOT_STARTED: 'gray', ARCHIVED: 'gray', DISABLED: 'gray', NONE: 'gray', NOT_MODIFIED: 'gray', info: 'blue',
  SCHEDULED: 'purple', SUBMITTED: 'blue', PENDING: 'amber', PENDING_REVIEW: 'amber', PROCESSING: 'amber', QUEUED: 'amber', RUNNING: 'amber', RETRYING: 'amber', IMPORTING: 'amber', WARNING: 'amber', warning: 'amber', UPLOADED: 'amber',
  DISCOVERY_PENDING: 'purple', PAUSED: 'gray', UNAVAILABLE: 'gray',
  FAILED: 'red', REJECTED: 'red', ACTION_REQUIRED: 'red', ERROR: 'red', CRITICAL: 'red', MISCONFIGURED: 'red', error: 'red', critical: 'red',
};
const STATUS_ICON: Record<string, string> = { LIVE: '✓', PUBLISHED: '✓', PENDING: '⏳', PENDING_REVIEW: '⏳', ACTION_REQUIRED: '⚠', FAILED: '✕', REJECTED: '✕', SUBMITTED: '↗', CRITICAL: '⚠', DISCOVERY_PENDING: '🔍', PAUSED: '⏸', UNAVAILABLE: '✗' };

/** Status badge — always text + icon, never colour alone (PRD §82). */
export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const tone = STATUS_TONE[status] ?? 'gray';
  return <span className={`badge badge--${tone}`}>{STATUS_ICON[status] && <span aria-hidden="true">{STATUS_ICON[status]} </span>}{children ?? status.replace(/_/g, ' ')}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading"><span className="spinner" aria-hidden="true" /> {label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="alert alert--error" role="alert">{error}{onRetry && <> <Button size="sm" onClick={onRetry}>Retry</Button></>}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} className={cx('tab', t.key === value && 'is-active')} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={cx('modal', wide && 'modal--wide')} onClose={onClose} aria-label={title}>
      <header className="modal__head"><h2>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button></header>
      <div className="modal__body">{open && children}</div>
      {footer && <footer className="modal__foot">{footer}</footer>}
    </dialog>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (<><span className="stat__value">{value}</span><span className="stat__label">{label}</span>{hint && <span className="stat__hint">{hint}</span>}</>);
  return href ? <a className="stat" href={href}>{body}</a> : <div className="stat">{body}</div>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress__bar" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</Button>
      <span>Page {page} of {pages}</span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</Button>
    </nav>
  );
}

/** Bar chart (horizontal) for top-N lists. */
export function BarList({ items, empty = 'No data yet' }: { items: { label: string; value: number; href?: string }[]; empty?: string }) {
  if (!items?.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="barlist">
      {items.map((i, idx) => (
        <li key={idx}>
          <div className="barlist__bar" style={{ width: `${(i.value / max) * 100}%` }} aria-hidden="true" />
          <span className="barlist__label">{i.href ? <a href={i.href}>{i.label}</a> : i.label}</span>
          <span className="barlist__value">{i.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

/** Simple responsive line/area chart (SVG) with accessible table fallback. */
export function LineChart({ series, height = 220 }: { series: { name: string; color: string; points: { x: string; y: number }[] }[]; height?: number }) {
  const w = 800;
  const h = height;
  const pad = 28;
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const max = Math.max(...all, 1);
  const n = Math.max(...series.map((s) => s.points.length), 1);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(n - 1, 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const labels = series[0]?.points ?? [];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Chart: ${series.map((s) => s.name).join(', ')}`} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad} x2={w - pad} y1={y(max * t)} y2={y(max * t)} className="chart__grid" />
            <text x={4} y={y(max * t) + 4} className="chart__axis">{Math.round(max * t)}</text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path d={`M ${s.points.map((p, i) => `${x(i)} ${y(p.y)}`).join(' L ')} L ${x(s.points.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`} fill={s.color} opacity={0.08} />
            <polyline points={s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {labels.map((p, i) => (i % Math.ceil(n / 8) === 0 ? <text key={i} x={x(i)} y={h - 6} textAnchor="middle" className="chart__axis">{p.x.slice(5)}</text> : null))}
      </svg>
      <figcaption className="chart__legend">
        {series.map((s) => <span key={s.name}><i style={{ background: s.color }} aria-hidden="true" />{s.name}: {s.points.reduce((a, p) => a + p.y, 0).toLocaleString()}</span>)}
      </figcaption>
    </figure>
  );
}

export function fmtDate(iso?: string | null, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}
export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function fmtDuration(sec: number): string {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Confirm then run. */
export function ConfirmButton({ confirm, onConfirm, children, ...p }: Omit<Parameters<typeof Button>[0], 'onClick'> & { confirm: string; onConfirm: () => void }) {
  return <Button {...p} onClick={() => window.confirm(confirm) && onConfirm()}>{children}</Button>;
}

/** Image upload control used for artwork, logos, photos (signed uploads). */
export function ImageUpload({ label, value, onUpload, hint, accept = 'image/jpeg,image/png,image/webp' }: { label: string; value?: string; onUpload: (file: File) => Promise<void>; hint?: string; accept?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="imgup">
        {value ? <img src={value} alt="" className="imgup__preview" /> : <div className="imgup__preview imgup__preview--empty">No image</div>}
        <div>
          <input id={id} type="file" accept={accept} disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try { await onUpload(f); toast('success', 'Image uploaded'); } catch (err) { toast('error', errMsg(err)); } finally { setBusy(false); e.target.value = ''; }
          }} />
          {busy && <Spinner label="Uploading…" />}
          {hint && <p className="hint">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
