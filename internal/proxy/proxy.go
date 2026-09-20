package proxy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/logger"
	"github.com/agentledger/agentledger/internal/pricing"
	"github.com/agentledger/agentledger/pkg/models"
)

// Attribution headers — passthrough + logged. Never require an SDK.
const (
	HeaderAgentID       = "X-Agent-Id"
	HeaderTeamID        = "X-Team-Id"
	HeaderProjectID     = "X-Project-Id"
	HeaderChainID       = "X-Request-Chain-Id"
	HeaderParentAgentID = "X-Parent-Agent-Id"
)

// attributionHeaders lists headers forwarded upstream untouched.
var attributionHeaders = []string{
	HeaderAgentID, HeaderTeamID, HeaderProjectID, HeaderChainID, HeaderParentAgentID,
}

// Hot-path bounds (DoS hardening). The proxy stays stdlib-only: no extra
// allocations on the happy path beyond these cheap length checks.
const (
	maxRequestBodyBytes  = 10 << 20 // 10MB cap on incoming JSON
	maxUpstreamBodyBytes = 20 << 20 // 20MB cap on upstream JSON
	maxModelLen          = 256      // model names longer than this are rejected
	maxTagLen            = 256      // attribution tags truncated to this (DB text bound)
	maxVirtualKeyLen     = 512      // virtual keys longer than this are rejected
)

// Proxy forwards OpenAI-compatible chat completions upstream while counting
// tokens, computing cost, and logging the audit row.
type Proxy struct {
	pricing coster
	auth    auth.Resolver
	vault   *auth.Vault // optional: accepts vault-issued vk_* keys (mgmt plane)
	log     logger.Logger
	metrics *Metrics
	client  *http.Client
	version string
}

// coster is the pricing surface the proxy needs. *pricing.Registry
// implements it, and the Router (Phase 3) reuses pricing.Pricer.
type coster interface {
	Cost(model string, promptTokens, completionTokens int) (float64, bool)
}

// Config wires a Proxy.
type Config struct {
	Pricing *pricing.Registry
	Auth    auth.Resolver
	// Vault optionally accepts management-plane-issued vk_* keys on the
	// data path (checked after Auth). Nil = virtual keys from Auth only.
	Vault   *auth.Vault
	Log     logger.Logger
	Metrics *Metrics
	// Client overrides http.DefaultClient (tests inject mock transport).
	Client *http.Client
	// Timeout for upstream calls.
	Timeout time.Duration
	// Version reported in /health and User-Agent.
	Version string
}

// New builds a Proxy with sane defaults.
func New(cfg Config) *Proxy {
	client := cfg.Client
	if client == nil {
		timeout := cfg.Timeout
		if timeout == 0 {
			timeout = 120 * time.Second
		}
		client = &http.Client{Timeout: timeout, Transport: http.DefaultTransport}
	}
	m := cfg.Metrics
	if m == nil {
		m = NewMetrics()
	}
	return &Proxy{
		pricing: cfg.Pricing,
		auth:    cfg.Auth,
		vault:   cfg.Vault,
		log:     cfg.Log,
		metrics: m,
		client:  client,
		version: cfg.Version,
	}
}

// Metrics exposes the registry for /metrics.
func (p *Proxy) Metrics() *Metrics { return p.metrics }

// Vault exposes the key vault for management-plane mounting (may be nil).
func (p *Proxy) Vault() *auth.Vault { return p.vault }

// minimalRequest is the parsed subset used for routing decisions.
// The raw body is always forwarded verbatim.
type minimalRequest struct {
	Model  string `json:"model"`
	Stream bool   `json:"stream"`
}

// upstreamUsage is the parsed subset of an upstream JSON response.
type upstreamUsage struct {
	Model string       `json:"model"`
	Usage models.Usage `json:"usage"`
	Error *upstreamErr `json:"error,omitempty"`
}

type upstreamErr struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
}

// sseUsageChunk is one streamed data: chunk.
type sseUsageChunk struct {
	Model string        `json:"model"`
	Usage *models.Usage `json:"usage,omitempty"`
}

// ServeChatCompletions handles POST /v1/chat/completions.
func (p *Proxy) ServeChatCompletions(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	// Panic guard: never drop the connection without a JSON error body.
	defer func() {
		if rec := recover(); rec != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal proxy error"})
		}
	}()
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed, use POST"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBodyBytes)) // 10MB cap
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read body"})
		return
	}

	var min minimalRequest
	if err := json.Unmarshal(body, &min); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	min.Model = strings.TrimSpace(min.Model)
	if min.Model == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "model is required"})
		return
	}
	if len(min.Model) > maxModelLen {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "model name too long"})
		return
	}

	provider := ResolveProvider(min.Model)
	upstreamURL := UpstreamChatCompletionsURL(provider)

	// --- Virtual key auth (never log the full key or the upstream key) ---
	vk := auth.VirtualKeyFromRequest(r)
	if vk == "" || len(vk) > maxVirtualKeyLen {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing virtual key: send AgentLedger-Key: vk_xxx"})
		return
	}
	resolution, err := p.auth.Resolve(vk)
	if err != nil && p.vault != nil {
		// Management-plane-issued keys (POST /v1/keys) resolve here.
		resolution, err = p.vault.Resolve(vk)
	}
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid virtual key"})
		return
	}
	attr := attributionFromRequest(r)
	// Request ID: prefer the caller's chain/trace header so dashboards can
	// join retries; generate a random one otherwise. Safe to log.
	requestID := requestIDFromRequest(r)

	// Resolve the real upstream key: per-provider env wins, else the
	// virtual-key resolution default. NEVER log either value.
	upstreamKey := resolution.UpstreamKey
	if envKey := strings.TrimSpace(os.Getenv(UpstreamAPIKeyEnv(provider))); envKey != "" {
		upstreamKey = envKey
	}

	// --- Build upstream request (forward body verbatim) ---
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost, upstreamURL, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "cannot build upstream request"})
		return
	}
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Accept", "application/json, text/event-stream")
	if upstreamKey != "" && upstreamKey != "test-only-no-key" {
		upReq.Header.Set("Authorization", "Bearer "+upstreamKey)
		if provider == ProviderAnthropic {
			// Anthropic native header; harmless on OpenAI-compatible bases.
			upReq.Header.Set("x-api-key", upstreamKey)
			upReq.Header.Set("anthropic-version", "2023-06-01")
		}
		if provider == ProviderGoogle {
			upReq.Header.Set("x-goog-api-key", upstreamKey)
		}
	}
	for _, h := range attributionHeaders {
		if v := r.Header.Get(h); v != "" {
			upReq.Header.Set(h, v)
		}
	}
	ua := "agentledger-proxy"
	if p.version != "" {
		ua += "/" + p.version
	}
	upReq.Header.Set("User-Agent", ua)
	if requestID != "" {
		upReq.Header.Set("X-Request-Id", requestID)
	}

	upstreamStart := time.Now()
	upResp, err := p.client.Do(upReq)
	upstreamLatency := time.Since(upstreamStart)
	if err != nil {
		p.finish(w, r, finishParams{
			model: min.Model, provider: provider, status: http.StatusBadGateway,
			stream: min.Stream, attr: attr, keyPrefix: resolution.KeyPrefix,
			start: start, upstreamLatency: upstreamLatency,
		})
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unreachable: " + provider.String()})
		return
	}
	defer upResp.Body.Close()

	contentType := upResp.Header.Get("Content-Type")
	isStream := min.Stream || strings.Contains(contentType, "text/event-stream")

	if isStream {
		p.serveStream(w, r, upResp, streamParams{
			model: min.Model, provider: provider, attr: attr,
			keyPrefix: resolution.KeyPrefix, start: start,
			upstreamLatency: upstreamLatency, requestID: requestID,
		})
		return
	}

	respBody, err := io.ReadAll(io.LimitReader(upResp.Body, maxUpstreamBodyBytes))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "cannot read upstream response"})
		return
	}
	usage := parseUsageFromJSON(respBody, min.Model)
	cost, known := p.pricing.Cost(min.Model, usage.PromptTokens, usage.CompletionTokens)

	// Relay upstream status + body verbatim (drop-in compatibility).
	for _, h := range []string{"Content-Type", "openai-processing-ms", "x-request-id"} {
		if v := upResp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	if w.Header().Get("X-Request-Id") == "" && requestID != "" {
		w.Header().Set("X-Request-Id", requestID)
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	setAccountingHeaders(w, provider, cost, known, time.Since(start))
	w.WriteHeader(upResp.StatusCode)
	_, _ = w.Write(respBody)

	latency := time.Since(start)
	p.metrics.Observe(min.Model, provider.String(), upResp.StatusCode, usage.PromptTokens, usage.CompletionTokens, cost, float64(latency.Microseconds())/1000.0)
	_ = p.log.Log(r.Context(), models.RequestLog{
		Timestamp: time.Now().UTC(), Model: min.Model, Provider: provider.String(),
		TokensIn: usage.PromptTokens, TokensOut: usage.CompletionTokens,
		CostUSD: cost, LatencyMs: float64(latency.Microseconds()) / 1000.0,
		UpstreamLatencyMs: float64(upstreamLatency.Microseconds()) / 1000.0,
		AgentID:           attr.AgentID, TeamID: attr.TeamID, ProjectID: attr.ProjectID,
		ChainID: attr.ChainID, ParentAgentID: attr.ParentAgentID,
		VirtualKeyPrefix: resolution.KeyPrefix, StatusCode: upResp.StatusCode,
		Stream: false, PriceKnown: known,
	})
}

type finishParams struct {
	model           string
	provider        Provider
	status          int
	stream          bool
	attr            models.Attribution
	keyPrefix       string
	start           time.Time
	upstreamLatency time.Duration
}

func (p *Proxy) finish(_ http.ResponseWriter, r *http.Request, f finishParams) {
	latency := time.Since(f.start)
	p.metrics.Observe(f.model, f.provider.String(), f.status, 0, 0, 0, float64(latency.Microseconds())/1000.0)
	_ = p.log.Log(r.Context(), models.RequestLog{
		Timestamp: time.Now().UTC(), Model: f.model, Provider: f.provider.String(),
		LatencyMs:         float64(latency.Microseconds()) / 1000.0,
		UpstreamLatencyMs: float64(f.upstreamLatency.Microseconds()) / 1000.0,
		AgentID:           f.attr.AgentID, TeamID: f.attr.TeamID, ProjectID: f.attr.ProjectID,
		ChainID: f.attr.ChainID, ParentAgentID: f.attr.ParentAgentID,
		VirtualKeyPrefix: f.keyPrefix, StatusCode: f.status, Stream: f.stream,
	})
}

type streamParams struct {
	model           string
	provider        Provider
	attr            models.Attribution
	keyPrefix       string
	start           time.Time
	upstreamLatency time.Duration
	requestID       string
}

// serveStream relays SSE chunks and counts tokens on completion.
// p99 overhead target: <15ms added (measured as handler latency minus
// upstream latency; the relay itself is a byte copy + bufio scan).
// Memory bound: chunks are relayed line-by-line, never buffered whole,
// so long streams cannot grow the proxy heap.
func (p *Proxy) serveStream(w http.ResponseWriter, r *http.Request, upResp *http.Response, sp streamParams) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-AgentLedger-Stream", "true")
	w.Header().Set("X-AgentLedger-Provider", sp.provider.String())
	if sp.requestID != "" {
		w.Header().Set("X-Request-Id", sp.requestID)
	}
	w.WriteHeader(upResp.StatusCode)
	flusher.Flush()

	scanner := bufio.NewScanner(upResp.Body)
	// SSE chunks can exceed the default 64k scan buffer for tool-call deltas.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	usage := models.Usage{}
	status := upResp.StatusCode
	for scanner.Scan() {
		line := scanner.Text()
		_, _ = fmt.Fprintln(w, line)
		flusher.Flush()
		if u, ok := parseUsageFromSSELine(line); ok && u != nil {
			usage = sanitizeUsage(*u)
		}
	}
	// scanner.Err() on upstream EOF is nil. When it is non-nil (e.g. a chunk
	// exceeded the 1MB scan cap, or the client went away) we keep the usage
	// counted so far and still emit the audit row — a partial count beats a
	// dropped row. The error surfaces via status/latency, never fatal.
	_ = scanner.Err()

	cost, known := p.pricing.Cost(sp.model, usage.PromptTokens, usage.CompletionTokens)
	latency := time.Since(sp.start)
	p.metrics.Observe(sp.model, sp.provider.String(), status, usage.PromptTokens, usage.CompletionTokens, cost, float64(latency.Microseconds())/1000.0)
	_ = p.log.Log(r.Context(), models.RequestLog{
		Timestamp: time.Now().UTC(), Model: sp.model, Provider: sp.provider.String(),
		TokensIn: usage.PromptTokens, TokensOut: usage.CompletionTokens,
		CostUSD: cost, LatencyMs: float64(latency.Microseconds()) / 1000.0,
		UpstreamLatencyMs: float64(sp.upstreamLatency.Microseconds()) / 1000.0,
		AgentID:           sp.attr.AgentID, TeamID: sp.attr.TeamID, ProjectID: sp.attr.ProjectID,
		ChainID: sp.attr.ChainID, ParentAgentID: sp.attr.ParentAgentID,
		VirtualKeyPrefix: sp.keyPrefix, StatusCode: status, Stream: true, PriceKnown: known,
	})
}

// parseUsageFromJSON extracts usage from a complete (non-stream) body.
// Returns zero usage when the upstream returned an error payload.
// Negative counters (never valid) are clamped to zero.
func parseUsageFromJSON(body []byte, fallbackModel string) models.Usage {
	var u upstreamUsage
	if err := json.Unmarshal(body, &u); err != nil {
		return models.Usage{}
	}
	_ = fallbackModel
	return sanitizeUsage(u.Usage)
}

// parseUsageFromSSELine extracts usage from one "data: {...}" line.
func parseUsageFromSSELine(line string) (*models.Usage, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data:") {
		return nil, false
	}
	payload := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
	if payload == "" || payload == "[DONE]" {
		return nil, false
	}
	var chunk sseUsageChunk
	if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
		return nil, false
	}
	if chunk.Usage == nil {
		return nil, false
	}
	u := sanitizeUsage(*chunk.Usage)
	return &u, true
}

func attributionFromRequest(r *http.Request) models.Attribution {
	return models.Attribution{
		AgentID:       truncateTag(r.Header.Get(HeaderAgentID)),
		TeamID:        truncateTag(r.Header.Get(HeaderTeamID)),
		ProjectID:     truncateTag(r.Header.Get(HeaderProjectID)),
		ChainID:       truncateTag(r.Header.Get(HeaderChainID)),
		ParentAgentID: truncateTag(r.Header.Get(HeaderParentAgentID)),
	}
}

// truncateTag bounds attribution tags before they reach logs/Postgres.
// Truncation (not rejection) keeps the request flowing — a long team name
// must never 400 an agent call.
func truncateTag(s string) string {
	if len(s) > maxTagLen {
		return s[:maxTagLen]
	}
	return s
}

// sanitizeUsage clamps impossible counters to zero.
func sanitizeUsage(u models.Usage) models.Usage {
	if u.PromptTokens < 0 {
		u.PromptTokens = 0
	}
	if u.CompletionTokens < 0 {
		u.CompletionTokens = 0
	}
	if u.TotalTokens < 0 {
		u.TotalTokens = 0
	}
	return u
}

// requestIDFromRequest joins tracing without new headers: reuse the
// caller's X-Request-Id, else the attribution chain id, else a random id.
// The value is safe to log (no secrets) and is echoed back as X-Request-Id.
func requestIDFromRequest(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("X-Request-Id")); v != "" {
		return truncateTag(v)
	}
	if v := strings.TrimSpace(r.Header.Get(HeaderChainID)); v != "" {
		return truncateTag(v)
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	return "req_" + hex.EncodeToString(b[:])
}

func setAccountingHeaders(w http.ResponseWriter, provider Provider, cost float64, known bool, latency time.Duration) {
	w.Header().Set("X-AgentLedger-Provider", provider.String())
	w.Header().Set("X-AgentLedger-Cost-Usd", fmt.Sprintf("%.8f", cost))
	if !known {
		w.Header().Set("X-AgentLedger-Price", "fallback")
	}
	// Overhead visibility: total handler latency. p99 target <15ms streaming.
	w.Header().Set("X-AgentLedger-Latency-Ms", fmt.Sprintf("%.3f", float64(latency.Microseconds())/1000.0))
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
