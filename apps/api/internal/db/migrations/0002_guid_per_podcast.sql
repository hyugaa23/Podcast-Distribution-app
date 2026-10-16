-- Episode GUIDs must be unique within a feed (podcast). Imported feeds keep their original GUIDs,
-- so the same external feed can be imported for several tenants/library without conflicts.
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_guid_key;
CREATE UNIQUE INDEX IF NOT EXISTS episodes_podcast_guid_idx ON episodes(podcast_id, guid);
