-- Consolidate duplicate platform pairs (seed.go keys vs migration 0003 keys).
-- Keeps the newer 0003 rows (richer data), migrates references from old keys.

-- 1. apple-podcasts → apple
UPDATE podcast_distributions SET platform_id = (SELECT id FROM platforms WHERE key='apple' LIMIT 1)
  WHERE platform_id = (SELECT id FROM platforms WHERE key='apple-podcasts' LIMIT 1)
  AND (SELECT id FROM platforms WHERE key='apple' LIMIT 1) IS NOT NULL
  AND (SELECT id FROM platforms WHERE key='apple-podcasts' LIMIT 1) IS NOT NULL;
DELETE FROM platforms WHERE key='apple-podcasts'
  AND EXISTS (SELECT 1 FROM platforms WHERE key='apple');

-- 2. youtube-music → youtube
UPDATE podcast_distributions SET platform_id = (SELECT id FROM platforms WHERE key='youtube' LIMIT 1)
  WHERE platform_id = (SELECT id FROM platforms WHERE key='youtube-music' LIMIT 1)
  AND (SELECT id FROM platforms WHERE key='youtube' LIMIT 1) IS NOT NULL
  AND (SELECT id FROM platforms WHERE key='youtube-music' LIMIT 1) IS NOT NULL;
DELETE FROM platforms WHERE key='youtube-music'
  AND EXISTS (SELECT 1 FROM platforms WHERE key='youtube');

-- 3. amazon-music → amazon
UPDATE podcast_distributions SET platform_id = (SELECT id FROM platforms WHERE key='amazon' LIMIT 1)
  WHERE platform_id = (SELECT id FROM platforms WHERE key='amazon-music' LIMIT 1)
  AND (SELECT id FROM platforms WHERE key='amazon' LIMIT 1) IS NOT NULL
  AND (SELECT id FROM platforms WHERE key='amazon-music' LIMIT 1) IS NOT NULL;
DELETE FROM platforms WHERE key='amazon-music'
  AND EXISTS (SELECT 1 FROM platforms WHERE key='amazon');

-- 4. podcast-index → podcastindex
UPDATE podcast_distributions SET platform_id = (SELECT id FROM platforms WHERE key='podcastindex' LIMIT 1)
  WHERE platform_id = (SELECT id FROM platforms WHERE key='podcast-index' LIMIT 1)
  AND (SELECT id FROM platforms WHERE key='podcastindex' LIMIT 1) IS NOT NULL
  AND (SELECT id FROM platforms WHERE key='podcast-index' LIMIT 1) IS NOT NULL;
DELETE FROM platforms WHERE key='podcast-index'
  AND EXISTS (SELECT 1 FROM platforms WHERE key='podcastindex');

-- 5. Also update seed.go keys to match the canonical keys
-- (handled in code change to seed.go)

-- 6. Prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_platforms_key ON platforms(key);
