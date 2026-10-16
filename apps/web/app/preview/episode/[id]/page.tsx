import type { Metadata } from 'next';
import { getTheme } from '@podcast/themes';
import { getPreview, getSite } from '@/lib/api';
import { orNotFound } from '@/lib/guard';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> };

export const metadata: Metadata = { title: 'Preview', robots: { index: false, follow: false } };

// Editors preview unpublished episodes with a signed, expiring token (PRD §85 Preview step).
export default async function PreviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { token = '' } = await searchParams;
  const [site, data] = await Promise.all([getSite(), orNotFound(getPreview(id, token))]);
  const theme = getTheme(site.theme.key);
  return (
    <>
      <div className="pe-preview-banner" role="status">
        Preview — status: <strong>{data.status}</strong>. This page is not public.
      </div>
      <theme.EpisodePage site={site} page={data.page} />
    </>
  );
}
