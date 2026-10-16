// Package config loads runtime configuration from environment variables.
// Secrets are never stored in the repository (PRD §100).
package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env  string
	Port string

	DatabaseURL string
	RedisURL    string

	StorageDriver   string // "local" or "s3"
	StorageLocalDir string
	S3Endpoint      string
	S3Bucket        string
	S3AccessKey     string
	S3SecretKey     string
	S3Region        string
	S3UseSSL        bool
	S3PathStyle     bool
	CDNURL          string // public base URL for media (audio/images)

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	CookieSecure    bool

	AppURL           string // admin app URL
	APIPublicURL     string // public base URL of this API (signed local uploads)
	WebInternalURL   string // Next.js web app internal URL (cache revalidation)
	PublicSiteScheme string // scheme of public tenant site URLs (https; http only without TLS)
	PublicSitePort   string // public port of tenant sites when not 80/443, e.g. "8090"
	RevalidateSecret string
	CORSOrigins      []string

	FFmpegPath  string
	FFprobePath string

	MaxAudioUploadMB int64
	MaxImageUploadMB int64

	AllowPrivateFetch       bool
	DevAutoVerifyLocalHosts bool
	PlatformCNAMETarget     string
	PlatformIPs             []string

	PodcastIndexKey    string
	PodcastIndexSecret string

	TranscriptionURL   string
	TranscriptionKey   string
	TranscriptionModel string

	SeedAdminEmail    string
	SeedAdminPassword string

	WorkerConcurrency int
	LogLevel          string
}

// Load reads configuration from the environment (and an optional .env file).
func Load() *Config {
	loadDotEnv(".env")
	loadDotEnv("../../.env")

	c := &Config{
		Env:  get("APP_ENV", "development"),
		Port: get("PORT", "8080"),

		DatabaseURL: get("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/podcast?sslmode=disable"),
		RedisURL:    get("REDIS_URL", "redis://localhost:6379/0"),

		StorageDriver:   get("STORAGE_DRIVER", "local"),
		StorageLocalDir: get("STORAGE_LOCAL_DIR", "./data/storage"),
		S3Endpoint:      get("S3_ENDPOINT", ""),
		S3Bucket:        get("S3_BUCKET", "podcast"),
		S3AccessKey:     get("S3_ACCESS_KEY", ""),
		S3SecretKey:     get("S3_SECRET_KEY", ""),
		S3Region:        get("S3_REGION", "auto"),
		S3UseSSL:        getBool("S3_USE_SSL", true),
		S3PathStyle:     getBool("S3_PATH_STYLE", true),
		CDNURL:          strings.TrimRight(get("CDN_URL", "http://localhost:8080/media"), "/"),

		JWTSecret:       get("JWT_SECRET", ""),
		AccessTokenTTL:  getDuration("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL: getDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		CookieSecure:    getBool("COOKIE_SECURE", false),

		AppURL:           strings.TrimRight(get("APP_URL", "http://localhost:3001"), "/"),
		APIPublicURL:     strings.TrimRight(get("API_PUBLIC_URL", "http://localhost:8080"), "/"),
		WebInternalURL:   strings.TrimRight(get("WEB_INTERNAL_URL", "http://localhost:3000"), "/"),
		PublicSiteScheme: get("PUBLIC_SITE_SCHEME", "https"),
		PublicSitePort:   strings.TrimPrefix(get("PUBLIC_SITE_PORT", ""), ":"),
		RevalidateSecret: get("REVALIDATE_SECRET", ""),
		CORSOrigins:      splitList(get("CORS_ORIGINS", "http://localhost:3001")),

		FFmpegPath:  get("FFMPEG_PATH", "ffmpeg"),
		FFprobePath: get("FFPROBE_PATH", "ffprobe"),

		MaxAudioUploadMB: int64(getInt("MAX_AUDIO_UPLOAD_MB", 500)),
		MaxImageUploadMB: int64(getInt("MAX_IMAGE_UPLOAD_MB", 10)),

		AllowPrivateFetch:       getBool("ALLOW_PRIVATE_FETCH", false),
		DevAutoVerifyLocalHosts: getBool("DEV_AUTO_VERIFY_LOCAL_DOMAINS", true),
		PlatformCNAMETarget:     get("PLATFORM_CNAME_TARGET", ""),
		PlatformIPs:             splitList(get("PLATFORM_IPS", "")),

		PodcastIndexKey:    get("PODCASTINDEX_API_KEY", ""),
		PodcastIndexSecret: get("PODCASTINDEX_API_SECRET", ""),

		TranscriptionURL:   get("TRANSCRIPTION_API_URL", ""),
		TranscriptionKey:   get("TRANSCRIPTION_API_KEY", ""),
		TranscriptionModel: get("TRANSCRIPTION_MODEL", "whisper-1"),

		SeedAdminEmail:    get("SEED_ADMIN_EMAIL", "admin@example.com"),
		SeedAdminPassword: get("SEED_ADMIN_PASSWORD", ""),

		WorkerConcurrency: getInt("WORKER_CONCURRENCY", 4),
		LogLevel:          get("LOG_LEVEL", "info"),
	}
	if c.JWTSecret == "" {
		if c.Env == "production" {
			panic("JWT_SECRET must be set in production")
		}
		c.JWTSecret = "dev-only-insecure-secret-change-me"
	}
	if c.RevalidateSecret == "" {
		c.RevalidateSecret = c.JWTSecret + ":revalidate"
	}
	return c
}

func (c *Config) IsProduction() bool { return c.Env == "production" }

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getInt(key string, def int) int {
	if v, err := strconv.Atoi(get(key, "")); err == nil {
		return v
	}
	return def
}

func getBool(key string, def bool) bool {
	if v, err := strconv.ParseBool(get(key, "")); err == nil {
		return v
	}
	return def
}

func getDuration(key string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(get(key, "")); err == nil {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// loadDotEnv sets variables from a KEY=VALUE file without overriding the real environment.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if _, exists := os.LookupEnv(k); !exists {
			os.Setenv(k, v)
		}
	}
}
