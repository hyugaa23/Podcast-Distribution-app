// Package storage abstracts S3-compatible object storage (PRD §15).
// Drivers: "s3" (Cloudflare R2, AWS S3, Backblaze B2, MinIO) and "local" for development.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrNotFound = errors.New("object not found")

type Info struct {
	Size        int64
	ContentType string
}

type Storage interface {
	Driver() string
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Stat(ctx context.Context, key string) (Info, error)
	Delete(ctx context.Context, key string) error
	// URL returns the public (CDN) URL for key.
	URL(key string) string
	// PresignPut returns a signed direct-upload URL. Empty URL means the driver
	// does not support direct upload and the API upload endpoint must be used.
	PresignPut(ctx context.Context, key, contentType string, expiry time.Duration) (string, error)
}

// Key builders implementing the PRD storage structure.
func AudioKey(podcastID, episodeID int64, name string) string {
	return fmt.Sprintf("audio/%d/%d/%s", podcastID, episodeID, name)
}
func TenantImageKey(tenantID int64, name string) string {
	return fmt.Sprintf("images/%d/%s", tenantID, name)
}
func PodcastKey(podcastID int64, name string) string {
	return fmt.Sprintf("podcasts/%d/%s", podcastID, name)
}
func EpisodeKey(episodeID int64, name string) string {
	return fmt.Sprintf("episodes/%d/%s", episodeID, name)
}

// CleanKey rejects path traversal and normalizes separators.
func CleanKey(key string) (string, error) {
	k := path.Clean("/" + strings.ReplaceAll(key, `\`, "/"))
	k = strings.TrimPrefix(k, "/")
	if k == "" || k == "." || strings.Contains(k, "..") {
		return "", fmt.Errorf("invalid storage key %q", key)
	}
	return k, nil
}

type Config struct {
	Driver    string
	LocalDir  string
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
	Region    string
	UseSSL    bool
	PathStyle bool
	CDNURL    string
}

func New(ctx context.Context, c Config) (Storage, error) {
	switch c.Driver {
	case "s3":
		return newS3(ctx, c)
	case "local", "":
		if err := os.MkdirAll(c.LocalDir, 0o755); err != nil {
			return nil, err
		}
		abs, _ := filepath.Abs(c.LocalDir)
		return &Local{Dir: abs, CDN: c.CDNURL}, nil
	default:
		return nil, fmt.Errorf("unknown STORAGE_DRIVER %q", c.Driver)
	}
}

// ---------------------------------------------------------------------------
// Local filesystem driver (development / single node).

type Local struct {
	Dir string
	CDN string
}

func (l *Local) Driver() string { return "local" }

func (l *Local) path(key string) (string, error) {
	k, err := CleanKey(key)
	if err != nil {
		return "", err
	}
	return filepath.Join(l.Dir, filepath.FromSlash(k)), nil
}

func (l *Local) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (l *Local) Get(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := l.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if os.IsNotExist(err) {
		return nil, ErrNotFound
	}
	return f, err
}

func (l *Local) Stat(_ context.Context, key string) (Info, error) {
	p, err := l.path(key)
	if err != nil {
		return Info{}, err
	}
	st, err := os.Stat(p)
	if os.IsNotExist(err) {
		return Info{}, ErrNotFound
	}
	if err != nil {
		return Info{}, err
	}
	return Info{Size: st.Size()}, nil
}

func (l *Local) Delete(_ context.Context, key string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (l *Local) URL(key string) string { return l.CDN + "/" + escapeKey(key) }

func (l *Local) PresignPut(context.Context, string, string, time.Duration) (string, error) {
	return "", nil
}

// ---------------------------------------------------------------------------
// S3-compatible driver.

type S3 struct {
	client *minio.Client
	bucket string
	cdn    string
}

func newS3(ctx context.Context, c Config) (*S3, error) {
	endpoint := c.Endpoint
	useSSL := c.UseSSL
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		endpoint = u.Host
		useSSL = u.Scheme == "https"
	}
	lookup := minio.BucketLookupAuto
	if c.PathStyle {
		lookup = minio.BucketLookupPath
	}
	cl, err := minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(c.AccessKey, c.SecretKey, ""),
		Secure:       useSSL,
		Region:       c.Region,
		BucketLookup: lookup,
	})
	if err != nil {
		return nil, err
	}
	exists, err := cl.BucketExists(ctx, c.Bucket)
	if err == nil && !exists {
		if err := cl.MakeBucket(ctx, c.Bucket, minio.MakeBucketOptions{Region: c.Region}); err != nil {
			return nil, fmt.Errorf("create bucket: %w", err)
		}
		// Public read for published media prefixes so the CDN can serve audio/images directly.
		policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%[1]s/audio/*","arn:aws:s3:::%[1]s/images/*","arn:aws:s3:::%[1]s/podcasts/*","arn:aws:s3:::%[1]s/episodes/*"]}]}`, c.Bucket)
		_ = cl.SetBucketPolicy(ctx, c.Bucket, policy)
	}
	return &S3{client: cl, bucket: c.Bucket, cdn: c.CDNURL}, nil
}

func (s *S3) Driver() string { return "s3" }

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	k, err := CleanKey(key)
	if err != nil {
		return err
	}
	_, err = s.client.PutObject(ctx, s.bucket, k, r, size, minio.PutObjectOptions{
		ContentType:  contentType,
		CacheControl: "public, max-age=31536000, immutable",
	})
	return err
}

func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return obj, nil
}

func (s *S3) Stat(ctx context.Context, key string) (Info, error) {
	st, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return Info{}, ErrNotFound
		}
		return Info{}, err
	}
	return Info{Size: st.Size, ContentType: st.ContentType}, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func (s *S3) URL(key string) string { return s.cdn + "/" + escapeKey(key) }

func (s *S3) PresignPut(ctx context.Context, key, _ string, expiry time.Duration) (string, error) {
	u, err := s.client.PresignedPutObject(ctx, s.bucket, key, expiry)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}
