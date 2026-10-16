-- Core schema for the Multi-Domain Podcast Platform & Distribution Engine.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Themes & tenants
-- ---------------------------------------------------------------------------
CREATE TABLE themes (
    id             SERIAL PRIMARY KEY,
    key            TEXT NOT NULL UNIQUE,
    number         INT  NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE tenants (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    theme_id     INT  NOT NULL REFERENCES themes(id),
    content_mode TEXT NOT NULL DEFAULT 'INDEPENDENT'
                 CHECK (content_mode IN ('INDEPENDENT','SHARED','SYNDICATED')),
    language     TEXT NOT NULL DEFAULT 'en',
    timezone     TEXT NOT NULL DEFAULT 'UTC',
    status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
    tenant_id         BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    branding          JSONB NOT NULL DEFAULT '{}'::jsonb,
    theme_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    homepage_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
    navigation        JSONB NOT NULL DEFAULT '[]'::jsonb,
    about_content     TEXT  NOT NULL DEFAULT '',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seo_settings (
    tenant_id          BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    site_title         TEXT NOT NULL DEFAULT '',
    title_template     TEXT NOT NULL DEFAULT '%s | {site_name}',
    meta_description   TEXT NOT NULL DEFAULT '',
    default_og_image   TEXT NOT NULL DEFAULT '',
    twitter_card       TEXT NOT NULL DEFAULT 'summary_large_image',
    twitter_handle     TEXT NOT NULL DEFAULT '',
    organization_name  TEXT NOT NULL DEFAULT '',
    organization_logo  TEXT NOT NULL DEFAULT '',
    canonical_domain   TEXT NOT NULL DEFAULT '',
    index_policy       TEXT NOT NULL DEFAULT 'index' CHECK (index_policy IN ('index','noindex')),
    robots_extra       TEXT NOT NULL DEFAULT '',
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domains (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain              TEXT NOT NULL UNIQUE,
    is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
    redirect_to_primary BOOLEAN NOT NULL DEFAULT FALSE,
    status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','FAILED')),
    verification_token  TEXT NOT NULL,
    dns_status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (dns_status IN ('PENDING','OK','MISCONFIGURED')),
    ssl_status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (ssl_status IN ('PENDING','ACTIVE','FAILED','NONE')),
    last_error          TEXT NOT NULL DEFAULT '',
    last_checked_at     TIMESTAMPTZ,
    verified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (domain = lower(domain))
);
CREATE INDEX domains_tenant_idx ON domains(tenant_id);
CREATE UNIQUE INDEX domains_one_primary_idx ON domains(tenant_id) WHERE is_primary;

-- ---------------------------------------------------------------------------
-- Users & auth
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','TENANT_ADMIN','EDITOR','CREATOR','VIEWER')),
    tenant_id     BIGINT REFERENCES tenants(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (email = lower(email)),
    CHECK ((role = 'SUPER_ADMIN' AND tenant_id IS NULL) OR (role <> 'SUPER_ADMIN' AND tenant_id IS NOT NULL))
);

CREATE TABLE refresh_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    user_agent  TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);

CREATE TABLE api_keys (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    permissions  TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Taxonomy & people
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    parent_id   BIGINT REFERENCES categories(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    itunes_name TEXT NOT NULL DEFAULT '',
    sort_order  INT  NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tags_name_trgm ON tags USING gin (name gin_trgm_ops);

CREATE TABLE hosts (
    id           BIGSERIAL PRIMARY KEY,
    owner_tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    photo_url    TEXT NOT NULL DEFAULT '',
    bio          TEXT NOT NULL DEFAULT '',
    website_url  TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(name,'')), 'A') ||
        setweight(to_tsvector('simple', coalesce(bio,'')), 'C')
    ) STORED
);
CREATE INDEX hosts_search_idx ON hosts USING gin (search_vector);
CREATE INDEX hosts_name_trgm ON hosts USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Podcasts & episodes
-- ---------------------------------------------------------------------------
CREATE TABLE podcasts (
    id                  BIGSERIAL PRIMARY KEY,
    owner_tenant_id     BIGINT REFERENCES tenants(id) ON DELETE SET NULL, -- NULL = central library
    canonical_tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    description         TEXT NOT NULL DEFAULT '',
    short_description   TEXT NOT NULL DEFAULT '',
    artwork_url         TEXT NOT NULL DEFAULT '',
    artwork_image_id    BIGINT,
    banner_url          TEXT NOT NULL DEFAULT '',
    author              TEXT NOT NULL DEFAULT '',
    owner_name          TEXT NOT NULL DEFAULT '',
    owner_email         TEXT NOT NULL DEFAULT '',
    language            TEXT NOT NULL DEFAULT 'en',
    explicit            BOOLEAN NOT NULL DEFAULT FALSE,
    copyright           TEXT NOT NULL DEFAULT '',
    website_url         TEXT NOT NULL DEFAULT '',
    rss_url             TEXT NOT NULL DEFAULT '',  -- external source feed (imported podcasts)
    source_type         TEXT NOT NULL DEFAULT 'NATIVE' CHECK (source_type IN ('NATIVE','IMPORTED')),
    podcast_type        TEXT NOT NULL DEFAULT 'episodic' CHECK (podcast_type IN ('episodic','serial')),
    category_id         BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id      BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','SCHEDULED','ARCHIVED')),
    scheduled_at        TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,
    feed_guid           UUID NOT NULL DEFAULT gen_random_uuid(),
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
        setweight(to_tsvector('simple', coalesce(author,'')), 'B') ||
        setweight(to_tsvector('simple', coalesce(short_description,'')), 'B') ||
        setweight(to_tsvector('simple', regexp_replace(coalesce(description,''), '<[^>]+>', ' ', 'g')), 'C')
    ) STORED
);
CREATE INDEX podcasts_search_idx ON podcasts USING gin (search_vector);
CREATE INDEX podcasts_owner_idx ON podcasts(owner_tenant_id);
CREATE INDEX podcasts_status_idx ON podcasts(status);
CREATE INDEX podcasts_category_idx ON podcasts(category_id);

CREATE TABLE podcast_categories (
    podcast_id  BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (podcast_id, category_id)
);

CREATE TABLE podcast_tags (
    podcast_id BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    tag_id     BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (podcast_id, tag_id)
);

CREATE TABLE podcast_hosts (
    podcast_id BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    host_id    BIGINT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'host',
    sort_order INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (podcast_id, host_id)
);

CREATE TABLE user_podcasts (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    podcast_id BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, podcast_id)
);

-- A podcast is stored once; tenant_podcasts publishes it on many sites (PRD §61, §114).
CREATE TABLE tenant_podcasts (
    tenant_id          BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    podcast_id         BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    hidden             BOOLEAN NOT NULL DEFAULT FALSE,
    is_featured        BOOLEAN NOT NULL DEFAULT FALSE,
    is_editors_pick    BOOLEAN NOT NULL DEFAULT FALSE,
    seo_title          TEXT NOT NULL DEFAULT '',
    meta_description   TEXT NOT NULL DEFAULT '',
    featured_image_url TEXT NOT NULL DEFAULT '',
    category_id        BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    canonical_mode     TEXT NOT NULL DEFAULT 'SELF' CHECK (canonical_mode IN ('SELF','PRIMARY')),
    sort_order         INT  NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, podcast_id)
);
CREATE INDEX tenant_podcasts_podcast_idx ON tenant_podcasts(podcast_id);

-- Podcasts visible on a tenant (before status filtering).
CREATE FUNCTION tenant_podcast_ids(t BIGINT) RETURNS TABLE(podcast_id BIGINT) AS $$
    SELECT tp.podcast_id FROM tenant_podcasts tp WHERE tp.tenant_id = t AND NOT tp.hidden
    UNION
    SELECT p.id FROM podcasts p JOIN tenants tn ON tn.id = t
     WHERE tn.content_mode = 'SHARED' AND p.owner_tenant_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM tenant_podcasts x
                        WHERE x.tenant_id = t AND x.podcast_id = p.id AND x.hidden)
$$ LANGUAGE sql STABLE;

CREATE TABLE episodes (
    id                BIGSERIAL PRIMARY KEY,
    podcast_id        BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    slug              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    short_description TEXT NOT NULL DEFAULT '',
    show_notes        TEXT NOT NULL DEFAULT '',
    episode_number    INT,
    season_number     INT,
    episode_type      TEXT NOT NULL DEFAULT 'full' CHECK (episode_type IN ('full','trailer','bonus')),
    audio_file_id     BIGINT,
    audio_url         TEXT NOT NULL DEFAULT '',
    audio_size        BIGINT NOT NULL DEFAULT 0,
    audio_mime        TEXT NOT NULL DEFAULT '',
    duration          INT  NOT NULL DEFAULT 0, -- seconds
    artwork_url       TEXT NOT NULL DEFAULT '',
    transcript        TEXT NOT NULL DEFAULT '',
    transcript_format TEXT NOT NULL DEFAULT '' CHECK (transcript_format IN ('','txt','srt','vtt')),
    transcript_source TEXT NOT NULL DEFAULT '' CHECK (transcript_source IN ('','manual','upload','ai')),
    transcript_url    TEXT NOT NULL DEFAULT '',
    transcript_approved BOOLEAN NOT NULL DEFAULT TRUE, -- AI transcripts need review before public display
    explicit          BOOLEAN NOT NULL DEFAULT FALSE,
    status            TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','PROCESSING','SCHEDULED','PUBLISHED','FAILED','ARCHIVED')),
    published_at      TIMESTAMPTZ,
    scheduled_at      TIMESTAMPTZ,
    guid              TEXT NOT NULL UNIQUE,
    source_guid       TEXT NOT NULL DEFAULT '',
    seo_title         TEXT NOT NULL DEFAULT '',
    meta_description  TEXT NOT NULL DEFAULT '',
    canonical_url     TEXT NOT NULL DEFAULT '',
    key_topics        JSONB NOT NULL DEFAULT '[]'::jsonb,
    faq               JSONB NOT NULL DEFAULT '[]'::jsonb,
    citations         JSONB NOT NULL DEFAULT '[]'::jsonb,
    processing_error  TEXT NOT NULL DEFAULT '',
    created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
        setweight(to_tsvector('simple', coalesce(short_description,'')), 'B') ||
        setweight(to_tsvector('simple', regexp_replace(coalesce(description,''), '<[^>]+>', ' ', 'g')), 'C') ||
        setweight(to_tsvector('simple', left(coalesce(transcript,''), 200000)), 'D')
    ) STORED,
    UNIQUE (podcast_id, slug)
);
CREATE INDEX episodes_search_idx ON episodes USING gin (search_vector);
CREATE INDEX episodes_podcast_pub_idx ON episodes(podcast_id, published_at DESC);
CREATE INDEX episodes_status_idx ON episodes(status);
CREATE INDEX episodes_source_guid_idx ON episodes(podcast_id, source_guid);

-- GUID is permanent once an episode has been published (PRD §63, §116).
CREATE FUNCTION protect_episode_guid() RETURNS trigger AS $$
BEGIN
    IF NEW.guid IS DISTINCT FROM OLD.guid AND OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'episode guid cannot change after publish';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER episodes_guid_guard BEFORE UPDATE ON episodes
    FOR EACH ROW EXECUTE FUNCTION protect_episode_guid();

CREATE TABLE episode_tags (
    episode_id BIGINT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    tag_id     BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (episode_id, tag_id)
);

CREATE TABLE episode_hosts (
    episode_id BIGINT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    host_id    BIGINT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'guest',
    PRIMARY KEY (episode_id, host_id)
);

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------
CREATE TABLE uploads (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    BIGINT REFERENCES tenants(id) ON DELETE CASCADE,
    user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('audio','image','transcript')),
    target_type  TEXT NOT NULL DEFAULT '',
    target_id    BIGINT,
    purpose      TEXT NOT NULL DEFAULT '',
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         BIGINT NOT NULL,
    storage_key  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','UPLOADED','COMPLETED','FAILED')),
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audio_files (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    podcast_id      BIGINT REFERENCES podcasts(id) ON DELETE CASCADE,
    episode_id      BIGINT REFERENCES episodes(id) ON DELETE CASCADE,
    original_key    TEXT NOT NULL,
    original_name   TEXT NOT NULL DEFAULT '',
    original_mime   TEXT NOT NULL DEFAULT '',
    original_size   BIGINT NOT NULL DEFAULT 0,
    processed_key   TEXT NOT NULL DEFAULT '',
    processed_size  BIGINT NOT NULL DEFAULT 0,
    codec           TEXT NOT NULL DEFAULT '',
    bitrate         INT NOT NULL DEFAULT 0,
    sample_rate     INT NOT NULL DEFAULT 0,
    channels        INT NOT NULL DEFAULT 0,
    duration        INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','PROCESSING','READY','FAILED')),
    error_message   TEXT NOT NULL DEFAULT '',
    error_detail    TEXT NOT NULL DEFAULT '',
    attempts        INT NOT NULL DEFAULT 0,
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audio_files_episode_idx ON audio_files(episode_id);

CREATE TABLE images (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    owner_type   TEXT NOT NULL DEFAULT '',
    owner_id     BIGINT,
    original_key TEXT NOT NULL,
    variants     JSONB NOT NULL DEFAULT '{}'::jsonb,
    width        INT NOT NULL DEFAULT 0,
    height       INT NOT NULL DEFAULT 0,
    mime         TEXT NOT NULL DEFAULT '',
    size         BIGINT NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','READY','FAILED')),
    error        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Distribution
-- ---------------------------------------------------------------------------
CREATE TABLE platforms (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    website_url     TEXT NOT NULL DEFAULT '',
    submit_url      TEXT NOT NULL DEFAULT '',
    icon            TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL DEFAULT '#555555',
    submission_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (submission_type IN ('MANUAL','API')),
    api_provider    TEXT NOT NULL DEFAULT '',
    url_pattern     TEXT NOT NULL DEFAULT '',
    instructions    TEXT NOT NULL DEFAULT '',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE podcast_distributions (
    id              BIGSERIAL PRIMARY KEY,
    podcast_id      BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    platform_id     BIGINT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'NOT_STARTED'
                    CHECK (status IN ('NOT_STARTED','READY','SUBMITTED','PENDING','LIVE','REJECTED','FAILED','ACTION_REQUIRED')),
    external_id     TEXT NOT NULL DEFAULT '',
    external_url    TEXT NOT NULL DEFAULT '',
    submitted_at    TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    notes           TEXT NOT NULL DEFAULT '',
    issue_reason    TEXT NOT NULL DEFAULT '',
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (podcast_id, platform_id)
);
CREATE INDEX podcast_distributions_status_idx ON podcast_distributions(status);

CREATE TABLE distribution_events (
    id              BIGSERIAL PRIMARY KEY,
    distribution_id BIGINT NOT NULL REFERENCES podcast_distributions(id) ON DELETE CASCADE,
    from_status     TEXT NOT NULL DEFAULT '',
    to_status       TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    user_email      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX distribution_events_dist_idx ON distribution_events(distribution_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RSS import / sync / health
-- ---------------------------------------------------------------------------
CREATE TABLE rss_sources (
    id                    BIGSERIAL PRIMARY KEY,
    podcast_id            BIGINT REFERENCES podcasts(id) ON DELETE CASCADE,
    tenant_id             BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    feed_url              TEXT NOT NULL,
    import_mode           TEXT NOT NULL DEFAULT 'METADATA_ONLY' CHECK (import_mode IN ('METADATA_ONLY','MIRROR_AUDIO')),
    sync_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    sync_interval_minutes INT NOT NULL DEFAULT 60,
    status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IMPORTING','ACTIVE','ERROR')),
    last_synced_at        TIMESTAMPTZ,
    next_sync_at          TIMESTAMPTZ,
    last_error            TEXT NOT NULL DEFAULT '',
    etag                  TEXT NOT NULL DEFAULT '',
    last_modified         TEXT NOT NULL DEFAULT '',
    created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rss_sources_next_idx ON rss_sources(next_sync_at) WHERE sync_enabled;

CREATE TABLE rss_sync_logs (
    id               BIGSERIAL PRIMARY KEY,
    rss_source_id    BIGINT NOT NULL REFERENCES rss_sources(id) ON DELETE CASCADE,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','NOT_MODIFIED','FAILED')),
    new_episodes     INT NOT NULL DEFAULT 0,
    updated_episodes INT NOT NULL DEFAULT 0,
    message          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX rss_sync_logs_source_idx ON rss_sync_logs(rss_source_id, started_at DESC);

CREATE TABLE rss_health_checks (
    id         BIGSERIAL PRIMARY KEY,
    podcast_id BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('HEALTHY','WARNING','CRITICAL')),
    checks     JSONB NOT NULL DEFAULT '[]'::jsonb,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rss_health_podcast_idx ON rss_health_checks(podcast_id, checked_at DESC);

-- ---------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------
CREATE TABLE analytics_events (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain        TEXT NOT NULL DEFAULT '',
    event_type    TEXT NOT NULL CHECK (event_type IN
                  ('PAGE_VIEW','PLAY','25_PERCENT','50_PERCENT','75_PERCENT','COMPLETE','PAUSE','SEEK','DOWNLOAD')),
    podcast_id    BIGINT REFERENCES podcasts(id) ON DELETE SET NULL,
    episode_id    BIGINT REFERENCES episodes(id) ON DELETE SET NULL,
    path          TEXT NOT NULL DEFAULT '',
    referrer_host TEXT NOT NULL DEFAULT '',
    country       TEXT NOT NULL DEFAULT '',
    device        TEXT NOT NULL DEFAULT '',
    browser       TEXT NOT NULL DEFAULT '',
    os            TEXT NOT NULL DEFAULT '',
    visitor_hash  TEXT NOT NULL DEFAULT '',
    session_id    TEXT NOT NULL DEFAULT '',
    position      INT  NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_tenant_time_idx ON analytics_events(tenant_id, created_at);
CREATE INDEX analytics_events_type_time_idx ON analytics_events(event_type, created_at);
CREATE INDEX analytics_events_episode_idx ON analytics_events(episode_id, event_type);

CREATE TABLE analytics_daily (
    day        DATE   NOT NULL,
    tenant_id  BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    podcast_id BIGINT NOT NULL DEFAULT 0,
    episode_id BIGINT NOT NULL DEFAULT 0,
    event_type TEXT   NOT NULL,
    events     BIGINT NOT NULL DEFAULT 0,
    visitors   BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, tenant_id, podcast_id, episode_id, event_type)
);

-- ---------------------------------------------------------------------------
-- SEO, redirects, collections
-- ---------------------------------------------------------------------------
CREATE TABLE redirects (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = applies to all tenants
    from_path   TEXT NOT NULL,
    to_path     TEXT NOT NULL,
    status_code INT  NOT NULL DEFAULT 301 CHECK (status_code IN (301,302,307,308)),
    is_auto     BOOLEAN NOT NULL DEFAULT FALSE,
    hits        BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX redirects_unique_idx ON redirects(COALESCE(tenant_id, 0), from_path);

CREATE TABLE collections (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    slug         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    cover_url    TEXT NOT NULL DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE collection_items (
    collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    podcast_id    BIGINT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    sort_order    INT NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, podcast_id)
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = platform-level
    type       TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','error')),
    title      TEXT NOT NULL,
    message    TEXT NOT NULL DEFAULT '',
    link       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_tenant_idx ON notifications(tenant_id, created_at DESC);

CREATE TABLE notification_reads (
    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    user_email    TEXT NOT NULL DEFAULT '',
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT '',
    resource_id   TEXT NOT NULL DEFAULT '',
    tenant_id     BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    ip            TEXT NOT NULL DEFAULT '',
    user_agent    TEXT NOT NULL DEFAULT '',
    changes       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX audit_logs_time_idx ON audit_logs(created_at DESC);

CREATE TABLE system_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_logs (
    id         BIGSERIAL PRIMARY KEY,
    level      TEXT NOT NULL CHECK (level IN ('info','warning','error','critical')),
    source     TEXT NOT NULL,
    message    TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    tenant_id  BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
    resolved   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX system_logs_time_idx ON system_logs(created_at DESC);

CREATE TABLE job_runs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    status      TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','RETRYING')),
    attempts    INT NOT NULL DEFAULT 0,
    error       TEXT NOT NULL DEFAULT '',
    tenant_id   BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX job_runs_time_idx ON job_runs(created_at DESC);
CREATE INDEX job_runs_status_idx ON job_runs(status);

CREATE TABLE webhooks (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT REFERENCES tenants(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    events     TEXT[] NOT NULL DEFAULT '{}',
    secret     TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
    id          BIGSERIAL PRIMARY KEY,
    webhook_id  BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event       TEXT NOT NULL,
    payload     JSONB NOT NULL,
    status_code INT NOT NULL DEFAULT 0,
    success     BOOLEAN NOT NULL DEFAULT FALSE,
    error       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_hook_idx ON webhook_deliveries(webhook_id, created_at DESC);
