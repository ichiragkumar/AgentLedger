package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/cache"
	"github.com/agentledger/agentledger/internal/enforce"
	"github.com/agentledger/agentledger/internal/router"
	"github.com/agentledger/agentledger/pkg/models"
)

// Middleware is a standard HTTP middleware.
//
// Required chain order (spec 02, request flow):
//
//	enforce-stub → cache-stub → route-stub → upstream
//
// Each Phase-1 stub is a transparent passthrough that sets a diagnostic
// response header so operators can verify the chain. Later phases replace
// the bodies without touching the wiring in server.go:
//
//   - Phase 2 (Saver)    fills CacheStub with exact/semantic lookup.
//   - Phase 3 (Router)   fills RouteStub with classifier + tier selection.
//   - Phase 4 (Enforcer) fills EnforceStub with budget/policy pre-check.
type Middleware func(http.Handler) http.Handler

// Chain wraps h in mws so mws[0] runs first.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// EnforceStub is the Phase-4 budget/policy pre-check extension point.
// Today: passthrough. Contract: on deny, later phases return 429 with
// X-AgentLedger-Deny-Reason.
func EnforceStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-AgentLedger-Enforce", "pass-through")
		next.ServeHTTP(w, r)
	})
}

// CacheStub is the Phase-2 exact/semantic cache extension point.
// Today: always MISS passthrough. Contract: on hit, later phases return
// X-AgentLedger-Cache: HIT and skip upstream.
func CacheStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-AgentLedger-Cache", "MISS")
		next.ServeHTTP(w, r)
	})
}

// RouteStub is the Phase-3 intelligent-routing extension point.
// Today: passthrough (provider chosen by model prefix). Contract: later
// phases set X-AgentLedger-Route to the selected model.
func RouteStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-AgentLedger-Route", "model-prefix")
		next.ServeHTTP(w, r)
	})
}

// --- Auth + HIT logging (security fix 2026-09-20) ---
//
// Cache HITs serve inside the cache layer without reaching the upstream
// handler — which is also where virtual-key auth lived. Two consequences:
// unauthenticated callers could replay cached completions, and HIT usage
// never reached the audit trail. Both middlewares below close that:
//
//	AuthMiddleware resolves the virtual key FIRST (outermost). HIT or MISS,
//	unknown keys get 401 before any cached bytes move.
//	HitLogMiddleware sits outside the cache layer and logs served HITs
//	(real tokens, $0 cost — the spend was booked on the MISS that stored
//	them). HITs still never burn budget (Observe stays innermost).

// ctxKeyResolution carries the auth resolution past middleware that would
// otherwise re-resolve. Context, not a header: request headers are
// caller-controlled and must never be trusted for identity.
type ctxKeyResolution struct{}

// AuthMiddleware rejects unknown virtual keys before any other layer runs.
func (p *Proxy) AuthMiddleware() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			resolution, err := p.resolveKey(r)
			if err != nil {
				if err == auth.ErrMissingKey {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing virtual key: send AgentLedger-Key: vk_xxx"})
				} else {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid virtual key"})
				}
				return
			}
			ctx := context.WithValue(r.Context(), ctxKeyResolution{}, resolution)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// HitLogMiddleware logs served cache HITs to the audit trail. MISS traffic
// passes through untouched (the upstream handler logs it). Cost is always $0
// — the dollars were booked when the entry was stored.
func (p *Proxy) HitLogMiddleware() Middleware {
	return func(next http.Handler) http.Handler {
		if p.log == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ow := &observeWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(ow, r)
			if ow.Header().Get(cache.CacheHeader) != cache.ValueHit {
				return
			}
			p.logHit(r, ow)
		})
	}
}

func (p *Proxy) logHit(r *http.Request, ow *observeWriter) {
	defer func() { _ = recover() }()
	raw, _ := readRestoreBody(r, int64(maxRequestBodyBytes)+1)
	model, _, _ := parseRouteInput(raw, r.Header)
	if strings.TrimSpace(model) == "" {
		return
	}
	in, out := parseHitTokens(ow.Header().Get(cache.CacheTokensHeader))
	if in+out <= 0 {
		if u := ow.usage(); u.PromptTokens+u.CompletionTokens > 0 {
			in, out = u.PromptTokens, u.CompletionTokens
		} else {
			return
		}
	}
	attr := attributionFromRequest(r)
	var prefix string
	if res, ok := r.Context().Value(ctxKeyResolution{}).(auth.Resolution); ok {
		prefix = res.KeyPrefix
	}
	// HITs are served from memory: no measurable latency, no upstream call.
	_ = p.log.Log(r.Context(), models.RequestLog{
		Timestamp: time.Now().UTC(), Model: model, Provider: string(ResolveProvider(model)),
		TokensIn: in, TokensOut: out,
		CostUSD: 0, LatencyMs: 0, UpstreamLatencyMs: 0,
		AgentID: attr.AgentID, TeamID: attr.TeamID, ProjectID: attr.ProjectID,
		ChainID: attr.ChainID, ParentAgentID: attr.ParentAgentID,
		VirtualKeyPrefix: prefix, StatusCode: ow.status, Stream: false, PriceKnown: true,
	})
}

// parseHitTokens parses the "in/out" form written by serveEntry.
func parseHitTokens(s string) (int, int) {
	parts := strings.Split(strings.TrimSpace(s), "/")
	if len(parts) != 2 {
		return 0, 0
	}
	in, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	out, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || in < 0 || out < 0 {
		return 0, 0
	}
	return in, out
}

//
// The stubs above stay for env-gated fail-open (any subsystem off or
// erroring → stub behavior, never a 500 on the data plane). The live
// middlewares below replace the stub BODIES per the WIRING docs; chain
// order (enforce → cache → route → upstream) is unchanged.

// DefaultDowngradeHeader mirrors enforce.NewDefaultDowngrader().DowngradeHeader.
// PreCheck stamps it on the request when it downgrades; the route layer
// treats its presence as "budget already chose the model — do not rewrite".
// Prefer passing api.Downgrader.DowngradeHeader via the chain config.
const DefaultDowngradeHeader = "X-AgentLedger-Downgraded"

// TaskTypeHeader is an optional caller hint ("faq", "code", "research", …)
// read by the route layer alongside the body "task_type" field. Absent →
// the classifier works from the prompt alone. Additive, never required.
const TaskTypeHeader = "X-AgentLedger-Task-Type"

// maxClassifyBytes caps the prompt text fed to the classifier. Length bands
// top out at ~1200 words (≈8KB); anything beyond is classification noise
// and a ToLower allocation risk on the hot path. The body forwarded
// upstream is always intact — only the classify input is truncated.
const maxClassifyBytes = 64 << 10

// RouteMiddleware is the live Phase-3 routing layer. Nil engine → pure
// classify; nil tiers → router defaults. Fail-open: any parse/short-circuit
// problem forwards the request untouched with X-AgentLedger-Route set to
// the original model (or "passthrough" when unknown).
func RouteMiddleware(engine *router.Engine, tiers *router.TierMap, strategy router.Strategy, downgradeHeader string) Middleware {
	if tiers == nil {
		tiers = router.DefaultTierMap()
	}
	if strings.TrimSpace(downgradeHeader) == "" {
		downgradeHeader = DefaultDowngradeHeader
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Contract: cache HITs never re-route.
			if r.Header.Get("X-AgentLedger-Cache") == "HIT" {
				next.ServeHTTP(w, r)
				return
			}
			// Read + restore the body (cap 10MB+1; oversized → passthrough
			// with the prefix chained back so upstream sees intact bytes).
			raw, ok := readRestoreBody(r, int64(maxRequestBodyBytes)+1)
			if !ok {
				routePassthrough(w, r, next, "passthrough", "", "")
				return
			}
			model, prompt, taskType := parseRouteInput(raw, r.Header)
			if strings.TrimSpace(model) == "" {
				// No model: leave it for the proxy's 400, untouched.
				routePassthrough(w, r, next, "passthrough", "", "")
				return
			}
			in := router.InputFromRequest(classifyPrompt(prompt), taskType, r.Header)
			d := router.Decide(in, engine, tiers, strategy)
			setRouteHeaders(w, d)
			// Budget downgrade wins over routing: PreCheck already rewrote
			// the model for a 90%+ budget. Report the routing verdict in
			// headers but forward the downgraded body verbatim.
			if strings.TrimSpace(r.Header.Get(downgradeHeader)) != "" {
				w.Header().Set("X-AgentLedger-Route", model)
				next.ServeHTTP(w, r)
				return
			}
			if strings.TrimSpace(d.Model) != "" && !strings.EqualFold(d.Model, model) {
				rewritten := rewriteModelInBody(raw, d.Model)
				r.Body = io.NopCloser(bytes.NewReader(rewritten))
				r.ContentLength = int64(len(rewritten))
			}
			next.ServeHTTP(w, r)
		})
	}
}

// routePassthrough sets a best-effort route header and continues unmodified.
// It never fails the request: header writes on an in-flight writer are safe.
func routePassthrough(w http.ResponseWriter, r *http.Request, next http.Handler, route, tier, complexity string) {
	if route == "" {
		route = "passthrough"
	}
	w.Header().Set("X-AgentLedger-Route", route)
	if tier != "" {
		w.Header().Set("X-AgentLedger-Tier", tier)
	}
	if complexity != "" {
		w.Header().Set("X-AgentLedger-Complexity", complexity)
	}
	next.ServeHTTP(w, r)
}

// setRouteHeaders publishes the routing verdict (RouteStub contract +
// tier/complexity analytics headers + the firing rule id when present).
func setRouteHeaders(w http.ResponseWriter, d router.Decision) {
	for k, v := range d.Headers() {
		w.Header().Set(k, v)
	}
	if strings.TrimSpace(d.RuleID) != "" {
		w.Header().Set("X-AgentLedger-Route-Rule", d.RuleID)
	}
}

// readRestoreBody reads up to cap+1 bytes and restores r.Body so downstream
// sees the full stream. ok=false means the body is oversized (restored via
// MultiReader chaining the prefix back onto the unread remainder).
func readRestoreBody(r *http.Request, cap int64) (raw []byte, ok bool) {
	if r.Body == nil {
		return nil, true
	}
	prefix, err := io.ReadAll(io.LimitReader(r.Body, cap))
	if err != nil {
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(prefix), r.Body))
		return nil, false
	}
	if int64(len(prefix)) >= cap {
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(prefix), r.Body))
		return nil, false
	}
	r.Body = io.NopCloser(bytes.NewReader(prefix))
	r.ContentLength = int64(len(prefix))
	return prefix, true
}

// routeMessage is the parsed subset the route layer inspects. Content is
// raw: OpenAI sends a string or a [{type,text}] part array.
type routeMessage struct {
	Content json.RawMessage `json:"content"`
}

// routeBody is the parsed subset needed for routing decisions.
type routeBody struct {
	Model    string         `json:"model"`
	TaskType string         `json:"task_type"`
	Messages []routeMessage `json:"messages"`
}

// partText is one content part of a multi-part message.
type partText struct {
	Text string `json:"text"`
}

// parseRouteInput extracts model + concatenated prompt + task_type hint.
// task_type prefers the explicit header, then the body field. Never errors:
// unparsable input yields empty strings and the caller passes through.
func parseRouteInput(raw []byte, h http.Header) (model, prompt, taskType string) {
	taskType = strings.TrimSpace(h.Get(TaskTypeHeader))
	if len(raw) == 0 {
		return "", "", taskType
	}
	var b routeBody
	if err := json.Unmarshal(raw, &b); err != nil {
		return "", "", taskType
	}
	if strings.TrimSpace(b.TaskType) != "" && taskType == "" {
		taskType = strings.TrimSpace(b.TaskType)
	}
	var sb strings.Builder
	for _, m := range b.Messages {
		text := messageText(m.Content)
		if strings.TrimSpace(text) == "" {
			continue
		}
		if sb.Len() > 0 {
			sb.WriteByte('\n')
		}
		sb.WriteString(text)
		if sb.Len() > maxClassifyBytes {
			break
		}
	}
	return strings.TrimSpace(b.Model), sb.String(), taskType
}

// messageText flattens a message content (string or part array) to text.
func messageText(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			return s
		}
		return ""
	}
	if raw[0] == '[' {
		var parts []partText
		if err := json.Unmarshal(raw, &parts); err == nil {
			var sb strings.Builder
			for _, p := range parts {
				if strings.TrimSpace(p.Text) == "" {
					continue
				}
				if sb.Len() > 0 {
					sb.WriteByte('\n')
				}
				sb.WriteString(p.Text)
			}
			return sb.String()
		}
	}
	return ""
}

// classifyPrompt truncates the prompt for the classifier; the forwarded
// body is never truncated (see maxClassifyBytes).
func classifyPrompt(prompt string) string {
	if len(prompt) > maxClassifyBytes {
		return prompt[:maxClassifyBytes]
	}
	return prompt
}

// rewriteModelInBody swaps the top-level "model" value, preserving every
// other field. Falls back to the original bytes when the body is not a
// JSON object (fail-open: forward verbatim).
func rewriteModelInBody(raw []byte, model string) []byte {
	var obj map[string]interface{}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return raw
	}
	obj["model"] = model
	out, err := json.Marshal(obj)
	if err != nil {
		return raw
	}
	return out
}

// ObserveMiddleware records post-response usage into the enforcer (budgets,
// loop token counts, alert fan-out, audit) for every response that actually
// came from upstream. Placement is innermost (route → observe → upstream)
// so cache HITs never burn budget and the recorded model is the final
// (downgraded/routed) one. Nil api → passthrough. A nil pricer only loses
// dollar math; token math still lands.
//
// Fail-open: the response path never depends on observation. Usage parsing
// and the Observe call are recover-guarded; a nil-map or odd payload degrades
// to "unobserved", never to a 500.
func ObserveMiddleware(api *enforce.API, pricer coster) Middleware {
	return func(next http.Handler) http.Handler {
		if api == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, _ := readRestoreBody(r, int64(maxRequestBodyBytes)+1)
			model, _, _ := parseRouteInput(raw, r.Header)
			attr := enforce.AttributionFromRequest(r)
			chainID := strings.TrimSpace(r.Header.Get(HeaderChainID))

			ow := &observeWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(ow, r)

			observeResponse(api, pricer, attr, chainID, model, ow)
		})
	}
}

// observeResponse computes usage/cost from the captured response and records
// it. Upstream errors (non-2xx) and zero-usage responses never burn budget.
func observeResponse(api *enforce.API, pricer coster, attr enforce.Attribution, chainID, model string, ow *observeWriter) {
	defer func() { _ = recover() }()
	if ow.status/100 != 2 {
		return
	}
	usage := ow.usage()
	tokens := usage.PromptTokens + usage.CompletionTokens
	var cost float64
	if pricer != nil {
		func() {
			defer func() { _ = recover() }()
			if c, ok := pricer.Cost(model, usage.PromptTokens, usage.CompletionTokens); ok {
				cost = c
			}
		}()
	}
	if tokens <= 0 && cost <= 0 {
		return
	}
	api.Observe(attr, chainID, int64(tokens), cost)
}

// observeWriter tees response bytes to the client untouched while retaining
// just enough to compute usage: unary JSON bodies are buffered (bounded),
// SSE streams are sniffed line-wise with no retention (long streams must not
// grow the proxy heap). Flush is forwarded so streams stay real-time.
type observeWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	sse         bool
	decided     bool
	buf         bytes.Buffer
	truncated   bool
	pending     string
	sseUsage    models.Usage
}

// maxObserveBodyBytes bounds the retained unary body (proxy parity: 20MB
// upstream cap). Past the cap we stop retaining and report zero usage
// (fail-open: never burn budget on a guess, never OOM on a giant body).
const maxObserveBodyBytes = 20 << 20

func (w *observeWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *observeWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if !w.decided {
		w.decided = true
		w.sse = isSSEContentType(w.ResponseWriter.Header().Get("Content-Type"))
	}
	if w.sse {
		w.sniffSSE(b)
	} else if !w.truncated {
		if w.buf.Len()+len(b) > maxObserveBodyBytes {
			w.truncated = true
			w.buf.Reset()
		} else {
			w.buf.Write(b)
		}
	}
	return w.ResponseWriter.Write(b)
}

// Flush forwards flusher semantics so streaming stays real-time.
func (w *observeWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// sniffSSE folds one response chunk into the running usage estimate,
// keeping only the trailing partial line across Write boundaries.
func (w *observeWriter) sniffSSE(b []byte) {
	text := w.pending + string(b)
	lines := strings.Split(text, "\n")
	w.pending = ""
	if !strings.HasSuffix(text, "\n") {
		w.pending = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	}
	for _, line := range lines {
		if u, ok := parseUsageFromSSELine(line); ok && u != nil {
			w.sseUsage = *u
		}
	}
}

// usage returns the observed token usage: sniffed SSE usage for streams,
// parsed JSON usage for unary bodies (zero when truncated/unparsable).
func (w *observeWriter) usage() models.Usage {
	if w.sse {
		if u, ok := parseUsageFromSSELine(w.pending); ok && u != nil {
			w.sseUsage = *u
		}
		return sanitizeUsage(w.sseUsage)
	}
	if w.truncated || w.buf.Len() == 0 {
		return models.Usage{}
	}
	return parseUsageFromJSON(w.buf.Bytes(), "")
}

// isSSEContentType reports event-stream bodies (hook parity).
func isSSEContentType(ct string) bool {
	return strings.Contains(strings.ToLower(ct), "text/event-stream")
}
