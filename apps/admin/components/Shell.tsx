'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/lib/api';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Notification } from '@/lib/types';
import { Spinner, cx, fmtDate } from './ui';
import { BrandMark, Icon, type IconName } from './icons';

interface NavEntry { href: string; label: string; icon: IconName; roles?: Role[]; superOnly?: boolean }
interface NavGroup { title: string; items: NavEntry[] }

const ALL: Role[] = ['SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR', 'CREATOR', 'VIEWER'];
const ADMINS: Role[] = ['SUPER_ADMIN', 'TENANT_ADMIN'];
const EDITORS: Role[] = ['SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR'];

const NAV: NavGroup[] = [
  { title: 'Overview', items: [
    { href: '/', label: 'Dashboard', icon: 'dashboard' },
    { href: '/analytics', label: 'Analytics', icon: 'analytics', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EDITOR', 'VIEWER'] },
  ] },
  { title: 'Content', items: [
    { href: '/podcasts', label: 'Podcasts', icon: 'podcasts' },
    { href: '/episodes', label: 'Episodes', icon: 'episodes' },
    { href: '/hosts', label: 'Hosts', icon: 'hosts' },
    { href: '/collections', label: 'Collections', icon: 'collections', roles: EDITORS },
    { href: '/categories', label: 'Categories', icon: 'categories', superOnly: true },
    { href: '/imports', label: 'Import / Export', icon: 'imports', roles: EDITORS },
  ] },
  { title: 'Distribution', items: [
    { href: '/distribution', label: 'Distribution', icon: 'distribution' },
    { href: '/distribution/platforms', label: 'Platforms', icon: 'platforms', superOnly: true },
    { href: '/rss-health', label: 'RSS Health', icon: 'health' },
  ] },
  { title: 'Network', items: [
    { href: '/tenants', label: 'Websites', icon: 'websites', roles: ADMINS },
    { href: '/domains', label: 'Domains', icon: 'domains', roles: ADMINS },
    { href: '/redirects', label: 'Redirects', icon: 'redirects', roles: ADMINS },
  ] },
  { title: 'Administration', items: [
    { href: '/users', label: 'Users', icon: 'users', roles: ADMINS },
    { href: '/api-keys', label: 'API Keys', icon: 'keys', roles: ADMINS },
    { href: '/webhooks', label: 'Webhooks', icon: 'webhooks', roles: ADMINS },
    { href: '/audit', label: 'Audit Log', icon: 'audit', roles: ADMINS },
    { href: '/system', label: 'System', icon: 'system', superOnly: true },
  ] },
];

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const load = () => get<{ items: Notification[]; unread: number }>('/notifications').then((d) => { setItems(d.items); setUnread(d.unread); }).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bell">
      <button type="button" className="icon-btn" aria-label={`Notifications (${unread} unread)`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />{unread > 0 && <span className="bell__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell__panel" role="dialog" aria-label="Notifications">
          <div className="bell__head">
            <strong>Notifications</strong>
            <button type="button" className="link" onClick={async () => { await post('/notifications/read-all'); load(); }}>Mark all read</button>
          </div>
          <ul>
            {items.length === 0 && <li className="muted">No notifications</li>}
            {items.slice(0, 30).map((n) => (
              <li key={n.id} className={cx(!n.read && 'is-unread', `sev-${n.severity}`)}>
                <a href={n.link || '#'} onClick={() => post(`/notifications/${n.id}/read`).catch(() => {})}>
                  <strong>{n.title}</strong><span>{n.message}</span><small>{fmtDate(n.created_at, true)}</small>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { ready, user, tenants, scopeTenantId, setScopeTenantId, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (ready && !user && pathname !== '/login') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, user, pathname, router]);
  useEffect(() => setNavOpen(false), [pathname]);

  if (pathname === '/login') return <>{children}</>;
  if (!ready || !user) return <div className="boot"><Spinner /></div>;

  const isSuper = user.role === 'SUPER_ADMIN';
  const visible = (e: NavEntry) => (e.superOnly ? isSuper : (e.roles ?? ALL).includes(user.role));
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));
  const myTenant = tenants.find((t) => t.id === user.tenant_id);

  return (
    <div className={cx('shell', navOpen && 'nav-open')}>
      <Link className="skip" href="#content">Skip to content</Link>
      <aside className="side">
        <div className="side__brand"><BrandMark /><div><strong>Podcast Engine</strong><small>{isSuper ? 'Master Admin' : myTenant?.name ?? 'Tenant Admin'}</small></div></div>
        <nav aria-label="Admin">
          {NAV.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.title} className="side__group">
                <p>{g.title}</p>
                <ul>
                  {items.map((i) => (
                    <li key={i.href}><Link href={i.href} aria-current={active(i.href) ? 'page' : undefined}><Icon name={i.icon} />{i.label}</Link></li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="top">
          <button type="button" className="icon-btn menu-btn" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}><Icon name="menu" /></button>
          {isSuper ? (
            <label className="scope">
              <span className="sr-only">Tenant scope</span>
              <select value={scopeTenantId ?? ''} onChange={(e) => { setScopeTenantId(e.target.value ? Number(e.target.value) : null); router.refresh(); }}>
                <option value="">All Network</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.primary_domain || t.slug}</option>)}
              </select>
            </label>
          ) : (
            <span className="scope scope--fixed">{myTenant?.name}{myTenant?.primary_domain && <small> · {myTenant.primary_domain}</small>}</span>
          )}
          <div className="top__right">
            <NotificationsBell />
            <span className="who"><strong>{user.name || user.email}</strong><small>{user.role.replace('_', ' ')}</small></span>
            <Link className="btn btn--ghost btn--sm" href="/account"><Icon name="account" />Account</Link>
            <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await logout(); router.replace('/login'); }}><Icon name="logout" />Sign out</button>
          </div>
        </header>
        <main id="content" className="content">{children}</main>
      </div>
    </div>
  );
}
