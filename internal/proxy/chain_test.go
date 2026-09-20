package proxy

// Wired-chain tests (finish track): the live pipeline
// enforce-precheck → cache-hook → route → observe → upstream.
//
// Each test builds its own subsystem instances (fresh enforcer/hook/engine
// per test, mock upstream counting calls) so tests are hermetic. Reuses the
// package helpers in proxy_test.go (testSetup capture shape, stdHeaders).

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/cache"
	"github.com/agentledger/agentledger/internal/enforce"
	"github.com/agentledger/agentledger/internal/logger"
	"github.com/agentledger/agentledger/internal/pricing"
	"github.com/agentledger/agentledger/internal/router"
)

// chainFixture is a fully wired mux plus its observable state.
type chainFixture struct {
	mux      *http.ServeMux
	cap      *upstreamCapture
	calls    int
	mem      *logger.MemoryLogger
	enforcer *enforce.API
	hook     *cache.Hook
	engine   *router.Engine
}

// wireChainTest spins a mock upstream and returns a mux with ALL live layers
// (precheck + cache hook with pricing adapter + route + observe). The mock
// answers model/in/out usage JSON for any request model and counts calls.
func wireChainTest(t *testing.T, in, out int, engine *router.Engine) *chainFixture {
	t.Helper()
	fx := &chainFixture{cap: &upstreamCapture{}, mem: &logger.MemoryLogger{}, enforcer: enforce.NewAPI(), engine: engine}
	if fx.engine == nil {
		fx.engine = router.NewEngine()
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		fx.cap.gotAuth = r.Header.Get("Authorization")
		fx.cap.gotAgent = r.Header.Get(HeaderAgentID)
		fx.cap.gotTeam = r.Header.Get(HeaderTeamID)
		fx.cap.gotProject = r.Header.Get(HeaderProjectID)
		fx.cap.gotChain = r.Header.Get(HeaderChainID)
		fx.cap.gotParent = r.Header.Get(HeaderParentAgentID)
		fx.cap.gotBody = string(body)
		fx.calls++
		mockJSONResponse("mock", in, out)(w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("OPENAI_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("GOOGLE_BASE_URL", srv.URL)
	t.Setenv("DEEPSEEK_BASE_URL", srv.URL)
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("GOOGLE_API_KEY", "")
	t.Setenv("DEEPSEEK_API_KEY", "")

	reg := pricing.NewDefault()
	p := New(Config{
		Pricing: reg,
		Auth:    auth.NewMapResolver(map[string]string{"vk_test": "sk-test-upstream"}),
		Log:     fx.mem,
		Metrics: NewMetrics(),
		Version: "chain-test",
	})
	fx.hook = cache.NewHook(cache.DefaultConfig(), nil)
	fx.hook.Cost = func(model string, in, out int) (float64, bool) {
		return reg.Cost(model, in, out)
	}
	fx.mux = NewMuxWithChain(p, ChainDeps{
		Enforcer: fx.enforcer,
		Cache:    fx.hook,
		Router: &RouterChainConfig{
			Engine:          fx.engine,
			Tiers:           router.DefaultTierMap(),
			Strategy:        router.StrategyBalanced,
			DowngradeHeader: fx.enforcer.Downgrader.DowngradeHeader,
		},
	})
	return fx
}

func (fx *chainFixture) do(t *testing.T, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	fx.mux.ServeHTTP(rec, req)
	return rec
}

// chainHeaders returns stdHeaders with agent/team overrides.
func chainHeaders(agent, team string) map[string]string {
	h := stdHeaders()
	h[HeaderAgentID] = agent
	h[HeaderTeamID] = team
	return h
}

func TestChainCacheHitSkipsUpstream(t *testing.T) {
	fx := wireChainTest(t, 10, 20, nil)
	h := chainHeaders("cache-agent", "cache-team")
	body := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"explain photosynthesis in simple terms"}]}`

	first := fx.do(t, body, h)
	if first.Code != http.StatusOK {
		t.Fatalf("first: status %d body %s", first.Code, first.Body.String())
	}
	if got := first.Header().Get("X-AgentLedger-Cache"); got != "MISS" {
		t.Fatalf("first must MISS, got %q", got)
	}
	// Live layers leave their markers with real values.
	if got := first.Header().Get("X-AgentLedger-Enforce"); got != "enforcing" {
		t.Fatalf("enforce marker = %q", got)
	}
	route := first.Header().Get("X-AgentLedger-Route")
	if route == "" || route == "model-prefix" {
		t.Fatalf("route header must carry the live decision, got %q", route)
	}
	if fx.calls != 1 {
		t.Fatalf("first must reach upstream once, calls=%d", fx.calls)
	}

	second := fx.do(t, body, h)
	if second.Code != http.StatusOK {
		t.Fatalf("second: status %d body %s", second.Code, second.Body.String())
	}
	if got := second.Header().Get("X-AgentLedger-Cache"); got != "HIT" {
		t.Fatalf("duplicate prompt must HIT, got %q", got)
	}
	if got := second.Header().Get("X-AgentLedger-Cache-Layer"); got != "exact" {
		t.Fatalf("hit layer = %q, want exact", got)
	}
	if got := second.Header().Get("X-AgentLedger-Saved-Usd"); got == "" {
		t.Fatal("hit must report saved usd")
	}
	if fx.calls != 1 {
		t.Fatalf("HIT must skip upstream, calls=%d", fx.calls)
	}
	if second.Body.String() != first.Body.String() {
		t.Fatal("replay must be byte-identical to the live response")
	}
}

func TestChainRouteRuleRewriteSetsModelHeader(t *testing.T) {
	engine := router.NewEngine()
	if err := engine.LoadBytes([]byte(`{"rules":[{"id":"support-faq","agent_id":"support_bot","task_type":"faq","model":"gemini-2.0-flash","tier":"simple","priority":10}]}`)); err != nil {
		t.Fatalf("load rules: %v", err)
	}
	fx := wireChainTest(t, 5, 5, engine)
	h := chainHeaders("support_bot", "support")
	h[TaskTypeHeader] = "faq"
	rec := fx.do(t, `{"model":"gpt-4o","messages":[{"role":"user","content":"where is my invoice"}]}`, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("X-AgentLedger-Route"); got != "gemini-2.0-flash" {
		t.Fatalf("route = %q, want gemini-2.0-flash", got)
	}
	if got := rec.Header().Get("X-AgentLedger-Tier"); got != "simple" {
		t.Fatalf("tier = %q, want simple", got)
	}
	if got := rec.Header().Get("X-AgentLedger-Route-Rule"); got != "support-faq" {
		t.Fatalf("rule = %q, want support-faq", got)
	}
	var up map[string]interface{}
	if err := json.Unmarshal([]byte(fx.cap.gotBody), &up); err != nil {
		t.Fatalf("upstream body not JSON: %v", err)
	}
	if up["model"] != "gemini-2.0-flash" {
		t.Fatalf("upstream model = %v, want rewritten gemini-2.0-flash", up["model"])
	}
}

func TestChainRouteClassifySetsHeaders(t *testing.T) {
	fx := wireChainTest(t, 5, 5, nil)
	h := chainHeaders("coder", "eng")
	longPrompt := `implement a lock-free concurrent hash map in Go with linearizable deletes, ` +
		`analyze the memory ordering tradeoffs step by step, derive the amortized complexity, ` +
		`refactor the resize path to avoid stop-the-world pauses and debug the race condition ` +
		`in the epoch reclamation algorithm with benchmarks`
	rec := fx.do(t, fmt.Sprintf(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":%q}]}`, longPrompt), h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	route := rec.Header().Get("X-AgentLedger-Route")
	if route == "" || route == "model-prefix" {
		t.Fatalf("route header must carry the live decision, got %q", route)
	}
	// The header verdict and the model forwarded upstream must agree.
	var up map[string]interface{}
	if err := json.Unmarshal([]byte(fx.cap.gotBody), &up); err != nil {
		t.Fatalf("upstream body not JSON: %v", err)
	}
	if up["model"] != route {
		t.Fatalf("upstream model %v != route header %q", up["model"], route)
	}
	if cx := rec.Header().Get("X-AgentLedger-Complexity"); cx == "" {
		t.Fatal("missing complexity header")
	}
}

func TestChainPreCheck429Shape(t *testing.T) {
	fx := wireChainTest(t, 10, 20, nil)
	fx.enforcer.Budgets.Upsert(enforce.Budget{
		Level: enforce.LevelTeam, Key: "tiny", Window: enforce.WindowMonthly,
		TokenLimit: 10, SpentTokens: 10,
	})
	h := chainHeaders("any-agent", "tiny")
	rec := fx.do(t, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}`, h)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429 body %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("429 body not JSON: %v", err)
	}
	if body["error"] != "budget_exceeded" || body["budget_id"] != "team:tiny:monthly" ||
		body["utilization"] != "100%" || body["reset_at"] == "" {
		t.Fatalf("429 shape wrong: %v", body)
	}
	if rec.Header().Get(enforce.DenyReasonHeader) == "" {
		t.Fatal("missing deny-reason header")
	}
	if fx.calls != 0 {
		t.Fatal("hard-stopped request must not reach upstream")
	}
}

func TestChainDowngradeKeepsBudgetModel(t *testing.T) {
	fx := wireChainTest(t, 10, 20, nil)
	fx.enforcer.Budgets.Upsert(enforce.Budget{
		Level: enforce.LevelTeam, Key: "dg", Window: enforce.WindowMonthly,
		TokenLimit: 100, SpentTokens: 90,
	})
	h := chainHeaders("dg-agent", "dg")
	rec := fx.do(t, `{"model":"gpt-5.5-pro","messages":[{"role":"user","content":"hello"}]}`, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("downgrade must not drop the call, status %d body %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("X-AgentLedger-Downgraded"); got != "gpt-5.5-pro->claude-sonnet-4" {
		t.Fatalf("downgrade header = %q", got)
	}
	// Router must NOT override the budget-chosen model.
	var up map[string]interface{}
	if err := json.Unmarshal([]byte(fx.cap.gotBody), &up); err != nil {
		t.Fatalf("upstream body not JSON: %v", err)
	}
	if up["model"] != "claude-sonnet-4" {
		t.Fatalf("upstream model = %v, want downgraded claude-sonnet-4", up["model"])
	}
	if got := rec.Header().Get("X-AgentLedger-Route"); got != "claude-sonnet-4" {
		t.Fatalf("route header = %q, want downgraded model echoed", got)
	}
}

func TestChainObserveRecordsSpend(t *testing.T) {
	fx := wireChainTest(t, 10, 20, nil)
	fx.enforcer.Budgets.Upsert(enforce.Budget{
		Level: enforce.LevelTeam, Key: "obs", Window: enforce.WindowMonthly,
		TokenLimit: 100000,
	})
	h := chainHeaders("obs-agent", "obs")
	rec := fx.do(t, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"a completely unique spend-tracking prompt"}]}`, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	b, ok := fx.enforcer.Budgets.Get("team:obs:monthly")
	if !ok {
		t.Fatal("budget missing after request")
	}
	if b.SpentTokens != 30 {
		t.Fatalf("spent tokens = %d, want 30 (10 prompt + 20 completion)", b.SpentTokens)
	}
	// Dollar math follows the FINAL (routed) model via the live registry.
	route := rec.Header().Get("X-AgentLedger-Route")
	wantCost, _ := pricing.NewDefault().Cost(route, 10, 20)
	if b.SpentUSD != wantCost {
		t.Fatalf("spent USD = %f, want %f for routed model %q", b.SpentUSD, wantCost, route)
	}
}

func TestChainObserveStreaming(t *testing.T) {
	fx := &chainFixture{cap: &upstreamCapture{}, mem: &logger.MemoryLogger{}, enforcer: enforce.NewAPI(), engine: router.NewEngine()}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fx.calls++
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintln(w, `data: {"id":"c1","model":"gpt-4o-mini","choices":[{"delta":{"content":"Hello"}}]}`)
		fmt.Fprintln(w, `data: {"id":"c1","model":"gpt-4o-mini","choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":9,"total_tokens":16}}`)
		fmt.Fprintln(w, `data: [DONE]`)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("OPENAI_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("GOOGLE_BASE_URL", srv.URL)
	t.Setenv("DEEPSEEK_BASE_URL", srv.URL)
	t.Setenv("OPENAI_API_KEY", "")
	reg := pricing.NewDefault()
	p := New(Config{
		Pricing: reg,
		Auth:    auth.NewMapResolver(map[string]string{"vk_test": "sk-test-upstream"}),
		Log:     fx.mem,
		Metrics: NewMetrics(),
		Version: "chain-test",
	})
	fx.hook = cache.NewHook(cache.DefaultConfig(), nil)
	fx.hook.Cost = func(model string, in, out int) (float64, bool) { return reg.Cost(model, in, out) }
	fx.mux = NewMuxWithChain(p, ChainDeps{
		Enforcer: fx.enforcer,
		Cache:    fx.hook,
		Router:   &RouterChainConfig{Engine: fx.engine, Tiers: router.DefaultTierMap(), Strategy: router.StrategyBalanced},
	})
	fx.enforcer.Budgets.Upsert(enforce.Budget{
		Level: enforce.LevelTeam, Key: "stream", Window: enforce.WindowMonthly,
		TokenLimit: 100000,
	})
	h := chainHeaders("stream-agent", "stream")
	rec := fx.do(t, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"stream me a greeting"}],"stream":true}`, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q", ct)
	}
	b, _ := fx.enforcer.Budgets.Get("team:stream:monthly")
	if b.SpentTokens != 16 {
		t.Fatalf("streamed spent tokens = %d, want 16 (7+9 terminal usage)", b.SpentTokens)
	}
}

func TestChainStubsWhenGatedOff(t *testing.T) {
	fx := wireChainTest(t, 1, 1, nil)
	// Rebuild the mux with empty deps: identical to NewMux stub behavior.
	reg := pricing.NewDefault()
	p := New(Config{
		Pricing: reg,
		Auth:    auth.NewMapResolver(map[string]string{"vk_test": "sk-test-upstream"}),
		Log:     &logger.MemoryLogger{},
		Metrics: NewMetrics(),
		Version: "chain-test",
	})
	mux := NewMuxWithChain(p, ChainDeps{})
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o-mini","messages":[]}`))
	for k, v := range stdHeaders() {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	_ = fx
	if rec.Header().Get("X-AgentLedger-Enforce") != "pass-through" {
		t.Fatal("gated-off enforce must be pass-through")
	}
	if rec.Header().Get("X-AgentLedger-Cache") != "MISS" {
		t.Fatal("gated-off cache must MISS")
	}
	if rec.Header().Get("X-AgentLedger-Route") != "model-prefix" {
		t.Fatal("gated-off route must be model-prefix")
	}
}

func TestChainInvalidJSONFailOpen(t *testing.T) {
	fx := wireChainTest(t, 1, 1, nil)
	rec := fx.do(t, `{oops`, stdHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want proxy 400 (live layers must not panic)", rec.Code)
	}
	if got := rec.Header().Get("X-AgentLedger-Route"); got == "" {
		t.Fatal("route header must be present even on fail-open passthrough")
	}
}

func TestChainHitRequiresAuth(t *testing.T) {
	// Regression: cache HITs served without reaching the upstream handler,
	// where virtual-key auth used to live. Unknown callers must 401 even
	// when the exact bytes sit in cache.
	fx := wireChainTest(t, 10, 20, nil)
	h := chainHeaders("auth-agent", "auth-team")
	body := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"auth probe tungsten hedgehog"}]}`
	seeded := fx.do(t, body, h)
	if seeded.Code != http.StatusOK {
		t.Fatalf("seed: status %d", seeded.Code)
	}
	// Same bytes, no key (and a bogus key): both must 401, never replay.
	noKey := chainHeaders("auth-agent", "auth-team")
	delete(noKey, "AgentLedger-Key")
	for name, hdr := range map[string]map[string]string{"no-key": noKey} {
		rec := fx.do(t, body, hdr)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s HIT replay: status %d, want 401", name, rec.Code)
		}
	}
	bogus := chainHeaders("auth-agent", "auth-team")
	bogus["AgentLedger-Key"] = "vk_nope"
	if rec := fx.do(t, body, bogus); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bogus-key HIT replay: status %d, want 401", rec.Code)
	}
	// The real key still replays (sanity: auth passes, HIT serves).
	if rec := fx.do(t, body, h); rec.Code != http.StatusOK {
		t.Fatalf("authed replay: status %d, want 200", rec.Code)
	}
}

func TestChainHitLogsAuditRow(t *testing.T) {
	// Cache HITs never burn budget (Observe stays innermost) but MUST reach
	// the audit trail: real tokens, $0 cost (spend booked on the MISS).
	fx := wireChainTest(t, 10, 20, nil)
	h := chainHeaders("hitlog-agent", "hitlog-team")
	body := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hitlog probe copper octopus"}]}`
	if rec := fx.do(t, body, h); rec.Code != http.StatusOK {
		t.Fatalf("seed: status %d", rec.Code)
	}
	before := len(fx.mem.Entries)
	hit := fx.do(t, body, h)
	if hit.Code != http.StatusOK {
		t.Fatalf("replay: status %d", hit.Code)
	}
	if got := hit.Header().Get("X-AgentLedger-Cache"); got != "HIT" {
		t.Fatalf("expected HIT, got %q", got)
	}
	if len(fx.mem.Entries) != before+1 {
		t.Fatalf("HIT must append exactly one audit row, entries %d→%d", before, len(fx.mem.Entries))
	}
	row := fx.mem.Entries[len(fx.mem.Entries)-1]
	if row.TokensIn+row.TokensOut <= 0 {
		t.Fatalf("HIT row must carry real tokens, got %+v", row)
	}
	if row.CostUSD != 0 {
		t.Fatalf("HIT row cost must be 0 (booked on MISS), got %f", row.CostUSD)
	}
	if row.AgentID != "hitlog-agent" || row.Model != "gpt-4o-mini" {
		t.Fatalf("HIT row attribution wrong: %+v", row)
	}
}
