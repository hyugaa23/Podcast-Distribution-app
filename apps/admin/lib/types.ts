// Admin API types (mirrors apps/api/internal/app/models.go).
import type { Role } from './api';

export interface Tenant {
  id: number; name: string; slug: string; theme_id: number; theme_key: string; theme_name: string;
  content_mode: 'INDEPENDENT' | 'SHARED' | 'SYNDICATED'; language: string; timezone: string; status: 'ACTIVE' | 'DISABLED';
  primary_domain: string; created_at: string; updated_at: string;
}

export interface Theme { id: number; key: string; number: number; name: string; description: string; default_config: Record<string, string>; is_active: boolean }

export interface Branding {
  logo_url: string; favicon_url: string; primary_color: string; secondary_color: string; accent_color: string;
  heading_font: string; body_font: string; default_cover_url: string; footer_text: string; tagline: string;
  social_links: Record<string, string> | null;
}
export interface HomepageSection { type: string; enabled: boolean; title: string; subtitle?: string; limit?: number; collection_id?: number; button_label?: string; button_href?: string }
export interface NavItem { label: string; type: string; href: string; enabled: boolean; external?: boolean }
export interface TenantSettings { tenant_id: number; branding: Branding; theme_config: Record<string, unknown>; homepage_sections: HomepageSection[]; navigation: NavItem[]; about_content: string }
export interface SEOSettings {
  tenant_id: number; site_title: string; title_template: string; meta_description: string; default_og_image: string; twitter_card: string;
  twitter_handle: string; organization_name: string; organization_logo: string; canonical_domain: string; index_policy: 'index' | 'noindex'; robots_extra: string;
}

export interface Domain {
  id: number; tenant_id: number; tenant_name: string; domain: string; is_primary: boolean; redirect_to_primary: boolean; status: string;
  verification_status: string; verification_token: string; dns_status: string; ssl_status: string; last_error: string;
  last_checked_at: string | null; verified_at: string | null; created_at: string;
}

export interface User {
  id: number; email: string; name: string; role: Role; tenant_id: number | null; tenant_name: string | null; status: string;
  last_login_at: string | null; created_at: string; podcast_ids: number[];
}

export interface CategoryRef { id: number; name: string; slug: string }
export interface HostRef { id: number; name: string; slug: string; photo_url: string; role: string }

export interface Podcast {
  id: number; owner_tenant_id: number | null; owner_tenant_name: string | null; canonical_tenant_id: number | null; title: string; slug: string;
  description: string; short_description: string; artwork_url: string; banner_url: string; author: string; owner_name: string; owner_email: string;
  language: string; explicit: boolean; copyright: string; website_url: string; rss_url: string; source_type: 'NATIVE' | 'IMPORTED';
  podcast_type: 'episodic' | 'serial'; category_id: number | null; subcategory_id: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED'; scheduled_at: string | null; published_at: string | null; feed_guid: string;
  created_at: string; updated_at: string; episode_count: number; latest_episode_at: string | null;
  category?: CategoryRef; subcategory?: CategoryRef; categories?: CategoryRef[]; tags: string[]; hosts: HostRef[]; can_edit: boolean; feed_url?: string;
}

export interface Episode {
  id: number; podcast_id: number; podcast_title: string; podcast_slug: string; podcast_artwork_url: string; title: string; slug: string;
  description: string; short_description: string; show_notes: string; episode_number: number | null; season_number: number | null;
  episode_type: 'full' | 'trailer' | 'bonus'; audio_file_id: number | null; audio_url: string; audio_size: number; audio_mime: string; duration: number;
  artwork_url: string; transcript: string; transcript_format: string; transcript_source: string; transcript_url: string; transcript_approved: boolean;
  explicit: boolean; status: 'DRAFT' | 'PROCESSING' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED'; published_at: string | null;
  scheduled_at: string | null; guid: string; seo_title: string; meta_description: string; canonical_url: string;
  key_topics: string[] | null; faq: { question: string; answer: string }[] | null; citations: { title: string; url: string }[] | null;
  processing_error: string; created_at: string; updated_at: string; tags: string[]; hosts: HostRef[];
}

export interface AudioFile {
  id: number; original_name: string; original_size: number; processed_size: number; codec: string; bitrate: number; sample_rate: number;
  channels: number; duration: number; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'; error_message: string; attempts: number; created_at: string;
}

export interface Category { id: number; name: string; slug: string; parent_id: number | null; description: string; itunes_name: string; sort_order: number; podcast_count: number }
export interface Host { id: number; owner_tenant_id: number | null; name: string; slug: string; photo_url: string; bio: string; website_url: string; email: string; social_links: Record<string, string> | null; podcast_count: number }

export interface Platform {
  id: number; key: string; name: string; website_url: string; submit_url: string; icon: string; color: string; submission_type: 'MANUAL' | 'API';
  api_provider: string; url_pattern: string; instructions: string; is_active: boolean; is_default: boolean; sort_order: number;
  help_url: string; account_required: boolean; verification_required: boolean; supports_api: boolean; auto_discovery: boolean;
  last_verified_at: string | null; notes: string;
}

export type DistStatus = 'NOT_STARTED' | 'READY' | 'SUBMITTED' | 'PENDING' | 'PENDING_REVIEW' | 'LIVE' | 'REJECTED' | 'FAILED' | 'ACTION_REQUIRED' | 'DISCOVERY_PENDING' | 'UNAVAILABLE' | 'PAUSED';
export const DIST_STATUSES: DistStatus[] = ['NOT_STARTED', 'READY', 'SUBMITTED', 'PENDING', 'PENDING_REVIEW', 'LIVE', 'REJECTED', 'FAILED', 'ACTION_REQUIRED', 'DISCOVERY_PENDING', 'UNAVAILABLE', 'PAUSED'];

export interface Distribution {
  id: number; podcast_id: number; podcast_title: string; podcast_slug: string; platform_id: number; platform_key: string; platform_name: string;
  platform_color: string; status: DistStatus; external_id: string; external_url: string; submitted_at: string | null; approved_at: string | null;
  last_checked_at: string | null; notes: string; issue_reason: string; resolved_at: string | null;
  account_label: string; submitted_by: string; method: 'MANUAL' | 'CLAIM' | 'INDEXED' | 'API';
  verification_method: string; next_review_at: string | null; verified_at: string | null;
  created_at: string; updated_at: string;
}

export interface ChecklistItem { key: string; label: string; passed: boolean; detail?: string }
export interface Readiness {
  percent: number; ready: boolean; checklist: ChecklistItem[]; missing: string[]; feed_url: string;
  feed_validation: { valid: boolean; errors: number; warnings: number; items: number; issues: { severity: string; field: string; message: string }[] };
}

export interface Collection { id: number; tenant_id: number; title: string; slug: string; description: string; cover_url: string; is_published: boolean; sort_order: number; podcast_ids: number[] }

export interface Notification { id: number; tenant_id: number | null; type: string; severity: 'info' | 'success' | 'warning' | 'error'; title: string; message: string; link: string; created_at: string; read: boolean }

export interface KV { key: string; label: string; value: number }
export interface AnalyticsSummary {
  from: string; to: string; episode_plays: number; podcast_plays: number; completions: number; unique_visitors: number; page_views: number;
  funnel: KV[]; series: { day: string; plays: number; page_views: number; visitors: number }[];
  top_podcasts: KV[]; top_episodes: KV[]; referrers: KV[]; countries: KV[]; devices: KV[]; browsers: KV[]; domains: KV[];
}
export interface TenantComparison { tenant_id: number; tenant_name: string; domain: string; plays: number; completions: number; page_views: number; unique_visitors: number; podcasts: number; episodes: number }
export interface EpisodeStats { episode_id: number; title: string; plays: number; completions: number; downloads: number; visitors: number; avg_percent: number }
export interface DeviceBreakdown { devices: KV[]; browsers: KV[]; os: KV[] }

export interface RSSSource {
  id: number; podcast_id: number | null; podcast_title: string | null; tenant_id: number | null; feed_url: string; import_mode: string;
  sync_enabled: boolean; sync_interval_minutes: number; status: string; last_synced_at: string | null; next_sync_at: string | null; last_error: string; created_at: string;
}

export interface HealthCheck { key: string; label: string; status: 'ok' | 'warning' | 'critical'; message: string }
