import type { Metadata } from 'next';
import { getTheme } from '@podcast/themes';
import { getHome, getSite } from '@/lib/api';
import { pageMetadata, siteName } from '@/lib/seo';
import { TrackMarker } from '@/components/TrackMarker';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return pageMetadata(site, { title: site.seo.site_title || siteName(site), path: '/' });
}

export default async function HomePage() {
  const [site, home] = await Promise.all([getSite(), getHome()]);
  const theme = getTheme(site.theme.key);
  return (
    <>
      <TrackMarker />
      <theme.Home site={site} home={home} />
    </>
  );
}
