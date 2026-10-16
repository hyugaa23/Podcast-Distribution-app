// Package cache wraps Redis for tenant config, domain resolution, homepage data,
// popular podcasts, categories, feeds and analytics aggregation (PRD §74).
// If Redis is unreachable it degrades to a process-local memory cache.
package cache

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Cache struct {
	rdb *redis.Client
	mem *memStore
}

func New(rdb *redis.Client) *Cache {
	return &Cache{rdb: rdb, mem: &memStore{items: map[string]memItem{}}}
}

func (c *Cache) Redis() *redis.Client { return c.rdb }

func (c *Cache) usable(ctx context.Context) bool { return c.rdb != nil }

// GetJSON loads key into dst. Returns false on miss.
func (c *Cache) GetJSON(ctx context.Context, key string, dst any) bool {
	b, ok := c.GetBytes(ctx, key)
	if !ok {
		return false
	}
	return json.Unmarshal(b, dst) == nil
}

func (c *Cache) GetBytes(ctx context.Context, key string) ([]byte, bool) {
	if c.usable(ctx) {
		b, err := c.rdb.Get(ctx, key).Bytes()
		if err == nil {
			return b, true
		}
		if err == redis.Nil {
			return nil, false
		}
	}
	return c.mem.get(key)
}

func (c *Cache) SetJSON(ctx context.Context, key string, v any, ttl time.Duration) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.SetBytes(ctx, key, b, ttl)
}

func (c *Cache) SetBytes(ctx context.Context, key string, b []byte, ttl time.Duration) {
	if c.usable(ctx) {
		if err := c.rdb.Set(ctx, key, b, ttl).Err(); err == nil {
			return
		}
	}
	c.mem.set(key, b, ttl)
}

func (c *Cache) Del(ctx context.Context, keys ...string) {
	if len(keys) == 0 {
		return
	}
	if c.usable(ctx) {
		c.rdb.Del(ctx, keys...)
	}
	for _, k := range keys {
		c.mem.del(k)
	}
}

// DelPrefix removes every key with the given prefix.
func (c *Cache) DelPrefix(ctx context.Context, prefix string) {
	if c.usable(ctx) {
		iter := c.rdb.Scan(ctx, 0, prefix+"*", 500).Iterator()
		var batch []string
		for iter.Next(ctx) {
			batch = append(batch, iter.Val())
			if len(batch) >= 500 {
				c.rdb.Del(ctx, batch...)
				batch = batch[:0]
			}
		}
		if len(batch) > 0 {
			c.rdb.Del(ctx, batch...)
		}
	}
	c.mem.delPrefix(prefix)
}

// Remember returns the cached value for key or computes, stores and returns it.
func Remember[T any](ctx context.Context, c *Cache, key string, ttl time.Duration, fn func() (T, error)) (T, error) {
	var v T
	if c.GetJSON(ctx, key, &v) {
		return v, nil
	}
	v, err := fn()
	if err != nil {
		return v, err
	}
	c.SetJSON(ctx, key, v, ttl)
	return v, nil
}

// Allow implements a fixed-window rate limiter. Returns false when the limit is exceeded.
func (c *Cache) Allow(ctx context.Context, key string, limit int, window time.Duration) bool {
	k := "rl:" + key + ":" + itoa(time.Now().Unix()/int64(window.Seconds()))
	if c.usable(ctx) {
		pipe := c.rdb.TxPipeline()
		incr := pipe.Incr(ctx, k)
		pipe.Expire(ctx, k, window+time.Second)
		if _, err := pipe.Exec(ctx); err == nil {
			return incr.Val() <= int64(limit)
		}
	}
	return c.mem.incr(k, window) <= int64(limit)
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// ---------------------------------------------------------------------------

type memItem struct {
	val []byte
	exp time.Time
	n   int64
}

type memStore struct {
	mu    sync.Mutex
	items map[string]memItem
}

func (m *memStore) get(k string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, ok := m.items[k]
	if !ok || (!it.exp.IsZero() && time.Now().After(it.exp)) {
		delete(m.items, k)
		return nil, false
	}
	return it.val, true
}

func (m *memStore) set(k string, b []byte, ttl time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.items) > 10000 {
		m.items = map[string]memItem{}
	}
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	m.items[k] = memItem{val: b, exp: exp}
}

func (m *memStore) del(k string) {
	m.mu.Lock()
	delete(m.items, k)
	m.mu.Unlock()
}

func (m *memStore) delPrefix(p string) {
	m.mu.Lock()
	for k := range m.items {
		if strings.HasPrefix(k, p) {
			delete(m.items, k)
		}
	}
	m.mu.Unlock()
}

func (m *memStore) incr(k string, ttl time.Duration) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	it := m.items[k]
	if it.exp.IsZero() || time.Now().After(it.exp) {
		it = memItem{exp: time.Now().Add(ttl)}
	}
	it.n++
	m.items[k] = it
	return it.n
}
