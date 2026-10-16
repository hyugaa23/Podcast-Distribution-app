'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { PageHeader, Tabs } from '@/components/ui';
import { NoAccess } from '@/components/network/common';
import { BackupTab, JobsTab, LogsTab, MetricsTab, SettingsTab } from '@/components/network/system';

type TabKey = 'settings' | 'jobs' | 'logs' | 'metrics' | 'backup';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'settings', label: 'Settings' }, { key: 'jobs', label: 'Jobs & Queue' }, { key: 'logs', label: 'Logs' },
  { key: 'metrics', label: 'Metrics' }, { key: 'backup', label: 'Backup' },
];

/** System (super admin): settings, jobs, logs, metrics, backup (PRD §79, §99, §103). */
export default function SystemPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<TabKey>('settings');
  useEffect(() => {
    const h = window.location.hash.slice(1) as TabKey;
    if (TABS.some((t) => t.key === h)) setTab(h);
  }, []);
  if (!can('SUPER_ADMIN')) return <NoAccess what="system settings (super admin only)" />;
  const change = (k: TabKey) => { setTab(k); history.replaceState(null, '', `#${k}`); };
  return (
    <>
      <PageHeader title="System" subtitle="Platform configuration, background jobs, logs and health" />
      <Tabs tabs={TABS} value={tab} onChange={change} />
      <div role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label}>
        {tab === 'settings' && <SettingsTab />}
        {tab === 'jobs' && <JobsTab />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'metrics' && <MetricsTab />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </>
  );
}
