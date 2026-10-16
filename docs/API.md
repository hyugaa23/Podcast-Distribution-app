# API Reference

Base URL: `http://localhost:8080` (behind the admin app every path is reachable at `/api/...` via a same-origin proxy).

* Successful responses are `{ "data": ... }`. Paginated lists are `{ "data": [...], "meta": { total, page, per_page, pages } }` (`?page=&per_page=`).
* Errors are `{ "error": { "code", "message", "details"? } }` with a 4xx/5xx status.
* Admin endpoints need `Authorization: Bearer <access_token>` (JWT, 15 min) **or** an API key (`X-API-Key: pk_...` / `Bearer pk_...`).
* Roles: `SUPER_ADMIN`, `TENANT_ADMIN`, `EDITOR`, `CREATOR`, `VIEWER`. Permissions are enforced on the backend. Tenant users are always pinned to their own tenant; super admins may pass `?tenant_id=` on list endpoints (omit it for the whole network).
* Types are defined in `apps/admin/lib/types.ts` (admin) and `packages/types/src/index.ts` (public).

## Auth
| Method | Path | Body / notes |
|---|---|---|
| POST | `/api/auth/login` | `{email, password}` → `{access_token, expires_at, user}` + httpOnly refresh cookie |
| POST | `/api/auth/refresh` | header `X-Requested-With` required (CSRF); rotates the refresh cookie |
| POST | `/api/auth/logout` | revokes refresh token |
| GET | `/api/auth/me` | `{user, tenant?}` |
| POST | `/api/auth/change-password` | `{current_password, new_password}` |

## Dashboard, themes
| GET | `/api/dashboard` | super admin without tenant scope → `{scope:'network', stats{tenants,domains,podcasts,episodes,plays,storage_bytes,distribution_live,distribution_pending,distribution_issues}, recent_episodes, alerts[], queue, tenants[]}`; otherwise `{scope:'tenant', tenant_name, stats{podcasts,episodes,plays,platforms}, distribution[{name,key,color,live}], recent_episodes, analytics_30d}` |
|---|---|---|
| GET | `/api/themes` | 10 themes `{id,key,number,name,description,default_config}` |

## Tenants (websites) — PRD §9
| GET | `/api/tenants?q=` | Tenant[] |
|---|---|---|
| POST | `/api/tenants` (super) | `{name, slug?, domain?, theme (key), primary_color?, secondary_color?, accent_color?, logo_url?, language, timezone, content_mode: INDEPENDENT/SHARED/SYNDICATED}` |
| GET | `/api/tenants/:id` | `{tenant, stats{podcasts,episodes,domains,users}}` |
| PUT | `/api/tenants/:id` | `{name?, theme?, content_mode?(super), language?, timezone?, status?(super)}` |
| DELETE | `/api/tenants/:id` (super) | |
| GET/PUT | `/api/tenants/:id/settings` | `{branding{logo_url,favicon_url,primary_color,secondary_color,accent_color,heading_font,body_font,default_cover_url,footer_text,tagline,social_links{}}, theme_config{primary,secondary,background,surface,text,fontHeading,fontBody,radius,playerStyle,...}, homepage_sections[{type,enabled,title,subtitle?,limit?,button_label?,button_href?}], navigation[{label,type,href,enabled}], about_content}` (PUT accepts any subset). Section types: hero, featured, trending, latest_episodes, popular, categories, editors_picks, new_podcasts, collections, newsletter, cta. Nav types: home, podcasts, episodes, categories, hosts, collections, about, search, custom |
| GET/PUT | `/api/tenants/:id/seo` | `{site_title,title_template('%s \| {site_name}'),meta_description,default_og_image,twitter_card,twitter_handle,organization_name,organization_logo,canonical_domain,index_policy(index/noindex),robots_extra}` |
| GET | `/api/tenants/:id/podcasts` | podcasts on the site with per-tenant overrides |

## Domains — PRD §8
| GET | `/api/domains` | Domain[] (`verification_status, dns_status, ssl_status, verification_token, is_primary, redirect_to_primary, status`) |
|---|---|---|
| POST | `/api/domains` (super) | `{tenant_id, domain, is_primary?, redirect_to_primary?}` |
| PUT | `/api/domains/:id` (super) | `{tenant_id?, is_primary?, redirect_to_primary?, status?(ACTIVE/DISABLED), verification_status?(manual override)}` |
| DELETE | `/api/domains/:id` (super) | |
| POST | `/api/domains/:id/verify` | runs DNS TXT `_podcast-verify.<domain>` / HTTP `/.well-known/podcast-verify.txt`, DNS and SSL checks |

## Users — PRD §5, §71
| GET | `/api/users` | User[] |
|---|---|---|
| POST | `/api/users` | `{email, password, name, role, tenant_id, podcast_ids?(creators)}` |
| PUT | `/api/users/:id` | same fields, all optional; `status` ACTIVE/DISABLED |
| DELETE | `/api/users/:id` | |

## Podcasts — PRD §11, §84
| GET | `/api/podcasts?q=&status=&category_id=&source_type=&library=1&sort=title/created/updated&page=` | paginated Podcast[] (each has `can_edit`) |
|---|---|---|
| POST | `/api/podcasts` | `{title, slug?, description, short_description, artwork_url?, banner_url?, author, owner_name, owner_email, language, explicit, copyright, website_url, podcast_type(episodic/serial), category_id, subcategory_id, category_ids?, tags[], hosts[{host_id,role}], status(DRAFT/PUBLISHED/SCHEDULED/ARCHIVED), scheduled_at? ('2026-10-20 09:00' in tenant timezone), owner_tenant_id?(super: 0 = central library), canonical_tenant_id?}` |
| GET / PUT / DELETE | `/api/podcasts/:id` | PUT accepts any subset; changing `slug` creates automatic 301 redirects (page + feed) |
| POST | `/api/podcasts/:id/publish`, `/unpublish` | |
| GET | `/api/podcasts/:id/episodes?page=` | paginated Episode[] |
| GET | `/api/podcasts/:id/feed` | `{feed_url, validation{valid,errors,warnings,items,issues[]}, size}`; `?format=xml` returns the XML |
| GET | `/api/podcasts/:id/rss-health` | last checks `[{status, checks[{key,label,status,message}], checked_at}]` |
| POST | `/api/podcasts/:id/rss-health` | run a check now → `{status: HEALTHY/WARNING/CRITICAL, checks[], feed_url}` |
| GET | `/api/podcasts/:id/tenants` | syndication matrix `[{tenant_id, tenant_name, content_mode, domain, assigned, linked, is_owner, can_assign, is_featured, is_editors_pick, hidden, seo_title, meta_description, featured_image_url, category_id, canonical_mode}]` |
| PUT | `/api/podcasts/:id/tenants` (super) | `{tenant_ids[], canonical_tenant_id?}` — "Distribution Across Sites" |
| PUT | `/api/podcasts/:id/tenants/:tenantID` | per-tenant overrides `{is_featured, is_editors_pick, hidden, seo_title, meta_description, featured_image_url, category_id, canonical_mode: SELF/PRIMARY, sort_order}` |
| POST | `/api/podcasts/bulk` | `{action: publish/unpublish/archive/category/assign_tenants/delete, ids[], category_id?, tenant_ids?}` → `{ok[], skipped[]}` |

## Episodes — PRD §13, §85, §86
| GET | `/api/episodes?podcast_id=&status=&q=&page=` | paginated Episode[] (light: no transcript) |
|---|---|---|
| POST | `/api/episodes` | `{podcast_id, title, slug?, description, short_description, show_notes, episode_number?, season_number?, episode_type(full/trailer/bonus), artwork_url?, audio_url?, audio_size?, duration?, publish_date?, explicit, transcript?, transcript_format?(txt/srt/vtt), tags[], seo_title, meta_description, canonical_url, key_topics[], faq[{question,answer}], citations[{title,url}], hosts[{host_id,role}], status?}` |
| GET | `/api/episodes/:id` | `{data: Episode, audio: AudioFile|null}` |
| PUT / DELETE | `/api/episodes/:id` | PUT any subset (+ `clear_episode_number`, `clear_season_number`, `transcript_approved`); GUID never changes |
| POST | `/api/episodes/:id/publish` | 200, or 202 `{queued:true}` when audio is still processing (publishes when ready); 422 if no audio |
| POST | `/api/episodes/:id/unpublish` | |
| POST | `/api/episodes/:id/schedule` | `{publish_at: '2026-10-20 09:00'}` interpreted in the tenant timezone |
| GET | `/api/episodes/:id/audio` | AudioFile history |
| POST | `/api/episodes/:id/audio/retry` | re-queue failed audio processing |
| POST | `/api/episodes/:id/transcript/generate` | AI transcript (422 `not_configured` without provider) |
| POST | `/api/episodes/:id/preview-token` | `{token, url}` signed preview link |
| POST | `/api/episodes/bulk` | `{action: publish/unpublish/archive/delete, ids[]}` |

## Uploads (signed) — PRD §14, §77
1. `POST /api/uploads` `{purpose, target_id, filename, content_type, size}` → `{upload_id, method:'PUT', url, headers}`.
   Purposes: `episode_audio` (MP3/M4A/WAV), `episode_artwork`, `transcript` (txt/srt/vtt), `podcast_artwork`, `podcast_banner`, `host_photo`, `tenant_logo`, `tenant_favicon`, `tenant_cover`, `og_image` (target = tenant id), `collection_cover`.
2. `PUT <url>` with the raw file body and the returned headers.
3. `POST /api/uploads/:upload_id/complete` → `{url, audio_file_id?, job_id?, image_id?}`. Audio is queued for FFmpeg processing (episode status becomes PROCESSING → DRAFT/SCHEDULED/PUBLISHED or FAILED with `processing_error`).
The admin helper `uploadFile(purpose, targetId, file, onProgress)` in `apps/admin/lib/api.ts` performs all three steps.

## Taxonomy, hosts, collections
| GET | `/api/categories` | Category[] (with `parent_id`, `podcast_count`) ; POST/PUT/DELETE super only `{name, slug?, parent_id?, description, itunes_name, sort_order}` |
|---|---|---|
| GET | `/api/tags?q=` | `[{id,name,slug,count}]` |
| GET/POST | `/api/hosts` | Host[] ; `{name, slug?, photo_url, bio, website_url, email, social_links{}}` (super: `?tenant_id=` owner) |
| GET/PUT/DELETE | `/api/hosts/:id` | |
| GET/POST | `/api/collections` | Collection[] ; `{tenant_id, title, slug?, description, cover_url, is_published, sort_order, podcast_ids[]}` |
| PUT/DELETE | `/api/collections/:id` | |

## Distribution — PRD §20–27, §95, §97
| GET | `/api/platforms?active=1` | Platform[] ; POST/PUT (full record) /DELETE super only `{key?, name, website_url, submit_url, color, submission_type(MANUAL/API), api_provider('podcastindex'), url_pattern('https://.../{id}'), instructions, is_active, sort_order}` |
|---|---|---|
| GET | `/api/distribution?status=&platform=&podcast_id=&page=` | paginated Distribution[]; `status` may be any status, `FAILED` (failed+rejected) or `ISSUES` (action required+failed+rejected) |
| GET | `/api/distribution/overview` | `{counts{STATUS:n}, tracked, issues, health_percent, platforms[{platform_id,key,name,color,live,pending,issues,total}], published_podcasts, recent_issues[]}` |
| GET | `/api/distribution/:podcastID` | `{platforms: Distribution[] (one per platform, NOT_STARTED rows have id 0), live, total, progress_percent, readiness: Readiness, can_manage}` |
| GET | `/api/distribution/:podcastID/readiness` | `{percent, ready, checklist[{key,label,passed,detail}], missing[], feed_url, feed_validation}` |
| POST | `/api/distribution/:podcastID/:platform` | platform = id or key. `{status?, external_url?, external_id?, notes?, issue_reason?, note?}` — LIVE requires an external URL (or id with url_pattern) |
| POST | `/api/distribution/:podcastID/:platform/submit` | API platforms submit via official API; manual platforms → SUBMITTED + `{submit_url, feed_url}` |
| GET | `/api/distribution/:podcastID/:platform/events` | status history `[{from_status,to_status,note,user_email,created_at}]` |
| POST | `/api/distribution/bulk` | `{podcast_ids[], platform_ids[], status(not LIVE), note?}` |

## Import / export — PRD §18, §19, §88
| POST | `/api/imports/rss/preview` | `{feed_url}` → `{feed{title,description,author,owner_email,image_url,categories,episodes[..10]}, episode_count}` |
|---|---|---|
| POST | `/api/imports/rss` | `{feed_url, mode: METADATA_ONLY/MIRROR_AUDIO, tenant_id?(super, 0=library), sync_enabled, sync_interval_minutes(15/30/60/360/1440)}` → 202 |
| POST | `/api/imports/csv?type=podcasts|episodes` | JSON `{csv:"..."}` or multipart `file`. Podcast columns: title, slug, description, short_description, author, owner_name, owner_email, language, explicit, category, subcategory, artwork_url, website_url, copyright, tags (a;b), status. Episode columns: podcast_slug, title, slug, description, short_description, episode_number, season_number, episode_type, audio_url, audio_size, duration, publish_date, explicit, tags, status, guid, transcript |
| GET | `/api/rss-sources` | `{sources: RSSSource[], intervals[]}` |
| PUT | `/api/rss-sources/:id` | `{sync_enabled?, sync_interval_minutes?, import_mode?}` |
| POST | `/api/rss-sources/:id/sync` | sync now |
| DELETE | `/api/rss-sources/:id` | |
| GET | `/api/rss-sources/:id/logs` | sync logs |
| GET | `/api/exports/{podcasts|episodes|distribution|analytics}` | CSV download (`?format=json` for JSON) |

## Analytics — PRD §57–59
| GET | `/api/analytics/summary?days=30&from=&to=&podcast_id=` | `{episode_plays, podcast_plays, completions, unique_visitors, page_views, funnel[], series[{day,plays,page_views,visitors}], top_podcasts[], top_episodes[], referrers[], countries[], devices[], browsers[], domains[]}` (KV = `{key,label,value}`) |
|---|---|---|
| GET | `/api/analytics/network` (super) | `{tenants: TenantComparison[], network: summary}` |

## Operations
| GET | `/api/notifications` | `{items: Notification[], unread}` ; POST `/api/notifications/:id/read`, `/api/notifications/read-all` |
|---|---|---|
| GET | `/api/audit-logs?action=&resource_type=&page=` | paginated `[{id,user,action,resource_type,resource_id,tenant,ip,changes,created_at}]` |
| GET/POST | `/api/redirects` | `[{id,tenant_id,tenant_name,from_path,to_path,status_code,is_auto,hits}]` ; POST `{tenant_id?, from_path, to_path, status_code}` ; DELETE `/api/redirects/:id` |
| GET/POST | `/api/api-keys` | `{keys[], available_permissions[]}` ; POST `{tenant_id, name, permissions[]}` → `{key}` (shown once) ; DELETE revokes |
| GET/POST | `/api/webhooks` | `{webhooks[], events[]}` ; POST `{tenant_id?, url(https), events[]}` → `{secret}` ; DELETE ; GET `/api/webhooks/:id/deliveries` |
| GET | `/api/system/settings` (super) | `{settings{key: object}, keys[], environment{}}` ; PUT `/api/system/settings/:key` with the object |
| GET | `/api/system/metrics` | `{uptime_seconds, api[{route,count,errors,avg_ms,max_ms,under_200ms,under_500ms}], queue, jobs_24h, storage, runtime, db_pool}` |
| GET | `/api/system/jobs?status=` | `{jobs[], queue}` ; POST `/api/system/jobs/:id/retry` |
| GET | `/api/system/logs?level=&unresolved=1` | system logs ; POST `/api/system/logs/:id/resolve` |
| GET | `/api/system/backup` | JSON export of tenant config, podcast & distribution metadata |
| GET | `/healthz`, `/readyz`, `/metrics` (Prometheus, private network only) | |

## Public (tenant resolved from `Host` / `X-Tenant-Host`)
`/api/public/resolve?host=&path=`, `/site`, `/home`, `/podcasts`, `/podcasts/:slug`, `/podcasts/:slug/episodes`, `/podcasts/:slug/episodes/:episode`, `/podcasts/:slug/episodes/:episode/transcript`, `/episodes`, `/categories`, `/categories/:slug`, `/hosts`, `/hosts/:slug`, `/tags/:slug`, `/collections`, `/collections/:slug`, `/search?q=&type=`, `/feeds/:slug`, `/sitemap/:segment`, `/robots.txt`, `/redirect?path=`, `/preview/episodes/:id?token=`, `POST /events`.
