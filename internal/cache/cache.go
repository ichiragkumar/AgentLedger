// Package cache implements Phase 2 "Saver" (spec 05): dual-layer LLM
// response caching for the AgentLedger Go proxy.
//
// Layers:
//
//	exact    — SHA-256(model + messages + temperature) → response bytes.
//	           <1ms lookup, 100% precision. Backed by Redis in production
//	           (see WIRING.md); MemoryStore here is the stdlib stand-in
//	           with identical semantics (TTL, lazy expiry, purge).
//	semantic — embed(prompt) → vector search → cached response when
//	           cosine similarity >= threshold (0.85–0.99, default 0.92).
//	           <25ms lookup, >90% precision. Backed by Qdrant in
//	           production; SemanticCache here is the stdlib stand-in plus
//	           the Qdrant HTTP plumbing stubs.
//
// The proxy contract (internal/proxy/middleware.go, CacheStub) is:
//
//	on HIT  → "X-AgentLedger-Cache: HIT" and skip upstream.
//	on MISS → "X-AgentLedger-Cache: MISS" and forward upstream.
//
// This package only ADDS headers (layer, key, reason, saved-usd); it never
// removes or renames Mirror headers, so wiring it in is non-breaking.
// Do NOT import internal/proxy from here (keeps the package standalone and
// avoids an import cycle); header names are duplicated as literals and
// documented where they mirror proxy constants.
package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"sync/atomic"
	"time"
)

// Proxy-contract headers and values. ValueHit/ValueMiss match exactly what
// Mirror's CacheStub emits today, so dashboards keep working after wiring.
const (
	// BypassHeader forces a provider round-trip when truthy.
	// Spec 05 §2.4: X-AgentLedger-No-Cache: true always hits provider.
	BypassHeader = "X-AgentLedger-No-Cache"

	// CacheHeader reports HIT or MISS for every request through the hook.
	CacheHeader = "X-AgentLedger-Cache"
	// CacheLayerHeader reports which layer served the hit.
	CacheLayerHeader = "X-AgentLedger-Cache-Layer"
	// CacheKeyHeader echoes the exact-match key (miss or hit) for
	// DELETE /v1/cache/{key} invalidation workflows.
	CacheKeyHeader = "X-AgentLedger-Cache-Key"
	// CacheReasonHeader explains a MISS (bypass-header, guard:<why>,
	// body-too-large, unparsable) or carries hit similarity.
	CacheReasonHeader = "X-AgentLedger-Cache-Reason"
	// SavedUSDHeader reports the cost avoided by a hit (pricing hook).
	SavedUSDHeader = "X-AgentLedger-Saved-Usd"
	// SimilarityHeader reports the cosine similarity of a semantic hit.
	SimilarityHeader = "X-AgentLedger-Cache-Similarity"
	// CacheTokensHeader reports the served entry's "prompt/completion"
	// token counts so the audit trail can log HITs without the entry.
	CacheTokensHeader = "X-AgentLedger-Cache-Tokens"

	// ValueHit / ValueMiss are the only CacheHeader values on the wire.
	ValueHit  = "HIT"
	ValueMiss = "MISS"

	// LayerExact / LayerSemantic are the CacheLayerHeader values.
	LayerExact    = "exact"
	LayerSemantic = "semantic"
)

// Similarity threshold bounds (spec 05 §2.4: 0.85–0.99, default 0.92).
const (
	MinSimilarityThreshold     = 0.85
	MaxSimilarityThreshold     = 0.99
	DefaultSimilarityThreshold = 0.92
)

// Message is the minimal chat message used for keying. It mirrors
// models.Message without importing pkg/models (standalone package).
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// KeyFor returns the exact-match cache key: hex(SHA-256) over the canonical
// encoding of model + messages + temperature (spec 05 §2.1).
//
// Canonical form: model \x00 temperature \x00 (role \x00 content)*.
// A nil temperature encodes as "null" so "unset" and "0" never collide.
// Precision is 100% by construction: equal keys ⇒ byte-identical inputs.
func KeyFor(model string, messages []Message, temperature *float64) string {
	h := sha256.New()
	h.Write([]byte(model))
	h.Write([]byte{0})
	if temperature == nil {
		h.Write([]byte("null"))
	} else {
		h.Write([]byte(strconv.FormatFloat(*temperature, 'g', -1, 64)))
	}
	for _, m := range messages {
		h.Write([]byte{0})
		h.Write([]byte(m.Role))
		h.Write([]byte{0})
		h.Write([]byte(m.Content))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Entry is one cached LLM response: the raw upstream wire bytes plus the
// metadata needed for TTL, purge-by-dimension, replay, and savings stats.
//
// ResponseBody is stored VERBATIM (raw JSON for unary, raw SSE bytes for
// streams) so replay is byte-compatible with the live response.
type Entry struct {
	Key         string
	Model       string
	AgentID     string
	TeamID      string
	ProjectID   string
	StatusCode  int
	ContentType string
	// Stream records the wire shape at store time (SSE vs JSON).
	Stream bool
	// ResponseBody is the exact upstream bytes to replay on a hit.
	ResponseBody []byte
	// Token/cost accounting for savings stats (best-effort; 0 when unknown).
	PromptTokens     int
	CompletionTokens int
	CostUSD          float64
	// Semantic marks entries served/stored via the vector layer and the
	// similarity that admitted them.
	Semantic   bool
	Similarity float64

	CreatedAt time.Time
	ExpiresAt time.Time
	Hits      int64
	LastHitAt time.Time
}

// IsExpired reports whether e is stale at now. Zero ExpiresAt never expires
// (callers normally always set it via Config TTLs).
func (e Entry) IsExpired(now time.Time) bool {
	if e.ExpiresAt.IsZero() {
		return false
	}
	return !now.Before(e.ExpiresAt)
}

// Expired reports against the current time.
func (e Entry) Expired() bool { return e.IsExpired(time.Now()) }

// Cache is the exact-match layer contract (spec 05 §2.1/2.3).
// MemoryStore implements it; the production Redis adapter (see WIRING.md,
// REQUIRED deps: redis client) must implement it with identical semantics:
// Check is a single lookup honoring TTL (<1ms p99), Store is upsert.
type Cache interface {
	// Check returns the entry for key, or ok=false on miss/expiry.
	// Implementations record hit/miss counters internally.
	Check(key string) (e Entry, ok bool)
	// Store upserts e, applying the store default TTL when
	// e.ExpiresAt is zero.
	Store(e Entry)
}

// EstimateSavedUSD converts avoided provider calls into dollars for the
// dashboard ("$X saved this week"). avgCostUSD should be the mean per-request
// cost from the Postgres request log; the dashboard refines this per model.
func EstimateSavedUSD(hits int64, avgCostUSD float64) float64 {
	if hits <= 0 || avgCostUSD <= 0 {
		return 0
	}
	return float64(hits) * avgCostUSD
}

// StatsSnapshot is a point-in-time copy for /metrics and the dashboard.
type StatsSnapshot struct {
	ExactHits    int64   `json:"exact_hits"`
	SemanticHits int64   `json:"semantic_hits"`
	Misses       int64   `json:"misses"`
	Stored       int64   `json:"stored"`
	SavedUSD     float64 `json:"saved_usd"`
	HitRate      float64 `json:"hit_rate"`
	Total        int64   `json:"total"`
}

// Stats is the hook-level analytics accumulator feeding the dashboard cache
// panel (hit %, $ saved). All methods are safe for concurrent use.
type Stats struct {
	exactHits    atomic.Int64
	semanticHits atomic.Int64
	misses       atomic.Int64
	stored       atomic.Int64
	savedBits    atomic.Uint64 // math.Float64bits(SavedUSD)
}

func addFloat(dst *atomic.Uint64, delta float64) {
	for {
		old := dst.Load()
		next := math.Float64bits(math.Float64frombits(old) + delta)
		if dst.CompareAndSwap(old, next) {
			return
		}
	}
}

// RecordExactHit records an exact-layer hit saving costUSD.
func (s *Stats) RecordExactHit(costUSD float64) {
	s.exactHits.Add(1)
	if costUSD > 0 {
		addFloat(&s.savedBits, costUSD)
	}
}

// RecordSemanticHit records a semantic-layer hit saving costUSD.
func (s *Stats) RecordSemanticHit(costUSD float64) {
	s.semanticHits.Add(1)
	if costUSD > 0 {
		addFloat(&s.savedBits, costUSD)
	}
}

// RecordMiss records a full miss (provider round-trip).
func (s *Stats) RecordMiss() { s.misses.Add(1) }

// RecordStore records a newly cached response.
func (s *Stats) RecordStore() { s.stored.Add(1) }

// Snapshot copies current counters.
func (s *Stats) Snapshot() StatsSnapshot {
	ex, sm, mi, st := s.exactHits.Load(), s.semanticHits.Load(), s.misses.Load(), s.stored.Load()
	total := ex + sm + mi
	rate := 0.0
	if total > 0 {
		rate = float64(ex+sm) / float64(total)
	}
	return StatsSnapshot{
		ExactHits: ex, SemanticHits: sm, Misses: mi, Stored: st,
		SavedUSD: math.Float64frombits(s.savedBits.Load()),
		HitRate:  rate, Total: total,
	}
}

// HitRate returns hits / (hits + misses) in [0,1].
func (s *Stats) HitRate() float64 { return s.Snapshot().HitRate }

// Reset zeroes all counters (tests / weekly rollover).
func (s *Stats) Reset() {
	s.exactHits.Store(0)
	s.semanticHits.Store(0)
	s.misses.Store(0)
	s.stored.Store(0)
	s.savedBits.Store(0)
}
