'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { list, post } from '@/lib/api';
import { useAuth, useTenantQuery } from '@/lib/auth';
import type { Episode, Podcast } from '@/lib/types';
import { Button, Card, Empty, ErrorBox, Input, PageHeader, Select, Spinner, Textarea, errMsg, useAsync, useToast } from '@/components/ui';
import { numOrNull, useCanEdit } from '@/components/content/common';

function NewEpisode() {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const canEdit = useCanEdit();
  const { scopeTenantId } = useAuth();
  const tq = useTenantQuery();
  const pods = useAsync(() => list<Podcast>('/podcasts', { ...tq, sort: 'title', per_page: 200 }), [scopeTenantId]);
  const editable = (pods.data?.data ?? []).filter((p) => p.can_edit);
  const [podcastId, setPodcastId] = useState(sp.get('podcast') ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [seasonNumber, setSeasonNumber] = useState('');
  const [type, setType] = useState<Episode['episode_type']>('full');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canEdit) return <><PageHeader title="New episode" back={{ href: '/episodes', label: 'Episodes' }} /><Empty>You don’t have permission to create episodes.</Empty></>;

  const selected = editable.find((p) => String(p.id) === podcastId);
  const suggested = selected ? selected.episode_count + 1 : undefined;

  const create = async () => {
    if (!podcastId) { setErr('Choose a podcast.'); return; }
    if (!title.trim()) { setErr('Title is required.'); return; }
    setErr('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { podcast_id: Number(podcastId), title: title.trim(), description, episode_type: type, status: 'DRAFT' };
      const en = numOrNull(episodeNumber), sn = numOrNull(seasonNumber);
      if (en !== null) body.episode_number = en;
      if (sn !== null) body.season_number = sn;
      const e = await post<Episode>('/episodes', body);
      toast('success', 'Episode draft created — now upload the audio');
      router.push(`/episodes/${e.id}`);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="New episode" subtitle="Create a draft, then upload audio, add metadata and SEO, preview and publish."
        back={selected ? { href: `/podcasts/${selected.id}?tab=episodes`, label: selected.title } : { href: '/episodes', label: 'Episodes' }} />
      {pods.error ? <ErrorBox error={pods.error} onRetry={pods.reload} /> : pods.loading && !pods.data ? <Spinner /> : editable.length === 0 ? (
        <Empty>There are no podcasts you can add episodes to. <a href="/podcasts/new">Create a podcast first →</a></Empty>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); create(); }} noValidate style={{ maxWidth: 760 }}>
          <Card title="Episode draft">
            {err && <div className="alert alert--error" role="alert">{err}</div>}
            <Select label="Podcast" required value={podcastId} onChange={(e) => setPodcastId(e.target.value)}
              options={[{ value: '', label: '— Choose a podcast —' }, ...editable.map((p) => ({ value: p.id, label: `${p.title}${p.owner_tenant_name ? ` (${p.owner_tenant_name})` : ''}` }))]} />
            <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
            <Textarea label="Description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} hint="Basic HTML allowed. You can edit everything later." />
            <div className="grid-3">
              <Input label="Episode number" type="number" min={0} value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)}
                hint={suggested ? `Next would be ${suggested}` : undefined} />
              <Input label="Season number" type="number" min={0} value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} />
              <Select label="Episode type" value={type} onChange={(e) => setType(e.target.value as Episode['episode_type'])}
                options={[{ value: 'full', label: 'Full' }, { value: 'trailer', label: 'Trailer' }, { value: 'bonus', label: 'Bonus' }]} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button type="submit" variant="primary" loading={busy}>Create draft & continue →</Button>
            </div>
          </Card>
        </form>
      )}
    </>
  );
}

export default function NewEpisodePage() {
  return <Suspense fallback={<Spinner />}><NewEpisode /></Suspense>;
}
