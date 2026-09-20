// Proxy hook: the dual-layer pipeline (spec 05 §2.3) as a drop-in
// http.Handler middleware for Mirror's chain:
//
//	exact → semantic → provider
//
// Mirror (the sibling owner of internal/proxy/middleware.go + server.go)
// wires it WITHOUT editing this package — see WIRING.md for the exact
// 5-line patch (CacheStub → Hook.Middleware). Until then CacheHook(next)
// (default in-memory hook) is available for local runs and tests.
//
// Non-breaking guarantees:
//   - Only ADDS response headers (CacheHeader HIT/MISS values match the
//     CacheStub contract; layer/key/reason/saved-usd headers are additive).
//   - Never consumes the request body without restoring it.
//   - Miss path is a transparent write-through: status, headers, and bytes
//     reach the client untouched; a store failure never fails a request.
//   - Bypass header and guard-skipped requests skip BOTH lookup and store.
package cache

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// CostFunc computes avoided cost for savings stats; *pricing.Registry
// (Cost method) adapts directly. Nil CostFunc ⇒ cost tracked as 0.
type CostFunc func(model string, promptTokens, completionTokens int) (float64, bool)

// Hook is the stateful cache middleware. Zero value is NOT usable —
// construct via NewHook.
type Hook struct {
	Exact    *MemoryStore
	Semantic *SemanticCache
	Config   Config
	Guard    GuardConfig
	Stats    *Stats
	Cost     CostFunc
}

// NewHook builds a Hook; cfg is sanitized into valid ranges (threshold
// clamped to [0.85,0.99], TTLs defaulted). Nil embedder → dev HashEmbedder.
func NewHook(cfg Config, embedder Embedder) *Hook {
	cfg = cfg.sanitize()
	if embedder == nil {
		embedder = NewHashEmbedder(HashEmbedderDim)
	}
	return &Hook{
		Exact:    NewMemoryStore(cfg.DefaultTTL),
		Semantic: NewSemanticCache(embedder, WithThreshold(cfg.SimilarityThreshold), WithQdrant(cfg.QdrantURL, cfg.QdrantCollection, cfg.QdrantAPIKey, nil)),
		Config:   cfg,
		Guard:    GuardConfig{Enabled: cfg.GuardEnabled},
		Stats:    &Stats{},
	}
}

// DefaultHook is the package-level hook behind CacheHook (local runs).
// Production servers should NewHook(FromEnv(), nil) and use h.Middleware.
var DefaultHook = NewHook(DefaultConfig(), nil)

// CacheHook wraps next with the default hook. Signature matches
// proxy.Middleware (func(http.Handler) http.Handler) so it slots directly
// into proxy.Chain in place of CacheStub.
func CacheHook(next http.Handler) http.Handler { return DefaultHook.Middleware(next) }

// Middleware adapts the hook to proxy.Middleware shape.
func (h *Hook) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Serve(w, r, next)
	})
}

// parsedRequest is the minimal subset the hook inspects. The raw body is
// always forwarded verbatim — unknown fields never affect routing.
type parsedRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature *float64  `json:"temperature"`
	Stream      bool      `json:"stream"`
}

// Serve runs the dual-layer pipeline around next.
func (h *Hook) Serve(w http.ResponseWriter, r *http.Request, next http.Handler) {
	if h == nil || !h.Config.Enabled || r.Method != http.MethodPost {
		next.ServeHTTP(w, r)
		return
	}
	if BypassRequested(r.Header) {
		w.Header().Set(CacheHeader, ValueMiss)
		w.Header().Set(CacheReasonHeader, "bypass-header")
		next.ServeHTTP(w, r)
		return
	}
	maxBody := h.Config.MaxBodyBytes
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		// Unreadable mid-stream: chain what we got back onto the remainder
		// so upstream still sees the full body, and pass through uncached.
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), r.Body))
		missReason(w, "unreadable-body", "")
		next.ServeHTTP(w, r)
		return
	}
	if int64(len(body)) > maxBody {
		// Too large to inspect: chain the prefix back onto the unread
		// remainder (body stays intact) and pass through uncached.
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), r.Body))
		missReason(w, "body-too-large", "")
		next.ServeHTTP(w, r)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	var req parsedRequest
	if err := json.Unmarshal(body, &req); err != nil || strings.TrimSpace(req.Model) == "" {
		missReason(w, "unparsable-body", "")
		next.ServeHTTP(w, r)
		return
	}
	agentID := r.Header.Get(HeaderAgentID)
	teamID := r.Header.Get(HeaderTeamID)
	key := KeyFor(req.Model, req.Messages, req.Temperature)
	text := PromptText(req.Model, req.Messages)

	if h.Guard.Enabled {
		if skip, reason := h.Guard.ShouldSkip(text); skip {
			missReason(w, "guard:"+reason, key)
			next.ServeHTTP(w, r)
			return
		}
	}

	// Layer 1: exact (<1ms, 100% precision).
	if e, ok := h.Exact.Check(key); ok {
		h.Stats.RecordExactHit(e.CostUSD)
		serveEntry(w, e, LayerExact, key, 0)
		return
	}
	// Layer 2: semantic (<25ms p99 vs Qdrant; in-memory here).
	if h.Semantic != nil {
		if e, sim, ok := h.Semantic.Check(r.Context(), text); ok {
			h.Stats.RecordSemanticHit(e.CostUSD)
			serveEntry(w, e, LayerSemantic, key, sim)
			return
		}
	}

	// Layer 3: provider — transparent write-through capture.
	h.Stats.RecordMiss()
	w.Header().Set(CacheHeader, ValueMiss)
	w.Header().Set(CacheKeyHeader, key)
	cw := &captureWriter{ResponseWriter: w, status: http.StatusOK}
	next.ServeHTTP(cw, r)
	h.storeAfterMiss(r.Context(), req, key, agentID, teamID, cw)
}

func missReason(w http.ResponseWriter, reason, key string) {
	w.Header().Set(CacheHeader, ValueMiss)
	w.Header().Set(CacheReasonHeader, reason)
	if key != "" {
		w.Header().Set(CacheKeyHeader, key)
	}
}

// serveEntry replays a cached response byte-compatibly: raw stored bytes go
// back out verbatim under the stored status + content type, so a replayed
// SSE stream is framing-identical to the live one. sim > 0 adds the
// similarity header for semantic hits.
func serveEntry(w http.ResponseWriter, e Entry, layer, key string, sim float64) {
	hdr := w.Header()
	hdr.Set(CacheHeader, ValueHit)
	hdr.Set(CacheLayerHeader, layer)
	hdr.Set(CacheKeyHeader, keyOf(e, key))
	if layer == LayerSemantic && sim > 0 {
		hdr.Set(SimilarityHeader, strconv.FormatFloat(sim, 'f', 4, 64))
		hdr.Set(CacheReasonHeader, fmt.Sprintf("similarity=%.4f", sim))
	}
	if e.CostUSD > 0 {
		hdr.Set(SavedUSDHeader, strconv.FormatFloat(e.CostUSD, 'f', 8, 64))
	}
	// Token counts the HIT served (the audit trail reads these: cache HITs
	// skip the upstream handler, so without this header their usage would
	// be invisible to cost attribution).
	hdr.Set(CacheTokensHeader, strconv.Itoa(e.PromptTokens)+"/"+strconv.Itoa(e.CompletionTokens))
	ct := e.ContentType
	if ct == "" {
		ct = "application/json"
	}
	hdr.Set("Content-Type", ct)
	status := e.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = w.Write(e.ResponseBody)
}

func keyOf(e Entry, fallback string) string {
	if e.Key != "" {
		return e.Key
	}
	return fallback
}

// storeAfterMiss persists a successful provider response to both layers.
// Best-effort by design: it never mutates the already-sent response.
func (h *Hook) storeAfterMiss(ctx context.Context, req parsedRequest, key, agentID, teamID string, cw *captureWriter) {
	if cw.status != http.StatusOK || len(cw.buf.Bytes()) == 0 {
		return
	}
	ct := cw.contentType
	if ct == "" {
		ct = "application/json"
	}
	raw := append([]byte(nil), cw.buf.Bytes()...)
	usage := parseUsage(raw)
	var cost float64
	if h.Cost != nil {
		if c, ok := h.Cost(req.Model, usage.prompt, usage.completion); ok {
			cost = c
		}
	}
	e := Entry{
		Key: key, Model: req.Model, AgentID: agentID, TeamID: teamID,
		ProjectID: "", StatusCode: cw.status, ContentType: ct,
		Stream:           isSSEContentType(ct),
		ResponseBody:     raw,
		PromptTokens:     usage.prompt,
		CompletionTokens: usage.completion,
		CostUSD:          cost,
		CreatedAt:        time.Now(),
		ExpiresAt:        time.Now().Add(h.Config.TTLFor(req.Model, agentID)),
	}
	h.Exact.Store(e)
	if h.Semantic != nil {
		h.Semantic.Store(ctx, req.Model, req.Messages, e, h.Config.TTLFor(req.Model, agentID))
	}
	h.Stats.RecordStore()
}

func isSSEContentType(ct string) bool {
	return strings.Contains(strings.ToLower(ct), "text/event-stream")
}

type tokenUsage struct{ prompt, completion int }

// parseUsage extracts usage from a unary JSON body (best-effort; SSE bodies
// carry per-chunk usage — the terminal chunk — parsed line-wise).
func parseUsage(raw []byte) tokenUsage {
	var u tokenUsage
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return u
	}
	if bytes.HasPrefix(trimmed, []byte("data:")) || bytes.Contains(trimmed, []byte("\ndata:")) {
		for _, line := range strings.Split(string(trimmed), "\n") {
			t := strings.TrimSpace(line)
			if !strings.HasPrefix(t, "data:") {
				continue
			}
			payload := strings.TrimSpace(strings.TrimPrefix(t, "data:"))
			if payload == "" || payload == "[DONE]" {
				continue
			}
			var chunk struct {
				Usage *struct {
					PromptTokens     int `json:"prompt_tokens"`
					CompletionTokens int `json:"completion_tokens"`
				} `json:"usage"`
			}
			if err := json.Unmarshal([]byte(payload), &chunk); err == nil && chunk.Usage != nil {
				u.prompt = chunk.Usage.PromptTokens
				u.completion = chunk.Usage.CompletionTokens
			}
		}
		return u
	}
	var body struct {
		Usage *struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(trimmed, &body); err == nil && body.Usage != nil {
		u.prompt = body.Usage.PromptTokens
		u.completion = body.Usage.CompletionTokens
	}
	return u
}

// captureWriter is a transparent write-through recorder: status, headers,
// and bytes reach the client untouched while a copy is retained for Store.
// Flush is forwarded so SSE streams stay real-time through the hook.
type captureWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	buf         bytes.Buffer
	contentType string
}

func (c *captureWriter) WriteHeader(status int) {
	if c.wroteHeader {
		return
	}
	c.wroteHeader = true
	c.status = status
	if ct := c.ResponseWriter.Header().Get("Content-Type"); ct != "" {
		c.contentType = ct
	}
	c.ResponseWriter.WriteHeader(status)
}

func (c *captureWriter) Write(b []byte) (int, error) {
	if !c.wroteHeader {
		c.WriteHeader(http.StatusOK)
	}
	if c.contentType == "" {
		if ct := c.ResponseWriter.Header().Get("Content-Type"); ct != "" {
			c.contentType = ct
		}
	}
	c.buf.Write(b)
	return c.ResponseWriter.Write(b)
}

// Flush forwards flusher semantics so streaming stays real-time.
func (c *captureWriter) Flush() {
	if f, ok := c.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// --- Streaming replay helpers (spec 05 §2.6) ---

// SynthesizeSSE converts a cached unary JSON body into SSE framing
// ("data: <body>\n\ndata: [DONE]\n\n"), the same shape providers emit for
// stream:true. Used when a cached unary response must satisfy a streaming
// request (and in tests proving framing parity).
func SynthesizeSSE(jsonBody []byte, model string) []byte {
	_ = model // reserved: per-model chunk-splitting policy hook.
	var out bytes.Buffer
	out.WriteString("data: ")
	out.Write(bytes.TrimSpace(jsonBody))
	out.WriteString("\n\n")
	out.WriteString("data: [DONE]\n\n")
	return out.Bytes()
}

// ReplaySSE writes raw cached SSE bytes verbatim with streaming headers —
// byte-compatible with the live stream by construction (we replay exactly
// what the provider sent once).
func ReplaySSE(w http.ResponseWriter, rawSSE []byte) {
	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream")
	hdr.Set("Cache-Control", "no-cache")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-AgentLedger-Stream", "true")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(rawSSE)
}
