import type { Metadata } from 'next';
import { Prose, SocialLinks } from '@podcast/ui';
import { getSite } from '@/lib/api';
import { applyTemplate, excerpt, pageMetadata } from '@/lib/seo';
import { PageShell } from '@/components/Listing';
import { TrackMarker } from '@/components/TrackMarker';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return pageMetadata(site, { title: applyTemplate(site, 'About'), description: excerpt(site.about_content) || site.seo.meta_description, path: '/about' });
}

export default async function AboutPage() {
  const site = await getSite();
  return (
    <PageShell title={`About ${site.tenant.name}`} lead={site.branding.tagline}>
      <TrackMarker />
      <Prose html={site.about_content} />
      <SocialLinks links={site.branding.social_links} />
    </PageShell>
  );
}
