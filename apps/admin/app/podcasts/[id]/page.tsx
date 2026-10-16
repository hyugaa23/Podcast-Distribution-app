'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { get } from '@/lib/api';
import type { Podcast } from '@/lib/types';
import { Badge, ErrorBox, LinkButton, PageHeader, Spinner, Tabs, useAsync } from '@/components/ui';
import { DetailsTab, DistributionTab, EpisodesTab, RssTab, SitesTab } from '@/components/content/podcastTabs';
import { Icon } from '@/components/icons';

type TabKey = 'details' | 'episodes' | 'distribution' | 'sites' | 'rss';
const TAB_KEYS: TabKey[] = ['details', 'episodes', 'distribution', 'sites', 'rss'];

function PodcastDetail() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const initial = sp.get('tab') as TabKey | null;
  const [tab, setTab] = useState<TabKey>(initial && TAB_KEYS.includes(initial) ? initial : 'details');
  const [created, setCreated] = useState(sp.get('created') === '1');
  const { data: p, error, loading, reload, setData } = useAsync(() => get<Podcast>(`/podcasts/${id}`), [id]);

  if (error) return <><PageHeader title="Podcast" back={{ href: '/podcasts', label: 'Podcasts' }} /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading && !p) return <Spinner />;
  if (!p) return null;

  const changeTab = (k: TabKey) => {
    setTab(k);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', k);
    u.searchParams.delete('created');
    window.history.replaceState(null, '', u.toString());
  };

  return (
    <>
      <PageHeader
        back={{ href: '/podcasts', label: 'Podcasts' }}
        title={<span className="c-hero">{p.artwork_url ? <img src={p.artwork_url} alt="" /> : <span className="c-hero__ph" aria-hidden="true"><Icon name="podcasts" width={28} height={28} /></span>}<span>{p.title}</span></span>}
        subtitle={<><Badge status={p.status} /> · {p.owner_tenant_id ? p.owner_tenant_name : 'Central library'} · {p.episode_count} episode{p.episode_count === 1 ? '' : 's'}{p.source_type === 'IMPORTED' && ' · imported'}</>}
        actions={p.can_edit && <LinkButton href={`/episodes/new?podcast=${p.id}`} variant="primary">+ Add episode</LinkButton>}
      />
      {created && (
        <div className="alert alert--success row row--between" role="status">
          <span>✓ Podcast created as a draft. Next step: add your first episode.</span>
          <span className="row">
            <LinkButton href={`/episodes/new?podcast=${p.id}`} variant="primary" size="sm">Add episode</LinkButton>
            <button type="button" className="link" onClick={() => setCreated(false)}>Dismiss</button>
          </span>
        </div>
      )}
      <Tabs<TabKey>
        value={tab}
        onChange={changeTab}
        tabs={[
          { key: 'details', label: 'Details' },
          { key: 'episodes', label: `Episodes (${p.episode_count})` },
          { key: 'distribution', label: 'Distribution' },
          { key: 'sites', label: 'Sites' },
          { key: 'rss', label: 'RSS Feed' },
        ]}
      />
      <div role="tabpanel">
        {tab === 'details' && <DetailsTab key={p.id} p={p} onSaved={setData} onDeleted={() => router.push('/podcasts')} />}
        {tab === 'episodes' && <EpisodesTab p={p} />}
        {tab === 'distribution' && <DistributionTab p={p} />}
        {tab === 'sites' && <SitesTab p={p} onChanged={reload} />}
        {tab === 'rss' && <RssTab p={p} />}
      </div>
    </>
  );
}

export default function PodcastDetailPage() {
  return <Suspense fallback={<Spinner />}><PodcastDetail /></Suspense>;
}
