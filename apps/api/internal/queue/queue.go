// Package queue implements a reliable Redis-backed job queue (PRD §73).
//
// Ready jobs live in a list, delayed/retrying jobs in a sorted set scored by
// run time, and in-flight jobs in a per-worker processing list so they can be
// recovered after a crash.
package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Job types (PRD §73 + supporting jobs).
const (
	ProcessAudio        = "PROCESS_AUDIO"
	ProcessImage        = "PROCESS_IMAGE"
	ImportRSS           = "IMPORT_RSS"
	SyncRSS             = "SYNC_RSS"
	MirrorAudio         = "MIRROR_AUDIO"
	GenerateTranscript  = "GENERATE_TRANSCRIPT"
	RefreshDistribution = "REFRESH_DISTRIBUTION"
	SubmitDistribution  = "SUBMIT_DISTRIBUTION"
	GenerateSitemap     = "GENERATE_SITEMAP"
	PublishScheduled    = "PUBLISH_SCHEDULED"
	AggregateAnalytics  = "AGGREGATE_ANALYTICS"
	InvalidateCache     = "INVALIDATE_CACHE"
	CheckDomain         = "CHECK_DOMAIN"
	RSSHealthCheck      = "RSS_HEALTH_CHECK"
	DeliverWebhook      = "DELIVER_WEBHOOK"
)

const (
	keyReady      = "queue:ready"
	keyDelayed    = "queue:delayed"
	keyProcessing = "queue:processing:"
	keyUnique     = "queue:unique:"
)

type Job struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
	TenantID    int64           `json:"tenant_id,omitempty"`
	UniqueKey   string          `json:"unique_key,omitempty"`
	EnqueuedAt  time.Time       `json:"enqueued_at"`
}

func (j *Job) Decode(dst any) error { return json.Unmarshal(j.Payload, dst) }

type Queue struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Queue { return &Queue{rdb: rdb} }

type Options struct {
	Delay       time.Duration
	MaxAttempts int
	TenantID    int64
	UniqueKey   string        // drop duplicates while an identical job is pending
	UniqueTTL   time.Duration // how long the uniqueness lock is held
}

var ErrDuplicate = errors.New("duplicate job suppressed")

// Enqueue adds a job and returns it.
func (q *Queue) Enqueue(ctx context.Context, typ string, payload any, opt Options) (*Job, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if opt.MaxAttempts <= 0 {
		opt.MaxAttempts = 3
	}
	job := &Job{ID: uuid.NewString(), Type: typ, Payload: raw, MaxAttempts: opt.MaxAttempts,
		TenantID: opt.TenantID, UniqueKey: opt.UniqueKey, EnqueuedAt: time.Now().UTC()}
	if opt.UniqueKey != "" {
		ttl := opt.UniqueTTL
		if ttl <= 0 {
			ttl = 10 * time.Minute
		}
		ok, err := q.rdb.SetNX(ctx, keyUnique+opt.UniqueKey, job.ID, ttl).Result()
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrDuplicate
		}
	}
	return job, q.push(ctx, job, opt.Delay)
}

func (q *Queue) push(ctx context.Context, job *Job, delay time.Duration) error {
	b, _ := json.Marshal(job)
	if delay > 0 {
		return q.rdb.ZAdd(ctx, keyDelayed, redis.Z{Score: float64(time.Now().Add(delay).UnixMilli()), Member: b}).Err()
	}
	return q.rdb.LPush(ctx, keyReady, b).Err()
}

var promoteScript = redis.NewScript(`
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, m in ipairs(due) do
  redis.call('ZREM', KEYS[1], m)
  redis.call('LPUSH', KEYS[2], m)
end
return #due`)

// PromoteDue moves delayed jobs whose run time has passed into the ready list.
func (q *Queue) PromoteDue(ctx context.Context) (int, error) {
	n, err := promoteScript.Run(ctx, q.rdb, []string{keyDelayed, keyReady}, time.Now().UnixMilli()).Int()
	return n, err
}

// Reserve blocks up to timeout for the next job and moves it to the worker's processing list.
func (q *Queue) Reserve(ctx context.Context, workerID string, timeout time.Duration) (*Job, []byte, error) {
	b, err := q.rdb.BRPopLPush(ctx, keyReady, keyProcessing+workerID, timeout).Bytes()
	if err == redis.Nil {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var job Job
	if err := json.Unmarshal(b, &job); err != nil {
		q.rdb.LRem(ctx, keyProcessing+workerID, 1, b)
		return nil, nil, fmt.Errorf("corrupt job dropped: %w", err)
	}
	return &job, b, nil
}

var ackScript = redis.NewScript(`
redis.call('LREM', KEYS[1], 1, ARGV[1])
if KEYS[2] ~= '' then redis.call('DEL', KEYS[2]) end
return 1`)

// Ack removes a finished job from the processing list and releases its uniqueness lock.
func (q *Queue) Ack(ctx context.Context, workerID string, job *Job, raw []byte) {
	uniqueKey := ""
	if job.UniqueKey != "" {
		uniqueKey = keyUnique + job.UniqueKey
	}
	ackScript.Run(ctx, q.rdb, []string{keyProcessing + workerID, uniqueKey}, raw)
}

var retryScript = redis.NewScript(`
redis.call('LREM', KEYS[1], 1, ARGV[1])
if tonumber(ARGV[3]) > 0 then
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[4])
else
  redis.call('LPUSH', KEYS[3], ARGV[4])
end
return 1`)

var retryExhaustedScript = redis.NewScript(`
redis.call('LREM', KEYS[1], 1, ARGV[1])
if KEYS[2] ~= '' then redis.call('DEL', KEYS[2]) end
return 1`)

// Retry re-schedules a failed job with exponential backoff. Returns false if attempts are exhausted.
func (q *Queue) Retry(ctx context.Context, workerID string, job *Job, raw []byte) bool {
	job.Attempts++
	if job.Attempts >= job.MaxAttempts {
		uniqueKey := ""
		if job.UniqueKey != "" {
			uniqueKey = keyUnique + job.UniqueKey
		}
		retryExhaustedScript.Run(ctx, q.rdb, []string{keyProcessing + workerID, uniqueKey}, raw)
		return false
	}
	backoff := time.Duration(1<<job.Attempts) * 15 * time.Second
	newRaw, _ := json.Marshal(job)
	delayMs := int64(backoff / time.Millisecond)
	score := float64(time.Now().Add(backoff).UnixMilli())
	err := retryScript.Run(ctx, q.rdb, []string{keyProcessing + workerID, keyDelayed, keyReady},
		raw, score, delayMs, newRaw).Err()
	if err != nil {
		return false
	}
	return true
}

// Recover requeues jobs left in a worker's processing list (e.g. after a crash).
func (q *Queue) Recover(ctx context.Context, workerID string) (int, error) {
	n := 0
	for {
		b, err := q.rdb.RPopLPush(ctx, keyProcessing+workerID, keyReady).Result()
		if err == redis.Nil {
			return n, nil
		}
		if err != nil {
			return n, err
		}
		_ = b
		n++
	}
}

type Stats struct {
	Ready      int64 `json:"ready"`
	Delayed    int64 `json:"delayed"`
	Processing int64 `json:"processing"`
}

func (q *Queue) Stats(ctx context.Context) (Stats, error) {
	var s Stats
	var err error
	if s.Ready, err = q.rdb.LLen(ctx, keyReady).Result(); err != nil {
		return s, err
	}
	s.Delayed, _ = q.rdb.ZCard(ctx, keyDelayed).Result()
	keys, _ := q.rdb.Keys(ctx, keyProcessing+"*").Result()
	for _, k := range keys {
		n, _ := q.rdb.LLen(ctx, k).Result()
		s.Processing += n
	}
	return s, nil
}
