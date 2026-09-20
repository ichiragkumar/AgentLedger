// Semantic cache layer (spec 05 §2.2): embed the prompt, vector-search prior
// prompts, serve the cached response when cosine similarity >= threshold.
//
// Production path: Embedder = all-MiniLM-L6-v2 sidecar (384-dim), vector
// index = Qdrant collection (see Qdrant HTTP stubs below + WIRING.md).
// This file is stdlib-only: SemanticCache is an in-memory cosine index with
// identical admit/store/purge semantics, and HashEmbedder is a deterministic
// DEV-ONLY embedder (word-hash pooling) for tests and offline work — it is
// NOT a quality substitute for MiniLM and must not be used for precision
// benchmarking (see benchmark plan in specs/05).
package cache

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Embedder converts prompt text to a unit-length vector. Production impls
// call the MiniLM sidecar over HTTP; HashEmbedder is the offline stub.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, error)
	Dim() int
}

// PromptText renders the match surface for the semantic layer: model scope
// plus the full message transcript (role-tagged so "system: X / user: Y"
// never collides with "user: X / system: Y").
func PromptText(model string, messages []Message) string {
	var b strings.Builder
	b.WriteString("model:")
	b.WriteString(model)
	for _, m := range messages {
		b.WriteString("\n[")
		b.WriteString(m.Role)
		b.WriteString("] ")
		b.WriteString(m.Content)
	}
	return b.String()
}

// CosineSimilarity in [-1,1]; 1 = identical direction. Mismatched or empty
// vectors score 0 (never admitted — threshold floor is 0.85).
func CosineSimilarity(a, b []float32) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		x, y := float64(a[i]), float64(b[i])
		dot += x * y
		na += x * x
		nb += y * y
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

type semanticItem struct {
	entry   Entry
	vector  []float32
	expires time.Time
}

// SemanticCache is a goroutine-safe in-memory cosine index with the admit
// semantics the Qdrant collection must implement: best similarity >=
// threshold wins; expired vectors are invisible.
type SemanticCache struct {
	mu        sync.RWMutex
	embedder  Embedder
	threshold float64
	items     map[string]semanticItem // exact-match key → vector + entry

	// Qdrant wiring (used by the HTTP stubs below; not by Check/Store).
	qdrantURL  string
	collection string
	apiKey     string
	httpClient *http.Client
}

// SemanticOption tunes a SemanticCache.
type SemanticOption func(*SemanticCache)

// WithThreshold sets the admit threshold (validated to [0.85, 0.99]).
func WithThreshold(t float64) SemanticOption {
	return func(s *SemanticCache) { s.SetThreshold(t) }
}

// WithQdrant points the HTTP stubs at a Qdrant instance.
func WithQdrant(url, collection, apiKey string, client *http.Client) SemanticOption {
	return func(s *SemanticCache) {
		s.qdrantURL = strings.TrimRight(url, "/")
		if collection != "" {
			s.collection = collection
		}
		s.apiKey = apiKey
		if client != nil {
			s.httpClient = client
		}
	}
}

// NewSemanticCache builds the layer; nil embedder → dev HashEmbedder(384).
// Out-of-range thresholds fall back to DefaultSimilarityThreshold.
func NewSemanticCache(embedder Embedder, opts ...SemanticOption) *SemanticCache {
	if embedder == nil {
		embedder = NewHashEmbedder(HashEmbedderDim)
	}
	s := &SemanticCache{
		embedder:   embedder,
		threshold:  DefaultSimilarityThreshold,
		items:      make(map[string]semanticItem),
		collection: "agentledger_cache",
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// SetThreshold updates the admit threshold; out-of-range values are ignored.
func (s *SemanticCache) SetThreshold(t float64) {
	if t < MinSimilarityThreshold || t > MaxSimilarityThreshold {
		return
	}
	s.mu.Lock()
	s.threshold = t
	s.mu.Unlock()
}

// Threshold returns the current admit threshold.
func (s *SemanticCache) Threshold() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.threshold
}

// Check embeds text and returns the best entry at similarity >= threshold.
// ok=false covers: embed error, empty index, all-expired, best < threshold.
func (s *SemanticCache) Check(ctx context.Context, text string) (Entry, float64, bool) {
	vec, err := s.embedder.Embed(ctx, text)
	if err != nil {
		return Entry{}, 0, false
	}
	return s.CheckVector(vec)
}

// CheckVector matches a precomputed embedding (saves an encode round-trip
// when the caller already embedded for Qdrant remote search).
func (s *SemanticCache) CheckVector(vec []float32) (Entry, float64, bool) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	best := -2.0
	var bestEntry Entry
	found := false
	for _, it := range s.items {
		if !it.expires.IsZero() && !now.Before(it.expires) {
			continue
		}
		if sim := CosineSimilarity(vec, it.vector); sim > best {
			best = sim
			bestEntry = it.entry
			found = true
		}
	}
	if !found || best < s.threshold {
		return Entry{}, best, false
	}
	bestEntry.Semantic = true
	bestEntry.Similarity = best
	bestEntry.Hits++
	bestEntry.LastHitAt = now
	s.items[bestEntry.Key] = semanticItem{entry: bestEntry, vector: s.items[bestEntry.Key].vector, expires: s.items[bestEntry.Key].expires}
	out := bestEntry
	return out, best, true
}

// StoreWithVector upserts key → (entry, vector) with TTL.
func (s *SemanticCache) StoreWithVector(key string, e Entry, vec []float32, ttl time.Duration) {
	if key == "" || len(vec) == 0 {
		return
	}
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	cp := make([]float32, len(vec))
	copy(cp, vec)
	e.Key = key
	e.Semantic = true
	now := time.Now()
	if e.CreatedAt.IsZero() {
		e.CreatedAt = now
	}
	s.mu.Lock()
	s.items[key] = semanticItem{entry: e, vector: cp, expires: now.Add(ttl)}
	s.mu.Unlock()
}

// Store embeds PromptText(model, messages) and upserts; embed errors drop
// the write (exact layer still holds the response).
func (s *SemanticCache) Store(ctx context.Context, model string, messages []Message, e Entry, ttl time.Duration) {
	vec, err := s.embedder.Embed(ctx, PromptText(model, messages))
	if err != nil {
		return
	}
	s.StoreWithVector(e.Key, e, vec, ttl)
}

// Delete removes key.
func (s *SemanticCache) Delete(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.items[key]; !ok {
		return false
	}
	delete(s.items, key)
	return true
}

// Size counts unexpired vectors.
func (s *SemanticCache) Size() int {
	now := time.Now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, it := range s.items {
		if it.expires.IsZero() || now.Before(it.expires) {
			n++
		}
	}
	return n
}

// Sweep drops expired vectors.
func (s *SemanticCache) Sweep() int {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for k, it := range s.items {
		if !it.expires.IsZero() && !now.Before(it.expires) {
			delete(s.items, k)
			n++
		}
	}
	return n
}

// Purge removes unexpired vectors matching f.
func (s *SemanticCache) Purge(match func(Entry) bool) int {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for k, it := range s.items {
		if !it.expires.IsZero() && !now.Before(it.expires) {
			delete(s.items, k)
			continue
		}
		if match(it.entry) {
			delete(s.items, k)
			n++
		}
	}
	return n
}

// --- Dev embedder (NOT for precision benchmarks) ---

// HashEmbedderDim matches all-MiniLM-L6-v2 so vectors are shape-compatible
// with the production collection.
const HashEmbedderDim = 384

// HashEmbedder is a deterministic offline embedder: lowercase alphanumeric
// tokenization, FNV-hashed unigrams + bigrams pooled into dim buckets,
// L2-normalized. Identical texts score exactly 1.0; paraphrases sharing
// vocabulary score high. Quality is far below MiniLM — dev/tests only.
type HashEmbedder struct{ dim int }

// NewHashEmbedder builds the stub; dim <= 0 → HashEmbedderDim.
func NewHashEmbedder(dim int) *HashEmbedder {
	if dim <= 0 {
		dim = HashEmbedderDim
	}
	return &HashEmbedder{dim: dim}
}

// Dim implements Embedder.
func (h *HashEmbedder) Dim() int { return h.dim }

// Embed implements Embedder (never errors; ctx cancellation honored).
func (h *HashEmbedder) Embed(ctx context.Context, text string) ([]float32, error) {
	vec := make([]float32, h.dim)
	toks := tokenize(text)
	prev := 0
	for _, t := range toks {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		i := int(fnv32(t) % uint64(h.dim))
		vec[i] += 1
		// Bigram links word order into the hash so "a b" ≠ "b a".
		j := int((fnv32(t)*31 + uint64(prev)) % uint64(h.dim))
		vec[j] += 0.5
		prev = int(fnv32(t) % 997)
	}
	var norm float64
	for _, v := range vec {
		norm += float64(v) * float64(v)
	}
	norm = math.Sqrt(norm)
	if norm == 0 {
		return vec, nil // zero vector: CosineSimilarity → 0, never admitted.
	}
	for i := range vec {
		vec[i] = float32(float64(vec[i]) / norm)
	}
	return vec, nil
}

func fnv32(s string) uint64 {
	h := fnv.New32a()
	_, _ = io.WriteString(h, s)
	return uint64(h.Sum32())
}

func tokenize(s string) []string {
	lower := strings.ToLower(s)
	fields := strings.FieldsFunc(lower, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
	out := fields[:0]
	for _, f := range fields {
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

// --- Qdrant HTTP stubs (production wiring; stdlib net/http, no client dep) ---

// ErrQdrantNotConfigured is returned when QdrantURL is empty.
var ErrQdrantNotConfigured = errors.New("cache: QDRANT_URL not configured")

// QdrantSearchURL renders the REST search endpoint for the collection.
func (s *SemanticCache) QdrantSearchURL() string {
	return fmt.Sprintf("%s/collections/%s/points/search", s.qdrantURL, s.collection)
}

// QdrantUpsertURL renders the REST upsert endpoint for the collection.
func (s *SemanticCache) QdrantUpsertURL() string {
	return fmt.Sprintf("%s/collections/%s/points?wait=true", s.qdrantURL, s.collection)
}

// qdrantSearchPayload is the REST body for /points/search.
type qdrantSearchPayload struct {
	Vector      []float32 `json:"vector"`
	Limit       uint64    `json:"limit"`
	ScoreThresh float64   `json:"score_threshold,omitempty"`
	WithPayload bool      `json:"with_payload"`
}

// QdrantSearchBody builds the search payload honoring the admit threshold
// (score_threshold = threshold so Qdrant pre-filters server-side).
func (s *SemanticCache) QdrantSearchBody(vec []float32, limit uint64) ([]byte, error) {
	if limit == 0 {
		limit = 3
	}
	s.mu.RLock()
	th := s.threshold
	s.mu.RUnlock()
	return json.Marshal(qdrantSearchPayload{Vector: vec, Limit: limit, ScoreThresh: th, WithPayload: true})
}

// qdrantPoint is the REST upsert shape: deterministic point id = first 16
// bytes of the exact-match SHA-256 key (uuid-compatible hex), payload joins
// the vector back to the exact entry + purge dimensions.
type qdrantPoint struct {
	ID      string         `json:"id"`
	Vector  []float32      `json:"vector"`
	Payload map[string]any `json:"payload"`
}

// QdrantUpsertBody builds the upsert payload joining vector → exact key.
func (s *SemanticCache) QdrantUpsertBody(key string, e Entry, vec []float32) ([]byte, error) {
	if key == "" || len(vec) == 0 {
		return nil, errors.New("cache: qdrant upsert needs key and vector")
	}
	var idBytes [16]byte
	raw := decodeHexKey(key)
	copy(idBytes[:], raw)
	var idStr string
	if len(raw) >= 16 {
		idStr = fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
			binary.BigEndian.Uint32(idBytes[0:4]), binary.BigEndian.Uint16(idBytes[4:6]),
			binary.BigEndian.Uint16(idBytes[6:8]), binary.BigEndian.Uint16(idBytes[8:10]),
			idBytes[10:16])
	} else {
		idStr = key // non-hex keys (tests): use raw string id.
	}
	body, err := json.Marshal(map[string]any{"points": []qdrantPoint{{
		ID: idStr, Vector: vec,
		Payload: map[string]any{
			"cache_key": key, "model": e.Model,
			"agent_id": e.AgentID, "team_id": e.TeamID,
		},
	}}})
	if err != nil {
		return nil, err
	}
	return body, nil
}

func decodeHexKey(key string) []byte {
	if len(key) != 64 {
		return nil
	}
	var out [32]byte
	n := 0
	for i := 0; i < 64; i += 2 {
		hi := hexVal(key[i])
		lo := hexVal(key[i+1])
		if hi > 15 || lo > 15 {
			return nil
		}
		out[n] = hi<<4 | lo
		n++
	}
	return out[:n]
}

func hexVal(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	}
	return 255
}

// RemoteHit is one Qdrant search hit joining back to an exact entry.
type RemoteHit struct {
	Key   string  `json:"key"`
	Score float64 `json:"score"`
}

// SearchRemote queries Qdrant and returns hits above threshold, best first.
// Empty QdrantURL → ErrQdrantNotConfigured. Responses parse the minimal
// subset {result:[{score,payload:{cache_key}}]}; payload-less points are
// skipped. Callers then Check(key) the exact (Redis) store — Qdrant never
// holds response bodies, only vectors + join keys.
func (s *SemanticCache) SearchRemote(ctx context.Context, vec []float32) ([]RemoteHit, error) {
	if strings.TrimSpace(s.qdrantURL) == "" {
		return nil, ErrQdrantNotConfigured
	}
	body, err := s.QdrantSearchBody(vec, 3)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.QdrantSearchURL(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.apiKey != "" {
		req.Header.Set("api-key", s.apiKey)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("cache: qdrant search status %d", resp.StatusCode)
	}
	var parsed struct {
		Result []struct {
			Score   float64 `json:"score"`
			Payload struct {
				CacheKey string `json:"cache_key"`
			} `json:"payload"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	s.mu.RLock()
	th := s.threshold
	s.mu.RUnlock()
	var hits []RemoteHit
	for _, r := range parsed.Result {
		if r.Payload.CacheKey == "" || r.Score < th {
			continue
		}
		hits = append(hits, RemoteHit{Key: r.Payload.CacheKey, Score: r.Score})
	}
	return hits, nil
}
