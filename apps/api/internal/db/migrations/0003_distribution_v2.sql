-- PRD v2: Distribution Manager enhancements — additional statuses, platform registry
-- fields, distribution record fields, and seed data for 10 free platforms.

-- 1. Add new statuses to podcast_distributions
ALTER TABLE podcast_distributions DROP CONSTRAINT IF EXISTS podcast_distributions_status_check;
ALTER TABLE podcast_distributions ADD CONSTRAINT podcast_distributions_status_check
    CHECK (status IN ('NOT_STARTED','READY','SUBMITTED','PENDING','PENDING_REVIEW','LIVE',
                      'REJECTED','FAILED','ACTION_REQUIRED','DISCOVERY_PENDING','UNAVAILABLE','PAUSED'));

-- 2. Add new columns to platforms registry (PRD v2 §9.2)
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS help_url              TEXT NOT NULL DEFAULT '';
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS account_required      BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS verification_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS supports_api          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS auto_discovery        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS last_verified_at      TIMESTAMPTZ;
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS notes                 TEXT NOT NULL DEFAULT '';

-- 3. Add new columns to podcast_distributions (PRD v2 §9.3–9.4)
ALTER TABLE podcast_distributions ADD COLUMN IF NOT EXISTS account_label       TEXT NOT NULL DEFAULT '';
ALTER TABLE podcast_distributions ADD COLUMN IF NOT EXISTS submitted_by        TEXT NOT NULL DEFAULT '';
ALTER TABLE podcast_distributions ADD COLUMN IF NOT EXISTS method              TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (method IN ('MANUAL','CLAIM','INDEXED','API'));
ALTER TABLE podcast_distributions ADD COLUMN IF NOT EXISTS verification_method TEXT NOT NULL DEFAULT '';
ALTER TABLE podcast_distributions ADD COLUMN IF NOT EXISTS next_review_at      TIMESTAMPTZ;
ALTER TABLE podcast_distributions ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ;

-- 4. Seed 10 default distribution platforms (from Panduan Operasional RSS 2026)
INSERT INTO platforms (key, name, website_url, submit_url, icon, color, submission_type, api_provider,
    url_pattern, instructions, is_active, is_default, sort_order,
    help_url, account_required, verification_required, supports_api, auto_discovery, notes)
VALUES
    ('spotify', 'Spotify', 'https://creators.spotify.com/',
     'https://creators.spotify.com/',
     'spotify', '#1DB954', 'MANUAL', '', 'https://open.spotify.com/show/{id}',
     '1. Masuk Spotify for Creators dengan akun Spotify gratis.
2. Pilih "Find an existing show" → "Somewhere else".
3. Masukkan URL RSS.
4. Verifikasi via kode 8 digit di email (itunes:email).
5. Selesaikan klaim, periksa URL publik Spotify.
6. JANGAN pilih migrasi hosting ke Spotify — RSS tetap di website sendiri.',
     TRUE, TRUE, 1,
     'https://support.spotify.com/id-id/creators/article/claiming-your-podcast-on-spotify-for-creators/',
     TRUE, TRUE, FALSE, FALSE,
     'Satu show hanya bisa diklaim sekali. Jika sudah diklaim orang lain, perlu bantuan admin pemilik.'),

    ('apple', 'Apple Podcasts', 'https://podcastsconnect.apple.com/',
     'https://podcastsconnect.apple.com/',
     'apple', '#A855F7', 'MANUAL', '', 'https://podcasts.apple.com/podcast/id{id}',
     '1. Siapkan Apple Account, masuk Apple Podcasts Connect.
2. Klik (+), pilih "New Show" → "Add a show with an RSS feed".
3. Tempel RSS URL, validasi, atur informasi show.
4. Publish show — tunggu review Apple.
5. Pastikan min 1 episode sudah terbit.
6. Buka URL Apple Podcasts publik dan simpan.',
     TRUE, TRUE, 2,
     'https://podcasters.apple.com/support/897-submit-a-show',
     TRUE, TRUE, FALSE, FALSE,
     'Submission RSS gratis. Apple Podcasters Program berbayar hanya untuk fitur subscription.'),

    ('youtube', 'YouTube / YouTube Music', 'https://studio.youtube.com/',
     'https://studio.youtube.com/',
     'youtube', '#FF0000', 'MANUAL', '', 'https://www.youtube.com/playlist?list={id}',
     '1. Login YouTube Studio, pastikan fitur lanjutan aktif.
2. Klik Buat → Podcast baru → Kirimkan feed RSS.
3. Setujui persyaratan, masukkan RSS URL.
4. Kirim kode verifikasi ke email RSS, masukkan kode.
5. Pilih cakupan episode (seluruh/sejak tanggal/mendatang).
6. Simpan, YouTube impor audio jadi video + artwork statis.
7. Masuk Konten → Podcast, klik Publikasikan bila tersedia.',
     TRUE, TRUE, 3,
     'https://support.google.com/youtube/answer/13973017?hl=id',
     TRUE, TRUE, FALSE, FALSE,
     'RSS YouTube tidak meneruskan ke Spotify/Apple. Perubahan audio RSS tidak otomatis ganti video lama. Indonesia didukung.'),

    ('podcast-addict', 'Podcast Addict', 'https://podcastaddict.com/',
     'https://podcastaddict.com/submit',
     'podcast-addict', '#F4842D', 'MANUAL', '', 'https://podcastaddict.com/podcast/{id}',
     '1. Buka halaman Submit Podcast di Podcast Addict.
2. Tempel RSS Feed URL yang publik dan valid.
3. Klik Submit.
4. Tunggu review dan indexing (~24 jam).
5. Cari nama show, buka halaman publik, simpan URL.',
     TRUE, TRUE, 4,
     'https://podcastaddict.com/podcasters',
     FALSE, FALSE, FALSE, FALSE,
     'Untuk statistik/claim, gunakan Podcaster Portal gratis dan lakukan verifikasi kepemilikan RSS.'),

    ('amazon', 'Amazon Music / Audible', 'https://podcasters.amazon.com/',
     'https://podcasters.amazon.com/',
     'amazon', '#FF9900', 'MANUAL', '', '',
     '1. Buka portal Amazon Music for Podcasters.
2. Cari opsi menambahkan/mengklaim podcast atau mengirimkan RSS.
3. Masukkan RSS URL dan informasi owner.
4. Selesaikan verifikasi kepemilikan.
5. Periksa status listing via pencarian Amazon Music, simpan URL.',
     TRUE, TRUE, 5,
     'https://support.spotify.com/us/creators/article/distributing-your-show-to-other-platforms/',
     TRUE, TRUE, FALSE, FALSE,
     'Detail tombol/formulir Amazon bisa berubah. Periksa UI portal terkini sebelum menandai langkah selesai.'),

    ('pocket-casts', 'Pocket Casts', 'https://pocketcasts.com/',
     '',
     'pocket-casts', '#F43E37', 'MANUAL', '', '',
     '1. Cari show di Pocket Casts dulu untuk hindari duplikat.
2. Jika belum ditemukan, buka pusat bantuan/alur submit yang tersedia.
3. Masukkan RSS URL bila tersedia.
4. Tunggu indexing, cari kembali, simpan URL publik.',
     TRUE, TRUE, 6,
     'https://support.spotify.com/us/creators/article/distributing-your-show-to-other-platforms/',
     FALSE, FALSE, FALSE, FALSE,
     'URL formulir submission spesifik tidak selalu tersedia. Jangan membuat URL form tebakan.'),

    ('castbox', 'Castbox', 'https://castbox.fm/',
     '',
     'castbox', '#F55B23', 'MANUAL', '', '',
     '1. Cari judul podcast di Castbox terlebih dahulu.
2. Masuk area creator/claim jika tersedia.
3. Ikuti alur claim/add show, masukkan RSS URL.
4. Selesaikan verifikasi kepemilikan.
5. Simpan URL show publik dan status klaim.',
     TRUE, TRUE, 7,
     'https://support.spotify.com/us/creators/article/distributing-your-show-to-other-platforms/',
     TRUE, TRUE, FALSE, FALSE,
     'Alur detail dan nama menu Castbox perlu divalidasi langsung pada UI terbaru.'),

    ('podcastindex', 'Podcast Index', 'https://podcastindex.org/',
     'https://podcastindex.org/',
     'podcastindex', '#F90000', 'API', 'podcastindex', 'https://podcastindex.org/podcast/{id}',
     '1. Cari judul show/RSS di Podcast Index dulu.
2. Jika belum terindeks, ajukan RSS URL via mekanisme resmi.
3. Tunggu indeks diperbarui, cek halaman show.
4. Catat URL/identitas katalog.',
     TRUE, TRUE, 8,
     'https://github.com/Podcastindex-org',
     FALSE, FALSE, TRUE, FALSE,
     'Podcast Index adalah indeks bukan layanan hosting. Mendukung API submission.'),

    ('podchaser', 'Podchaser', 'https://www.podchaser.com/',
     'https://www.podchaser.com/',
     'podchaser', '#7C3AED', 'MANUAL', '', '',
     '1. Cari show di Podchaser terlebih dahulu.
2. Jika sudah ada, cari mekanisme claim/pengelolaan show.
3. Jika belum ada, cari alur add podcast, gunakan RSS publik.
4. Lakukan verifikasi jika diminta.
5. Cek URL listing, simpan sebagai bukti.',
     TRUE, TRUE, 9,
     '',
     FALSE, FALSE, FALSE, FALSE,
     'Formulir dan syarat terkini perlu dicek langsung. Target uji, bukan listing yang dijamin.'),

    ('overcast', 'Overcast', 'https://overcast.fm/',
     'https://overcast.fm/podcasterinfo',
     'overcast', '#FC7E0F', 'MANUAL', '', '',
     '1. Selesaikan submission di Apple Podcasts terlebih dahulu.
2. Cari judul podcast di Overcast.
3. Jika show muncul, simpan URL listing → status LIVE.
4. Jika tidak, periksa petunjuk resmi untuk request indexing.
5. Jangan hitung berhasil hanya karena pakai katalog Apple.',
     TRUE, TRUE, 10,
     'https://overcast.fm/podcasterinfo',
     FALSE, FALSE, FALSE, TRUE,
     'Overcast biasanya mengindeks dari Apple Podcasts. Tidak selalu ada form submit langsung.')
ON CONFLICT (key) DO NOTHING;
