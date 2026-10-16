'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Domain, Tenant, TenantSettings, Theme } from '@/lib/types';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Tabs, useAsync } from '@/components/ui';
import { CONTENT_MODES, NoAccess, siteUrl } from '@/components/network/common';
import { AddDomainForm, DomainsTable } from '@/components/network/domains';
import { GeneralTab, type TenantStats } from '@/components/network/tenant/GeneralTab';
import { BrandingTab } from '@/components/network/tenant/BrandingTab';
import { HomepageTab, NavigationTab } from '@/components/network/tenant/HomepageTab';
import { AboutTab, SeoTab } from '@/components/network/tenant/SeoTab';
import { PodcastsTab } from '@/components/network/tenant/PodcastsTab';

type TabKey = 'general' | 'branding' | 'homepage' | 'navigation' | 'about' | 'seo' | 'domains' | 'podcasts';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: 'General' }, { key: 'branding', label: 'Branding' }, { key: 'homepage', label: 'Homepage' },
  { key: 'navigation', label: 'Navigation' }, { key: 'about', label: 'About page' }, { key: 'seo', label: 'SEO' },
  { key: 'domains', label: 'Domains' }, { key: 'podcasts', label: 'Podcasts' },
];

function DomainsTab({ tenant, isSuper, onChanged }: { tenant: Tenant; isSuper: boolean; onChanged: () => void }) {
  const { tenants } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<Domain[]>('/domains', { tenant_id: tenant.id }), [tenant.id]);
  const refresh = () => { reload(); onChanged(); };
  const rows = (data ?? []).filter((d) => d.tenant_id === tenant.id);
  return (
    <div className="stack">
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <DomainsTable domains={rows} tenants={tenants} isSuper={isSuper} showTenant={false} reload={refresh} />
      )}
      {isSuper && <AddDomainForm tenants={tenants} tenantId={tenant.id} onAdded={refresh} />}
    </div>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tid = Number(id);
  const { can, reloadTenants } = useAuth();
  const isSuper = can('SUPER_ADMIN');
  const canManage = can('SUPER_ADMIN', 'TENANT_ADMIN');
  const [tab, setTab] = useState<TabKey>('general');
  const [settingsKey, setSettingsKey] = useState(0);

  useEffect(() => {
    const h = window.location.hash.slice(1) as TabKey;
    if (TABS.some((t) => t.key === h)) setTab(h);
  }, []);
  const changeTab = (k: TabKey) => { setTab(k); history.replaceState(null, '', `#${k}`); };

  const t = useAsync(() => get<{ tenant: Tenant; stats: TenantStats }>(`/tenants/${tid}`), [tid]);
  const settings = useAsync(() => get<TenantSettings>(`/tenants/${tid}/settings`), [tid, settingsKey]);
  const themes = useAsync(() => get<Theme[]>('/themes'), []);
  // Bumped whenever fresh settings arrive so the forms re-initialise from the server.
  const [ver, setVer] = useState(0);
  useEffect(() => setVer((v) => v + 1), [settings.data]);

  if (!canManage) return <NoAccess what="website settings" />;
  if (t.loading && !t.data) return <Spinner />;
  if (t.error) return <ErrorBox error={t.error} onRetry={t.reload} />;
  if (!t.data) return null;
  const { tenant, stats } = t.data;
  const theme = themes.data?.find((x) => x.key === tenant.theme_key);
  const reloadAll = () => { t.reload(); reloadTenants(); };
  const onSettingsSaved = () => setSettingsKey((k) => k + 1);

  const needsSettings = ['branding', 'homepage', 'navigation', 'about'].includes(tab);
  let body: ReactNode = null;
  if (needsSettings) {
    if (settings.loading && !settings.data) body = <Spinner />;
    else if (settings.error) body = <ErrorBox error={settings.error} onRetry={settings.reload} />;
    else if (settings.data) {
      const s = settings.data;
      if (tab === 'branding') body = <BrandingTab key={ver} tenant={tenant} settings={s} theme={theme} onSaved={onSettingsSaved} />;
      if (tab === 'homepage') body = <HomepageTab key={ver} tenant={tenant} settings={s} onSaved={onSettingsSaved} />;
      if (tab === 'navigation') body = <NavigationTab key={ver} tenant={tenant} settings={s} onSaved={onSettingsSaved} />;
      if (tab === 'about') body = <AboutTab key={ver} tenant={tenant} settings={s} onSaved={onSettingsSaved} />;
    }
  } else if (tab === 'general') {
    body = themes.error ? <ErrorBox error={themes.error} onRetry={themes.reload} /> : !themes.data ? <Spinner /> : (
      <GeneralTab key={tenant.updated_at} tenant={tenant} stats={stats} themes={themes.data} onSaved={reloadAll} />
    );
  } else if (tab === 'seo') body = <SeoTab tenant={tenant} />;
  else if (tab === 'domains') body = <DomainsTab tenant={tenant} isSuper={isSuper} onChanged={reloadAll} />;
  else if (tab === 'podcasts') body = <PodcastsTab tenant={tenant} canManage={canManage} />;

  return (
    <>
      <PageHeader
        back={isSuper ? { href: '/tenants', label: 'Websites' } : undefined}
        title={<span className="row" style={{ gap: 8 }}>{tenant.name} <Badge status={tenant.status} /></span>}
        subtitle={<>{tenant.primary_domain || 'No primary domain'} · {tenant.theme_name} · {CONTENT_MODES.find((m) => m.value === tenant.content_mode)?.label}</>}
        actions={tenant.primary_domain ? <a className="btn btn--primary" href={siteUrl(tenant.primary_domain)} target="_blank" rel="noopener noreferrer">View site ↗</a> : undefined}
      />
      {!tenant.primary_domain && tab !== 'domains' && (
        <Card className="nw-callout"><span>This website has no domain yet.</span> <button type="button" className="link" onClick={() => changeTab('domains')}>Add a domain →</button></Card>
      )}
      <Tabs tabs={TABS} value={tab} onChange={changeTab} />
      <div role="tabpanel" aria-label={TABS.find((x) => x.key === tab)?.label}>{body}</div>
    </>
  );
}
