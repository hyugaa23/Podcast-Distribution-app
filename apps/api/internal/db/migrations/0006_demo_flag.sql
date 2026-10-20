-- Add is_demo flag to tenants so the UI can distinguish seeded demo data from real user data.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Mark existing demo tenants (seeded by demo.go) based on their known slugs.
UPDATE tenants SET is_demo = true WHERE slug IN (
  'podcastbusiness', 'techvoice', 'dailycast', 'creatorvoice',
  'premiumtalk', 'editorialaudio', 'entertainhub', 'wavelengthradio'
);
