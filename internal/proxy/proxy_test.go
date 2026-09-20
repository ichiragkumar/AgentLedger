package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/logger"
	"github.com/agentledger/agentledger/internal/pricing"
)

// testSetup spins a mock upstream and returns a Proxy wired to it plus the
// captured upstream request headers/bodies.
func testSetup(t *testing.T, upstream http.HandlerFunc) (*Proxy, *logger.MemoryLogger, *Metrics, *upstreamCapture) {
	t.Helper()
	cap := &upstreamCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		cap.gotAuth = r.Header.Get("Authorization")
		cap.gotAgent = r.Header.Get(HeaderAgentID)
		cap.gotTeam = r.Header.Get(HeaderTeamID)
		cap.gotProject = r.Header.Get(HeaderProjectID)
		cap.gotChain = r.Header.Get(HeaderChainID)
		cap.gotParent = r.Header.Get(HeaderParentAgentID)
		cap.gotBody = string(body)
		upstream(w, r)
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

	mem := &logger.MemoryLogger{}
	m := NewMetrics()
	p := New(Config{
		Pricing: pricing.NewDefault(),
		Auth:    auth.NewMapResolver(map[string]string{"vk_test": "sk-test-upstream"}),
		Log:     mem,
		Metrics: m,
		Version: "test",
	})
	return p, mem, m, cap
}

type upstreamCapture struct {
	gotAuth    string
	gotAgent   string
	gotTeam    string
	gotProject string
	gotChain   string
	gotParent  string
	gotBody    string
}

func mockJSONResponse(model string, in, out int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"id":"chatcmpl-test","object":"chat.completion","model":%q,"usage":{"prompt_tokens":%d,"completion_tokens":%d,"total_tokens":%d},"choices":[{"message":{"role":"assistant","content":"hi"}}]}`,
			model, in, out, in+out)
	}
}

func doProxyRequest(t *testing.T, p *Proxy, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	NewMux(p).ServeHTTP(rec, req)
	return rec
}

func stdHeaders() map[string]string {
	return map[string]string{
		"AgentLedger-Key":   "vk_test",
		HeaderAgentID:       "agent-1",
		HeaderTeamID:        "team-a",
		HeaderProjectID:     "proj-x",
		HeaderChainID:       "chain-1",
		HeaderParentAgentID: "agent-0",
	}
}

func TestResolveProviderTable(t *testing.T) {
	cases := map[string]Provider{
		"gpt-4o": "openai", "gpt-4o-mini": "openai", "o1": "openai", "o3-mini": "openai",
		"openai/gpt-4o": "openai", "unknown-xyz": "openai", "": "openai",
		"claude-3-5-sonnet": "anthropic", "claude-sonnet-4": "anthropic", "anthropic/claude": "anthropic",
		"gemini-1.5-flash": "google", "gemini-2.0-flash": "google", "google/gemini": "google", "gemma-2b": "google",
		"deepseek-chat": "deepseek", "deepseek-reasoner": "deepseek",
		"GPT-4O": "openai", "Claude-3-5-Sonnet": "anthropic",
	}
	for model, want := range cases {
		if got := ResolveProvider(model); got != want {
			t.Errorf("ResolveProvider(%q) = %q, want %q", model, got, want)
		}
	}
}

func TestNonStreamingHappyPath(t *testing.T) {
	p, mem, m, cap := testSetup(t, mockJSONResponse("gpt-4o-mini", 10, 20))
	rec := doProxyRequest(t, p, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`, stdHeaders())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	// Body relayed verbatim.
	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	// Upstream got the real key, never the virtual one.
	if cap.gotAuth != "Bearer sk-test-upstream" {
		t.Fatalf("upstream auth = %q", cap.gotAuth)
	}
	// Attribution passthrough.
	if cap.gotAgent != "agent-1" || cap.gotTeam != "team-a" || cap.gotProject != "proj-x" ||
		cap.gotChain != "chain-1" || cap.gotParent != "agent-0" {
		t.Fatalf("attribution not forwarded: %+v", cap)
	}
	// Raw body preserved.
	if !strings.Contains(cap.gotBody, "gpt-4o-mini") {
		t.Fatalf("body not forwarded: %s", cap.gotBody)
	}
	// Accounting headers.
	if rec.Header().Get("X-AgentLedger-Provider") != "openai" {
		t.Fatalf("provider header = %q", rec.Header().Get("X-AgentLedger-Provider"))
	}
	if rec.Header().Get("X-AgentLedger-Cost-Usd") == "" {
		t.Fatal("missing cost header")
	}
	if rec.Header().Get("X-AgentLedger-Latency-Ms") == "" {
		t.Fatal("missing latency header")
	}
	// Middleware chain markers (enforce → cache → route).
	if rec.Header().Get("X-AgentLedger-Enforce") != "pass-through" {
		t.Fatal("missing enforce stub marker")
	}
	if rec.Header().Get("X-AgentLedger-Cache") != "MISS" {
		t.Fatal("missing cache stub marker")
	}
	if rec.Header().Get("X-AgentLedger-Route") != "model-prefix" {
		t.Fatal("missing route stub marker")
	}
	// Logger row.
	if len(mem.Entries) != 1 {
		t.Fatalf("expected 1 log row, got %d", len(mem.Entries))
	}
	e := mem.Entries[0]
	if e.Model != "gpt-4o-mini" || e.TokensIn != 10 || e.TokensOut != 20 {
		t.Fatalf("bad row: %+v", e)
	}
	if !e.PriceKnown {
		t.Fatal("expected known price")
	}
	wantCost, _ := pricing.NewDefault().Cost("gpt-4o-mini", 10, 20)
	if e.CostUSD != wantCost {
		t.Fatalf("cost = %f, want %f", e.CostUSD, wantCost)
	}
	if e.AgentID != "agent-1" || e.TeamID != "team-a" || e.ProjectID != "proj-x" ||
		e.ChainID != "chain-1" || e.ParentAgentID != "agent-0" {
		t.Fatalf("attribution not logged: %+v", e)
	}
	if e.VirtualKeyPrefix != "vk_t***" {
		t.Fatalf("key prefix = %q", e.VirtualKeyPrefix)
	}
	if e.StatusCode != 200 || e.Stream {
		t.Fatalf("status/stream = %d %v", e.StatusCode, e.Stream)
	}
	// Secrets never in logs.
	logJSON, _ := json.Marshal(e)
	if strings.Contains(string(logJSON), "sk-test-upstream") || strings.Contains(string(logJSON), "vk_test\"") {
		t.Fatal("secret leaked into log row")
	}
	// Metrics.
	snap := m.Snapshot()
	if snap.RequestsTotal != 1 || snap.TokensIn != 10 || snap.TokensOut != 20 {
		t.Fatalf("bad snapshot: %+v", snap)
	}
}

func TestPerProviderRouting(t *testing.T) {
	for _, tc := range []struct {
		model    string
		provider string
	}{
		{"claude-3-5-sonnet", "anthropic"},
		{"gemini-1.5-flash", "google"},
		{"deepseek-chat", "deepseek"},
	} {
		p, mem, _, _ := testSetup(t, mockJSONResponse(tc.model, 5, 5))
		rec := doProxyRequest(t, p, fmt.Sprintf(`{"model":%q,"messages":[]}`, tc.model), stdHeaders())
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", tc.model, rec.Code)
		}
		if rec.Header().Get("X-AgentLedger-Provider") != tc.provider {
			t.Fatalf("%s: provider = %q", tc.model, rec.Header().Get("X-AgentLedger-Provider"))
		}
		if mem.Entries[0].Provider != tc.provider {
			t.Fatalf("%s: logged provider = %q", tc.model, mem.Entries[0].Provider)
		}
	}
}

func TestMissingModel400(t *testing.T) {
	p, mem, _, _ := testSetup(t, mockJSONResponse("x", 1, 1))
	for _, body := range []string{`{}`, `{"model":""}`, `{"model":"  "}`} {
		rec := doProxyRequest(t, p, body, stdHeaders())
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status %d", body, rec.Code)
		}
	}
	if len(mem.Entries) != 0 {
		t.Fatal("bad requests must not log rows")
	}
}

func TestInvalidJSON400(t *testing.T) {
	p, _, _, _ := testSetup(t, mockJSONResponse("x", 1, 1))
	rec := doProxyRequest(t, p, `{oops`, stdHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	p, _, _, _ := testSetup(t, mockJSONResponse("x", 1, 1))
	req := httptest.NewRequest(http.MethodGet, "/v1/chat/completions", nil)
	rec := httptest.NewRecorder()
	NewMux(p).ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestAuthFailures(t *testing.T) {
	p, mem, _, _ := testSetup(t, mockJSONResponse("gpt-4o", 1, 1))
	// No key.
	rec := doProxyRequest(t, p, `{"model":"gpt-4o","messages":[]}`, map[string]string{})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no key: status %d", rec.Code)
	}
	// Bad key.
	rec = doProxyRequest(t, p, `{"model":"gpt-4o","messages":[]}`, map[string]string{"AgentLedger-Key": "vk_nope"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad key: status %d", rec.Code)
	}
	// Bearer vk_ form works.
	rec = doProxyRequest(t, p, `{"model":"gpt-4o","messages":[]}`, map[string]string{"Authorization": "Bearer vk_test"})
	if rec.Code != http.StatusOK {
		t.Fatalf("bearer vk: status %d body %s", rec.Code, rec.Body.String())
	}
	if len(mem.Entries) != 1 {
		t.Fatalf("only authed request logs, got %d", len(mem.Entries))
	}
}

func TestUpstreamErrorRelayed(t *testing.T) {
	p, mem, _, _ := testSetup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"bad key","type":"auth"}}`))
	})
	rec := doProxyRequest(t, p, `{"model":"gpt-4o","messages":[]}`, stdHeaders())
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
	if len(mem.Entries) != 1 || mem.Entries[0].StatusCode != 401 {
		t.Fatalf("expected 401 row, got %+v", mem.Entries)
	}
	if mem.Entries[0].TokensIn != 0 || mem.Entries[0].CostUSD != 0 {
		t.Fatalf("error row should have zero tokens/cost: %+v", mem.Entries[0])
	}
}

func TestUpstreamUnreachable502(t *testing.T) {
	p, mem, _, _ := testSetup(t, mockJSONResponse("x", 1, 1))
	// Point at a dead port after setup.
	t.Setenv("OPENAI_BASE_URL", "http://127.0.0.1:1")
	rec := doProxyRequest(t, p, `{"model":"gpt-4o","messages":[]}`, stdHeaders())
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d", rec.Code)
	}
	if len(mem.Entries) != 1 || mem.Entries[0].StatusCode != 502 {
		t.Fatalf("expected 502 row: %+v", mem.Entries)
	}
}

func TestStreamingPassthrough(t *testing.T) {
	p, mem, m, _ := testSetup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintln(w, `data: {"id":"c1","model":"gpt-4o-mini","choices":[{"delta":{"content":"Hello"}}]}`)
		fmt.Fprintln(w, `data: {"id":"c1","model":"gpt-4o-mini","choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":9,"total_tokens":16}}`)
		fmt.Fprintln(w, `data: [DONE]`)
	})
	rec := doProxyRequest(t, p, `{"model":"gpt-4o-mini","messages":[],"stream":true}`, stdHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Hello") || !strings.Contains(body, "[DONE]") {
		t.Fatalf("chunks not relayed: %q", body)
	}
	if len(mem.Entries) != 1 {
		t.Fatalf("expected 1 row, got %d", len(mem.Entries))
	}
	e := mem.Entries[0]
	if !e.Stream || e.TokensIn != 7 || e.TokensOut != 9 {
		t.Fatalf("bad stream row: %+v", e)
	}
	snap := m.Snapshot()
	if snap.TokensIn != 7 || snap.TokensOut != 9 {
		t.Fatalf("bad metrics: %+v", snap)
	}
}

func TestStreamingWithoutUsageLogsZero(t *testing.T) {
	p, mem, _, _ := testSetup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintln(w, `data: {"choices":[{"delta":{"content":"x"}}]}`)
		fmt.Fprintln(w, `data: [DONE]`)
	})
	rec := doProxyRequest(t, p, `{"model":"gpt-4o-mini","messages":[],"stream":true}`, stdHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if mem.Entries[0].TokensIn != 0 || mem.Entries[0].TokensOut != 0 {
		t.Fatalf("expected zero tokens: %+v", mem.Entries[0])
	}
}

func TestHealthAndMetrics(t *testing.T) {
	p, _, _, _ := testSetup(t, mockJSONResponse("gpt-4o-mini", 3, 4))
	mux := NewMux(p)

	hreq := httptest.NewRequest(http.MethodGet, "/health", nil)
	hrec := httptest.NewRecorder()
	mux.ServeHTTP(hrec, hreq)
	if hrec.Code != 200 || !strings.Contains(hrec.Body.String(), `"ok"`) {
		t.Fatalf("health: %d %s", hrec.Code, hrec.Body.String())
	}

	doProxyRequest(t, p, `{"model":"gpt-4o-mini","messages":[]}`, stdHeaders())

	mreq := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	mrec := httptest.NewRecorder()
	mux.ServeHTTP(mrec, mreq)
	out := mrec.Body.String()
	for _, want := range []string{"agentledger_requests_total 1", "agentledger_tokens_in_total 3", "agentledger_tokens_out_total 4", "agentledger_cost_usd_total", "agentledger_requests_by_model"} {
		if !strings.Contains(out, want) {
			t.Fatalf("metrics missing %q:\n%s", want, out)
		}
	}
}

func TestMetricsSnapshotAvg(t *testing.T) {
	m := NewMetrics()
	if s := m.Snapshot(); s.RequestsTotal != 0 || s.AvgLatencyMs != 0 {
		t.Fatalf("empty snapshot: %+v", s)
	}
	m.Observe("a", "openai", 200, 1, 1, 0.1, 10)
	m.Observe("", "", 500, 0, 0, 0, 20)
	s := m.Snapshot()
	if s.RequestsTotal != 2 || s.AvgLatencyMs != 15 {
		t.Fatalf("snapshot: %+v", s)
	}
	text := m.PrometheusText()
	if !strings.Contains(text, `model="a"`) || !strings.Contains(text, `status="500"`) {
		t.Fatalf("labels missing:\n%s", text)
	}
}

func TestParseHelpers(t *testing.T) {
	u := parseUsageFromJSON([]byte(`{"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`), "m")
	if u.PromptTokens != 2 || u.CompletionTokens != 3 {
		t.Fatalf("got %+v", u)
	}
	if u2 := parseUsageFromJSON([]byte(`{bad`), "m"); u2 != (struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	})(u2) && (u2.PromptTokens != 0) {
		t.Fatal("expected zero usage")
	}
	if _, ok := parseUsageFromSSELine(`: comment`); ok {
		t.Fatal("comments are not usage")
	}
	if _, ok := parseUsageFromSSELine(`data: [DONE]`); ok {
		t.Fatal("DONE is not usage")
	}
	if _, ok := parseUsageFromSSELine(`data: {oops`); ok {
		t.Fatal("bad JSON is not usage")
	}
	if _, ok := parseUsageFromSSELine(`data: {"choices":[]}`); ok {
		t.Fatal("chunk without usage is not usage")
	}
	if u3, ok := parseUsageFromSSELine(`data: {"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`); !ok || u3.PromptTokens != 1 {
		t.Fatalf("got %+v %v", u3, ok)
	}
}

func TestUpstreamURLHelpers(t *testing.T) {
	t.Setenv("OPENAI_BASE_URL", "")
	t.Setenv("GOOGLE_BASE_URL", "")
	if got := UpstreamChatCompletionsURL(ProviderOpenAI); got != "https://api.openai.com/v1/chat/completions" {
		t.Fatalf("got %s", got)
	}
	if got := UpstreamChatCompletionsURL(ProviderGoogle); !strings.Contains(got, "generativelanguage") {
		t.Fatalf("got %s", got)
	}
	t.Setenv("OPENAI_BASE_URL", "http://mock/v1/chat/completions")
	if got := UpstreamChatCompletionsURL(ProviderOpenAI); got != "http://mock/v1/chat/completions" {
		t.Fatalf("override with path should be used as-is, got %s", got)
	}
	if env := UpstreamAPIKeyEnv(ProviderAnthropic); env != "ANTHROPIC_API_KEY" {
		t.Fatalf("got %s", env)
	}
}

func TestPerProviderUpstreamKeyWins(t *testing.T) {
	p, _, _, cap := testSetup(t, mockJSONResponse("claude-3-5-sonnet", 1, 1))
	t.Setenv("ANTHROPIC_API_KEY", "sk-anthropic-real")
	rec := doProxyRequest(t, p, `{"model":"claude-3-5-sonnet","messages":[]}`, stdHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if cap.gotAuth != "Bearer sk-anthropic-real" {
		t.Fatalf("expected per-provider key, got %q", cap.gotAuth)
	}
}

func TestChainOrder(t *testing.T) {
	var order []string
	mk := func(name, header, val string) Middleware {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				order = append(order, name)
				w.Header().Set(header, val)
				next.ServeHTTP(w, r)
			})
		}
	}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		order = append(order, "upstream")
		w.WriteHeader(200)
	})
	h := Chain(inner, mk("enforce", "X-E", "1"), mk("cache", "X-C", "1"), mk("route", "X-R", "1"))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	want := []string{"enforce", "cache", "route", "upstream"}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Fatalf("order = %v, want %v", order, want)
	}
	// And the real stubs preserve the contract order enforce → cache → route.
	p, _, _, _ := testSetup(t, mockJSONResponse("gpt-4o", 1, 1))
	rec := doProxyRequest(t, p, `{"model":"gpt-4o","messages":[]}`, stdHeaders())
	if rec.Header().Get("X-AgentLedger-Enforce") == "" || rec.Header().Get("X-AgentLedger-Cache") == "" || rec.Header().Get("X-AgentLedger-Route") == "" {
		t.Fatal("chain markers missing — order contract broken")
	}
}
