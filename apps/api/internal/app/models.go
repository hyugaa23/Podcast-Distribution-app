package app

import (
	"encoding/json"
	"time"
)

// Status constants.
const (
	PodcastDraft     = "DRAFT"
	PodcastPublished = "PUBLISHED"
	PodcastScheduled = "SCHEDULED"
	PodcastArchived  = "ARCHIVED"

	EpisodeDraft      = "DRAFT"
	EpisodeProcessing = "PROCESSING"
	EpisodeScheduled  = "SCHEDULED"
	EpisodePublished  = "PUBLISHED"
	EpisodeFailed     = "FAILED"
	EpisodeArchived   = "ARCHIVED"

	ModeIndependent = "INDEPENDENT"
	ModeShared      = "SHARED"
	ModeSyndicated  = "SYNDICATED"
)

// Distribution statuses (PRD §22).
var DistributionStatuses = []string{"NOT_STARTED", "READY", "SUBMITTED", "PENDING", "PENDING_REVIEW", "LIVE", "REJECTED", "FAILED", "ACTION_REQUIRED", "DISCOVERY_PENDING", "UNAVAILABLE", "PAUSED"}

func ValidDistributionStatus(s string) bool {
	for _, v := range DistributionStatuses {
		if v == s {
			return true
		}
	}
	return false
}

type Theme struct {
	ID            int             `json:"id" db:"id"`
	Key           string          `json:"key" db:"key"`
	Number        int             `json:"number" db:"number"`
	Name          string          `json:"name" db:"name"`
	Description   string          `json:"description" db:"description"`
	DefaultConfig json.RawMessage `json:"default_config" db:"default_config"`
	IsActive      bool            `json:"is_active" db:"is_active"`
}

type Tenant struct {
	ID            int64     `json:"id" db:"id"`
	Name          string    `json:"name" db:"name"`
	Slug          string    `json:"slug" db:"slug"`
	ThemeID       int       `json:"theme_id" db:"theme_id"`
	ThemeKey      string    `json:"theme_key" db:"theme_key"`
	ThemeName     string    `json:"theme_name" db:"theme_name"`
	ContentMode   string    `json:"content_mode" db:"content_mode"`
	Language      string    `json:"language" db:"language"`
	Timezone      string    `json:"timezone" db:"timezone"`
	Status        string    `json:"status" db:"status"`
	IsDemo        bool      `json:"is_demo" db:"is_demo"`
	PrimaryDomain string    `json:"primary_domain" db:"primary_domain"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

const TenantSelect = `SELECT t.id, t.name, t.slug, t.theme_id, th.key AS theme_key, th.name AS theme_name,
	t.content_mode, t.language, t.timezone, t.status, t.is_demo,
	COALESCE((SELECT d.domain FROM domains d WHERE d.tenant_id=t.id AND d.is_primary LIMIT 1),
	         (SELECT d.domain FROM domains d WHERE d.tenant_id=t.id ORDER BY d.id LIMIT 1), '') AS primary_domain,
	t.created_at, t.updated_at
	FROM tenants t JOIN themes th ON th.id = t.theme_id`

type Branding struct {
	LogoURL         string            `json:"logo_url"`
	FaviconURL      string            `json:"favicon_url"`
	PrimaryColor    string            `json:"primary_color"`
	SecondaryColor  string            `json:"secondary_color"`
	AccentColor     string            `json:"accent_color"`
	HeadingFont     string            `json:"heading_font"`
	BodyFont        string            `json:"body_font"`
	DefaultCoverURL string            `json:"default_cover_url"`
	FooterText      string            `json:"footer_text"`
	Tagline         string            `json:"tagline"`
	SocialLinks     map[string]string `json:"social_links"`
}

type HomepageSection struct {
	Type         string `json:"type"` // hero, featured, trending, latest_episodes, popular, categories, editors_picks, new_podcasts, collections, newsletter, cta
	Enabled      bool   `json:"enabled"`
	Title        string `json:"title"`
	Subtitle     string `json:"subtitle,omitempty"`
	Limit        int    `json:"limit,omitempty"`
	CollectionID int64  `json:"collection_id,omitempty"`
	ButtonLabel  string `json:"button_label,omitempty"`
	ButtonHref   string `json:"button_href,omitempty"`
}

type NavItem struct {
	Label    string `json:"label"`
	Type     string `json:"type"` // home, podcasts, episodes, categories, hosts, collections, about, search, custom
	Href     string `json:"href"`
	Enabled  bool   `json:"enabled"`
	External bool   `json:"external,omitempty"`
}

type TenantSettings struct {
	TenantID         int64             `json:"tenant_id" db:"tenant_id"`
	Branding         Branding          `json:"branding" db:"branding"`
	ThemeConfig      map[string]any    `json:"theme_config" db:"theme_config"`
	HomepageSections []HomepageSection `json:"homepage_sections" db:"homepage_sections"`
	Navigation       []NavItem         `json:"navigation" db:"navigation"`
	AboutContent     string            `json:"about_content" db:"about_content"`
	UpdatedAt        time.Time         `json:"updated_at" db:"updated_at"`
}

type SEOSettings struct {
	TenantID         int64     `json:"tenant_id" db:"tenant_id"`
	SiteTitle        string    `json:"site_title" db:"site_title"`
	TitleTemplate    string    `json:"title_template" db:"title_template"`
	MetaDescription  string    `json:"meta_description" db:"meta_description"`
	DefaultOGImage   string    `json:"default_og_image" db:"default_og_image"`
	TwitterCard      string    `json:"twitter_card" db:"twitter_card"`
	TwitterHandle    string    `json:"twitter_handle" db:"twitter_handle"`
	OrganizationName string    `json:"organization_name" db:"organization_name"`
	OrganizationLogo string    `json:"organization_logo" db:"organization_logo"`
	CanonicalDomain  string    `json:"canonical_domain" db:"canonical_domain"`
	IndexPolicy      string    `json:"index_policy" db:"index_policy"`
	RobotsExtra      string    `json:"robots_extra" db:"robots_extra"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

type Domain struct {
	ID                 int64      `json:"id" db:"id"`
	TenantID           int64      `json:"tenant_id" db:"tenant_id"`
	TenantName         string     `json:"tenant_name" db:"tenant_name"`
	Domain             string     `json:"domain" db:"domain"`
	IsPrimary          bool       `json:"is_primary" db:"is_primary"`
	RedirectToPrimary  bool       `json:"redirect_to_primary" db:"redirect_to_primary"`
	Status             string     `json:"status" db:"status"`
	VerificationStatus string     `json:"verification_status" db:"verification_status"`
	VerificationToken  string     `json:"verification_token" db:"verification_token"`
	DNSStatus          string     `json:"dns_status" db:"dns_status"`
	SSLStatus          string     `json:"ssl_status" db:"ssl_status"`
	LastError          string     `json:"last_error" db:"last_error"`
	LastCheckedAt      *time.Time `json:"last_checked_at" db:"last_checked_at"`
	VerifiedAt         *time.Time `json:"verified_at" db:"verified_at"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
}

const DomainSelect = `SELECT d.id, d.tenant_id, t.name AS tenant_name, d.domain, d.is_primary, d.redirect_to_primary,
	d.status, d.verification_status, d.verification_token, d.dns_status, d.ssl_status, d.last_error,
	d.last_checked_at, d.verified_at, d.created_at
	FROM domains d JOIN tenants t ON t.id = d.tenant_id`

type User struct {
	ID          int64      `json:"id" db:"id"`
	Email       string     `json:"email" db:"email"`
	Name        string     `json:"name" db:"name"`
	Role        string     `json:"role" db:"role"`
	TenantID    *int64     `json:"tenant_id" db:"tenant_id"`
	TenantName  *string    `json:"tenant_name" db:"tenant_name"`
	Status      string     `json:"status" db:"status"`
	LastLoginAt *time.Time `json:"last_login_at" db:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	PodcastIDs  []int64    `json:"podcast_ids" db:"podcast_ids"`
}

const UserSelect = `SELECT u.id, u.email, u.name, u.role, u.tenant_id, t.name AS tenant_name, u.status,
	u.last_login_at, u.created_at,
	COALESCE((SELECT array_agg(up.podcast_id) FROM user_podcasts up WHERE up.user_id=u.id), '{}') AS podcast_ids
	FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id`

type CategoryRef struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type Category struct {
	ID           int64  `json:"id" db:"id"`
	Name         string `json:"name" db:"name"`
	Slug         string `json:"slug" db:"slug"`
	ParentID     *int64 `json:"parent_id" db:"parent_id"`
	Description  string `json:"description" db:"description"`
	ITunesName   string `json:"itunes_name" db:"itunes_name"`
	SortOrder    int    `json:"sort_order" db:"sort_order"`
	PodcastCount int    `json:"podcast_count" db:"podcast_count"`
}

type HostRef struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	PhotoURL string `json:"photo_url"`
	Role     string `json:"role"`
}

type Host struct {
	ID            int64             `json:"id" db:"id"`
	OwnerTenantID *int64            `json:"owner_tenant_id" db:"owner_tenant_id"`
	Name          string            `json:"name" db:"name"`
	Slug          string            `json:"slug" db:"slug"`
	PhotoURL      string            `json:"photo_url" db:"photo_url"`
	Bio           string            `json:"bio" db:"bio"`
	WebsiteURL    string            `json:"website_url" db:"website_url"`
	Email         string            `json:"email,omitempty" db:"email"`
	SocialLinks   map[string]string `json:"social_links" db:"social_links"`
	CreatedAt     time.Time         `json:"created_at" db:"created_at"`
	PodcastCount  int               `json:"podcast_count" db:"podcast_count"`
}

type Podcast struct {
	ID                int64      `json:"id" db:"id"`
	OwnerTenantID     *int64     `json:"owner_tenant_id" db:"owner_tenant_id"`
	OwnerTenantName   *string    `json:"owner_tenant_name" db:"owner_tenant_name"`
	CanonicalTenantID *int64     `json:"canonical_tenant_id" db:"canonical_tenant_id"`
	Title             string     `json:"title" db:"title"`
	Slug              string     `json:"slug" db:"slug"`
	Description       string     `json:"description" db:"description"`
	ShortDescription  string     `json:"short_description" db:"short_description"`
	ArtworkURL        string     `json:"artwork_url" db:"artwork_url"`
	BannerURL         string     `json:"banner_url" db:"banner_url"`
	Author            string     `json:"author" db:"author"`
	OwnerName         string     `json:"owner_name" db:"owner_name"`
	OwnerEmail        string     `json:"owner_email" db:"owner_email"`
	Language          string     `json:"language" db:"language"`
	Explicit          bool       `json:"explicit" db:"explicit"`
	Copyright         string     `json:"copyright" db:"copyright"`
	WebsiteURL        string     `json:"website_url" db:"website_url"`
	RSSURL            string     `json:"rss_url" db:"rss_url"`
	SourceType        string     `json:"source_type" db:"source_type"`
	PodcastType       string     `json:"podcast_type" db:"podcast_type"`
	CategoryID        *int64     `json:"category_id" db:"category_id"`
	SubcategoryID     *int64     `json:"subcategory_id" db:"subcategory_id"`
	Status            string     `json:"status" db:"status"`
	ScheduledAt       *time.Time `json:"scheduled_at" db:"scheduled_at"`
	PublishedAt       *time.Time `json:"published_at" db:"published_at"`
	FeedGUID          string     `json:"feed_guid" db:"feed_guid"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at" db:"updated_at"`
	EpisodeCount      int        `json:"episode_count" db:"episode_count"`
	LatestEpisodeAt   *time.Time `json:"latest_episode_at" db:"latest_episode_at"`

	Category    *CategoryRef  `json:"category,omitempty" db:"-"`
	Subcategory *CategoryRef  `json:"subcategory,omitempty" db:"-"`
	Categories  []CategoryRef `json:"categories,omitempty" db:"-"`
	Tags        []string      `json:"tags" db:"-"`
	Hosts       []HostRef     `json:"hosts" db:"-"`
	CanEdit     bool          `json:"can_edit" db:"-"`
	FeedURL     string        `json:"feed_url,omitempty" db:"-"`
}

// PodcastCols selects podcast columns from alias p with published episode stats.
const PodcastCols = `p.id, p.owner_tenant_id, (SELECT name FROM tenants WHERE id=p.owner_tenant_id) AS owner_tenant_name,
	p.canonical_tenant_id, p.title, p.slug, p.description, p.short_description,
	p.artwork_url, p.banner_url, p.author, p.owner_name, p.owner_email, p.language, p.explicit, p.copyright,
	p.website_url, p.rss_url, p.source_type, p.podcast_type, p.category_id, p.subcategory_id, p.status,
	p.scheduled_at, p.published_at, p.feed_guid::text AS feed_guid, p.created_at, p.updated_at,
	(SELECT count(*) FROM episodes e WHERE e.podcast_id=p.id AND e.status='PUBLISHED' AND e.published_at<=now())::int AS episode_count,
	(SELECT max(e.published_at) FROM episodes e WHERE e.podcast_id=p.id AND e.status='PUBLISHED' AND e.published_at<=now()) AS latest_episode_at`

type Episode struct {
	ID               int64           `json:"id" db:"id"`
	PodcastID        int64           `json:"podcast_id" db:"podcast_id"`
	PodcastTitle     string          `json:"podcast_title" db:"podcast_title"`
	PodcastSlug      string          `json:"podcast_slug" db:"podcast_slug"`
	PodcastArtwork   string          `json:"podcast_artwork_url" db:"podcast_artwork_url"`
	Title            string          `json:"title" db:"title"`
	Slug             string          `json:"slug" db:"slug"`
	Description      string          `json:"description" db:"description"`
	ShortDescription string          `json:"short_description" db:"short_description"`
	ShowNotes        string          `json:"show_notes" db:"show_notes"`
	EpisodeNumber    *int            `json:"episode_number" db:"episode_number"`
	SeasonNumber     *int            `json:"season_number" db:"season_number"`
	EpisodeType      string          `json:"episode_type" db:"episode_type"`
	AudioFileID      *int64          `json:"audio_file_id" db:"audio_file_id"`
	AudioURL         string          `json:"audio_url" db:"audio_url"`
	AudioSize        int64           `json:"audio_size" db:"audio_size"`
	AudioMime        string          `json:"audio_mime" db:"audio_mime"`
	Duration         int             `json:"duration" db:"duration"`
	ArtworkURL       string          `json:"artwork_url" db:"artwork_url"`
	Transcript       string          `json:"transcript,omitempty" db:"transcript"`
	TranscriptFormat string          `json:"transcript_format" db:"transcript_format"`
	TranscriptSource string          `json:"transcript_source" db:"transcript_source"`
	TranscriptURL    string          `json:"transcript_url" db:"transcript_url"`
	TranscriptOK     bool            `json:"transcript_approved" db:"transcript_approved"`
	Explicit         bool            `json:"explicit" db:"explicit"`
	Status           string          `json:"status" db:"status"`
	PublishedAt      *time.Time      `json:"published_at" db:"published_at"`
	ScheduledAt      *time.Time      `json:"scheduled_at" db:"scheduled_at"`
	GUID             string          `json:"guid" db:"guid"`
	SEOTitle         string          `json:"seo_title" db:"seo_title"`
	MetaDescription  string          `json:"meta_description" db:"meta_description"`
	CanonicalURL     string          `json:"canonical_url" db:"canonical_url"`
	KeyTopics        json.RawMessage `json:"key_topics" db:"key_topics"`
	FAQ              json.RawMessage `json:"faq" db:"faq"`
	Citations        json.RawMessage `json:"citations" db:"citations"`
	ProcessingError  string          `json:"processing_error" db:"processing_error"`
	CreatedAt        time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at" db:"updated_at"`

	Tags  []string  `json:"tags" db:"-"`
	Hosts []HostRef `json:"hosts" db:"-"`
}

const EpisodeCols = `e.id, e.podcast_id, p.title AS podcast_title, p.slug AS podcast_slug, p.artwork_url AS podcast_artwork_url,
	e.title, e.slug, e.description, e.short_description, e.show_notes, e.episode_number, e.season_number,
	e.episode_type, e.audio_file_id, e.audio_url, e.audio_size, e.audio_mime, e.duration, e.artwork_url,
	e.transcript, e.transcript_format, e.transcript_source, e.transcript_url, e.transcript_approved, e.explicit, e.status,
	e.published_at, e.scheduled_at, e.guid, e.seo_title, e.meta_description, e.canonical_url,
	e.key_topics, e.faq, e.citations, e.processing_error, e.created_at, e.updated_at`

// EpisodeColsLight omits the transcript for list views.
const EpisodeColsLight = `e.id, e.podcast_id, p.title AS podcast_title, p.slug AS podcast_slug, p.artwork_url AS podcast_artwork_url,
	e.title, e.slug, '' AS description, e.short_description, '' AS show_notes, e.episode_number, e.season_number,
	e.episode_type, e.audio_file_id, e.audio_url, e.audio_size, e.audio_mime, e.duration, e.artwork_url,
	'' AS transcript, e.transcript_format, e.transcript_source, e.transcript_url, e.transcript_approved, e.explicit, e.status,
	e.published_at, e.scheduled_at, e.guid, e.seo_title, e.meta_description, e.canonical_url,
	e.key_topics, '[]'::jsonb AS faq, '[]'::jsonb AS citations, e.processing_error, e.created_at, e.updated_at`

type AudioFile struct {
	ID            int64     `json:"id" db:"id"`
	TenantID      *int64    `json:"tenant_id" db:"tenant_id"`
	PodcastID     *int64    `json:"podcast_id" db:"podcast_id"`
	EpisodeID     *int64    `json:"episode_id" db:"episode_id"`
	OriginalKey   string    `json:"original_key" db:"original_key"`
	OriginalName  string    `json:"original_name" db:"original_name"`
	OriginalMime  string    `json:"original_mime" db:"original_mime"`
	OriginalSize  int64     `json:"original_size" db:"original_size"`
	ProcessedKey  string    `json:"processed_key" db:"processed_key"`
	ProcessedSize int64     `json:"processed_size" db:"processed_size"`
	Codec         string    `json:"codec" db:"codec"`
	Bitrate       int       `json:"bitrate" db:"bitrate"`
	SampleRate    int       `json:"sample_rate" db:"sample_rate"`
	Channels      int       `json:"channels" db:"channels"`
	Duration      int       `json:"duration" db:"duration"`
	Status        string    `json:"status" db:"status"`
	ErrorMessage  string    `json:"error_message" db:"error_message"`
	ErrorDetail   string    `json:"error_detail,omitempty" db:"error_detail"`
	Attempts      int       `json:"attempts" db:"attempts"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

type Platform struct {
	ID                   int64      `json:"id" db:"id"`
	Key                  string     `json:"key" db:"key"`
	Name                 string     `json:"name" db:"name"`
	WebsiteURL           string     `json:"website_url" db:"website_url"`
	SubmitURL            string     `json:"submit_url" db:"submit_url"`
	Icon                 string     `json:"icon" db:"icon"`
	Color                string     `json:"color" db:"color"`
	SubmissionType       string     `json:"submission_type" db:"submission_type"`
	APIProvider          string     `json:"api_provider" db:"api_provider"`
	URLPattern           string     `json:"url_pattern" db:"url_pattern"`
	Instructions         string     `json:"instructions" db:"instructions"`
	IsActive             bool       `json:"is_active" db:"is_active"`
	IsDefault            bool       `json:"is_default" db:"is_default"`
	SortOrder            int        `json:"sort_order" db:"sort_order"`
	HelpURL              string     `json:"help_url" db:"help_url"`
	AccountRequired      bool       `json:"account_required" db:"account_required"`
	VerificationRequired bool       `json:"verification_required" db:"verification_required"`
	SupportsAPI          bool       `json:"supports_api" db:"supports_api"`
	AutoDiscovery        bool       `json:"auto_discovery" db:"auto_discovery"`
	LastVerifiedAt       *time.Time `json:"last_verified_at" db:"last_verified_at"`
	Notes                string     `json:"notes" db:"notes"`
	CreatedAt            time.Time  `json:"created_at" db:"created_at"`
}

type Distribution struct {
	ID                 int64      `json:"id" db:"id"`
	PodcastID          int64      `json:"podcast_id" db:"podcast_id"`
	PodcastTitle       string     `json:"podcast_title" db:"podcast_title"`
	PodcastSlug        string     `json:"podcast_slug" db:"podcast_slug"`
	PlatformID         int64      `json:"platform_id" db:"platform_id"`
	PlatformKey        string     `json:"platform_key" db:"platform_key"`
	PlatformName       string     `json:"platform_name" db:"platform_name"`
	PlatformColor      string     `json:"platform_color" db:"platform_color"`
	Status             string     `json:"status" db:"status"`
	ExternalID         string     `json:"external_id" db:"external_id"`
	ExternalURL        string     `json:"external_url" db:"external_url"`
	SubmittedAt        *time.Time `json:"submitted_at" db:"submitted_at"`
	ApprovedAt         *time.Time `json:"approved_at" db:"approved_at"`
	LastCheckedAt      *time.Time `json:"last_checked_at" db:"last_checked_at"`
	Notes              string     `json:"notes" db:"notes"`
	IssueReason        string     `json:"issue_reason" db:"issue_reason"`
	ResolvedAt         *time.Time `json:"resolved_at" db:"resolved_at"`
	AccountLabel       string     `json:"account_label" db:"account_label"`
	SubmittedBy        string     `json:"submitted_by" db:"submitted_by"`
	Method             string     `json:"method" db:"method"`
	VerificationMethod string     `json:"verification_method" db:"verification_method"`
	NextReviewAt       *time.Time `json:"next_review_at" db:"next_review_at"`
	VerifiedAt         *time.Time `json:"verified_at" db:"verified_at"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at" db:"updated_at"`
}

const DistributionSelect = `SELECT d.id, d.podcast_id, p.title AS podcast_title, p.slug AS podcast_slug,
	d.platform_id, pl.key AS platform_key, pl.name AS platform_name, pl.color AS platform_color,
	d.status, d.external_id, d.external_url, d.submitted_at, d.approved_at, d.last_checked_at,
	d.notes, d.issue_reason, d.resolved_at,
	d.account_label, d.submitted_by, d.method, d.verification_method, d.next_review_at, d.verified_at,
	d.created_at, d.updated_at
	FROM podcast_distributions d
	JOIN podcasts p ON p.id = d.podcast_id
	JOIN platforms pl ON pl.id = d.platform_id`

type Collection struct {
	ID          int64     `json:"id" db:"id"`
	TenantID    int64     `json:"tenant_id" db:"tenant_id"`
	Title       string    `json:"title" db:"title"`
	Slug        string    `json:"slug" db:"slug"`
	Description string    `json:"description" db:"description"`
	CoverURL    string    `json:"cover_url" db:"cover_url"`
	IsPublished bool      `json:"is_published" db:"is_published"`
	SortOrder   int       `json:"sort_order" db:"sort_order"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	PodcastIDs  []int64   `json:"podcast_ids" db:"podcast_ids"`
}

type Notification struct {
	ID        int64     `json:"id" db:"id"`
	TenantID  *int64    `json:"tenant_id" db:"tenant_id"`
	Type      string    `json:"type" db:"type"`
	Severity  string    `json:"severity" db:"severity"`
	Title     string    `json:"title" db:"title"`
	Message   string    `json:"message" db:"message"`
	Link      string    `json:"link" db:"link"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	Read      bool      `json:"read" db:"read"`
}

type RSSSource struct {
	ID                  int64      `json:"id" db:"id"`
	PodcastID           *int64     `json:"podcast_id" db:"podcast_id"`
	PodcastTitle        *string    `json:"podcast_title" db:"podcast_title"`
	TenantID            *int64     `json:"tenant_id" db:"tenant_id"`
	FeedURL             string     `json:"feed_url" db:"feed_url"`
	ImportMode          string     `json:"import_mode" db:"import_mode"`
	SyncEnabled         bool       `json:"sync_enabled" db:"sync_enabled"`
	SyncIntervalMinutes int        `json:"sync_interval_minutes" db:"sync_interval_minutes"`
	Status              string     `json:"status" db:"status"`
	LastSyncedAt        *time.Time `json:"last_synced_at" db:"last_synced_at"`
	NextSyncAt          *time.Time `json:"next_sync_at" db:"next_sync_at"`
	LastError           string     `json:"last_error" db:"last_error"`
	ETag                string     `json:"-" db:"etag"`
	LastModified        string     `json:"-" db:"last_modified"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
}

const RSSSourceSelect = `SELECT s.id, s.podcast_id, p.title AS podcast_title, s.tenant_id, s.feed_url, s.import_mode,
	s.sync_enabled, s.sync_interval_minutes, s.status, s.last_synced_at, s.next_sync_at, s.last_error,
	s.etag, s.last_modified, s.created_at
	FROM rss_sources s LEFT JOIN podcasts p ON p.id = s.podcast_id`

const PlatformSelect = `SELECT id, key, name, website_url, submit_url, icon, color, submission_type, api_provider,
	url_pattern, instructions, is_active, is_default, sort_order,
	help_url, account_required, verification_required, supports_api, auto_discovery, last_verified_at, notes,
	created_at FROM platforms`
