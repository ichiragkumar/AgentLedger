// In-memory exact-match store: stdlib-only stand-in with production Redis
// semantics (single-lookup Check honoring TTL, upsert Store, dimension
// purges). The Redis adapter (WIRING.md) must preserve these behaviors.
package cache

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// MemoryStore is a goroutine-safe TTL map implementing Cache.
// Eviction is lazy (on Check/Size/Keys) plus explicit Sweep; no background
// goroutine, so there is nothing to leak in tests or server shutdown.
type MemoryStore struct {
	mu         sync.RWMutex
	items      map[string]Entry
	defaultTTL time.Duration

	hits    atomic.Int64
	misses  atomic.Int64
	evicted atomic.Int64
}

// NewMemoryStore builds a store; non-positive defaultTTL falls back to DefaultTTL.
func NewMemoryStore(defaultTTL time.Duration) *MemoryStore {
	if defaultTTL <= 0 {
		defaultTTL = DefaultTTL
	}
	return &MemoryStore{items: make(map[string]Entry), defaultTTL: defaultTTL}
}

// Check implements Cache: single map lookup, TTL-honored, <1ms (no I/O).
// Expired entries are removed and count as misses. Hits bump Entry.Hits.
func (s *MemoryStore) Check(key string) (Entry, bool) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.items[key]
	if !ok {
		s.misses.Add(1)
		return Entry{}, false
	}
	if e.IsExpired(now) {
		delete(s.items, key)
		s.evicted.Add(1)
		s.misses.Add(1)
		return Entry{}, false
	}
	e.Hits++
	e.LastHitAt = now
	s.items[key] = e
	s.hits.Add(1)
	return e, true
}

// Store implements Cache: upsert, applying the default TTL when
// e.ExpiresAt is zero. Entries with empty keys are dropped.
func (s *MemoryStore) Store(e Entry) { s.StoreWithTTL(e, 0) }

// StoreWithTTL upserts e; ttl > 0 overrides e.ExpiresAt, ttl <= 0 keeps an
// explicit ExpiresAt or falls back to the store default.
func (s *MemoryStore) StoreWithTTL(e Entry, ttl time.Duration) {
	if e.Key == "" {
		return
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	switch {
	case ttl > 0:
		e.ExpiresAt = e.CreatedAt.Add(ttl)
	case e.ExpiresAt.IsZero():
		e.ExpiresAt = e.CreatedAt.Add(s.defaultTTL)
	}
	s.mu.Lock()
	s.items[e.Key] = e
	s.mu.Unlock()
}

// Delete removes key, reporting whether it existed (and was unexpired).
func (s *MemoryStore) Delete(key string) bool {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.items[key]
	if !ok || e.IsExpired(now) {
		if ok {
			delete(s.items, key)
			s.evicted.Add(1)
		}
		return false
	}
	delete(s.items, key)
	return true
}

// Size counts unexpired entries (no mutation).
func (s *MemoryStore) Size() int {
	now := time.Now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, e := range s.items {
		if !e.IsExpired(now) {
			n++
		}
	}
	return n
}

// Keys lists unexpired keys in sorted order (deletion workflows, tests).
func (s *MemoryStore) Keys() []string {
	now := time.Now()
	s.mu.RLock()
	out := make([]string, 0, len(s.items))
	for k, e := range s.items {
		if !e.IsExpired(now) {
			out = append(out, k)
		}
	}
	s.mu.RUnlock()
	sort.Strings(out)
	return out
}

// Sweep drops expired entries, returning the removal count.
func (s *MemoryStore) Sweep() int {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for k, e := range s.items {
		if e.IsExpired(now) {
			delete(s.items, k)
			n++
		}
	}
	s.evicted.Add(int64(n))
	return n
}

// PurgeByAgent removes unexpired entries tagged with agentID.
func (s *MemoryStore) PurgeByAgent(agentID string) int {
	return s.purge(func(e Entry) bool { return e.AgentID == agentID })
}

// PurgeByTeam removes unexpired entries tagged with teamID.
func (s *MemoryStore) PurgeByTeam(teamID string) int {
	return s.purge(func(e Entry) bool { return e.TeamID == teamID })
}

// PurgeByModel removes unexpired entries for model.
func (s *MemoryStore) PurgeByModel(model string) int {
	return s.purge(func(e Entry) bool { return e.Model == model })
}

// Clear drops everything regardless of expiry.
func (s *MemoryStore) Clear() {
	s.mu.Lock()
	s.items = make(map[string]Entry)
	s.mu.Unlock()
}

func (s *MemoryStore) purge(match func(Entry) bool) int {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for k, e := range s.items {
		if e.IsExpired(now) {
			delete(s.items, k)
			s.evicted.Add(1)
			continue
		}
		if match(e) {
			delete(s.items, k)
			n++
		}
	}
	return n
}

// Counters reports raw lookup counters.
func (s *MemoryStore) Counters() (hits, misses, evicted int64) {
	return s.hits.Load(), s.misses.Load(), s.evicted.Load()
}

// HitRate returns hits / (hits + misses) in [0,1].
func (s *MemoryStore) HitRate() float64 {
	h, m, _ := s.Counters()
	if h+m == 0 {
		return 0
	}
	return float64(h) / float64(h+m)
}
