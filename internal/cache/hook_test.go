package cache

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const hookBody = `{"model":"gpt-4o","messages":[{"role":"user","content":"how do I reset my password"}],"temperature":0.7}`

// upstreamFunc is a controllable fake provider.
type upstreamFunc struct {
	calls int
	body  string
	code  int
	ctype string
	got   []byte
}

func (u *upstreamFunc) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.calls++
		u.got, _ = io.ReadAll(r.Body)
		if u.ctype != "" {
			w.Header().Set("Content-Type", u.ctype)
		} else {
			w.Header().Set("Content-Type", "application/json")
		}
		code := u.code
		if code == 0 {
			code = http.StatusOK
		}
		w.WriteHeader(code)
		b := u.body
		if b == "" {
			b = `{"model":"gpt-4o","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"choices":[{"message":{"role":"assistant","content":"click reset"}}]}`
		}
		_, _ = w.Write([]byte(b))
	})
}

func testHook() *Hook {
	cfg := DefaultConfig()
	cfg.DefaultTTL = time.Hour
	h := NewHook(cfg, NewHashEmbedder(64))
	h.Cost = func(model string, in, out int) (float64, bool) {
		return 0.001 * float64(in+out), true
	}
	return h
}

func TestHookMissThenExactHit(t *testing.T) {
	h := testHook()
	up := &upstreamFunc{}
	next := up.handler()

	// First request: MISS, provider round-trip, response stored.
	r1 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	recA := httptest.NewRecorder()
	h.Serve(recA, r1, next)
	if up.calls != 1 {
		t.Fatalf("first request must reach provider, calls=%d", up.calls)
	}
	if got := recA.Header().Get(CacheHeader); got != ValueMiss {
		t.Fatalf("miss header: %q", got)
	}
	if string(up.got) != hookBody {
		t.Fatal("upstream must receive the body verbatim")
	}
	first := recA.Body.Bytes()

	// Identical replay → exact HIT, provider untouched.
	r2 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	recB := httptest.NewRecorder()
	h.Serve(recB, r2, next)
	if up.calls != 1 {
		t.Fatal("exact hit must skip upstream")
	}
	res := recB.Result()
	if res.Header.Get(CacheHeader) != ValueHit || res.Header.Get(CacheLayerHeader) != LayerExact {
		t.Fatalf("hit headers: %v", res.Header)
	}
	if !bytes.Equal(recB.Body.Bytes(), first) {
		t.Fatal("replay must be byte-identical to the live response")
	}
	if res.Header.Get(SavedUSDHeader) == "" {
		t.Fatal("hit must report saved usd")
	}
	snap := h.Stats.Snapshot()
	if snap.ExactHits != 1 || snap.Misses != 1 || snap.Stored != 1 {
		t.Fatalf("stats: %+v", snap)
	}
	if snap.SavedUSD <= 0 {
		t.Fatal("savings must accumulate")
	}
}

func TestHookBypassAlwaysHitsProvider(t *testing.T) {
	h := testHook()
	up := &upstreamFunc{}
	next := up.handler()
	// Prime the cache.
	r0 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	h.Serve(httptest.NewRecorder(), r0, next)
	if up.calls != 1 {
		t.Fatal("prime must call provider once")
	}
	// Bypass header: provider every time despite a stored entry.
	for _, v := range []string{"true", "1"} {
		r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
		r.Header.Set(BypassHeader, v)
		rec := httptest.NewRecorder()
		h.Serve(rec, r, next)
		if rec.Header().Get(CacheHeader) != ValueMiss {
			t.Fatalf("bypass must MISS, got %q", rec.Header().Get(CacheHeader))
		}
	}
	if up.calls != 3 {
		t.Fatalf("bypass must hit provider every time, calls=%d", up.calls)
	}
	// Falsy value does NOT bypass (exact hit resumes).
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	r.Header.Set(BypassHeader, "false")
	rec := httptest.NewRecorder()
	h.Serve(rec, r, next)
	if rec.Header().Get(CacheHeader) != ValueHit || up.calls != 3 {
		t.Fatal("false must not bypass")
	}
}

func TestHookGuardSkipsStore(t *testing.T) {
	h := testHook()
	up := &upstreamFunc{}
	next := up.handler()
	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"email jane@example.com my invoice"}]}`
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.Serve(rec, r, next)
		if rec.Header().Get(CacheHeader) != ValueMiss {
			t.Fatal("guard skip must MISS")
		}
		if !strings.HasPrefix(rec.Header().Get(CacheReasonHeader), "guard:") {
			t.Fatalf("guard reason: %q", rec.Header().Get(CacheReasonHeader))
		}
	}
	if up.calls != 2 {
		t.Fatalf("guard-skipped prompts must never be stored, calls=%d", up.calls)
	}
}

func TestHookSemanticHit(t *testing.T) {
	h := testHook()
	up := &upstreamFunc{}
	next := up.handler()

	// Store a semantic vector under a DIFFERENT exact key so the exact
	// layer misses but cosine similarity is 1.0 (deterministic admit).
	bodyB := `{"model":"gpt-4o","messages":[{"role":"user","content":"explain cache eviction policies"}]}`
	var req parsedRequest
	if err := json.Unmarshal([]byte(bodyB), &req); err != nil {
		t.Fatal(err)
	}
	vec, err := h.Semantic.embedder.Embed(context.Background(), PromptText(req.Model, req.Messages))
	if err != nil {
		t.Fatal(err)
	}
	h.Semantic.StoreWithVector("other-key", Entry{
		Model: "gpt-4o", ResponseBody: []byte(`{"cached":"semantic-win"}`),
		StatusCode: 200, ContentType: "application/json", CostUSD: 0.004,
		CreatedAt: time.Now(),
	}, vec, time.Hour)

	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(bodyB))
	rec := httptest.NewRecorder()
	h.Serve(rec, r, next)
	if up.calls != 0 {
		t.Fatal("semantic hit must skip upstream")
	}
	res := rec.Result()
	if res.Header.Get(CacheHeader) != ValueHit || res.Header.Get(CacheLayerHeader) != LayerSemantic {
		t.Fatalf("semantic headers: %v", res.Header)
	}
	if res.Header.Get(SimilarityHeader) == "" {
		t.Fatal("semantic hit must report similarity")
	}
	if rec.Body.String() != `{"cached":"semantic-win"}` {
		t.Fatalf("semantic body: %q", rec.Body.String())
	}
	if h.Stats.Snapshot().SemanticHits != 1 {
		t.Fatal("semantic stats must record")
	}
}

func TestHookSSEReplayByteCompatible(t *testing.T) {
	h := testHook()
	up := &upstreamFunc{}
	rawSSE := "data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n"
	key := KeyFor("gpt-4o", []Message{{Role: "user", Content: "stream me"}}, nil)
	h.Exact.Store(Entry{
		Key: key, Model: "gpt-4o", StatusCode: 200,
		ContentType: "text/event-stream", Stream: true,
		ResponseBody: []byte(rawSSE), CostUSD: 0.002, CreatedAt: time.Now(),
	})
	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"stream me"}],"stream":true}`
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Serve(rec, r, up.handler())
	if up.calls != 0 {
		t.Fatal("stream hit must skip upstream")
	}
	if rec.Body.String() != rawSSE {
		t.Fatalf("SSE replay must be byte-identical:\n%q\nvs\n%q", rec.Body.String(), rawSSE)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type: %q", ct)
	}
}

func TestHookPassthroughCases(t *testing.T) {
	h := testHook()
	up := &upstreamFunc{}
	next := up.handler()

	// Unparsable body.
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("not json{{"))
	rec := httptest.NewRecorder()
	h.Serve(rec, r, next)
	if up.calls != 1 || rec.Header().Get(CacheHeader) != ValueMiss {
		t.Fatal("unparsable must passthrough MISS")
	}
	// Missing model.
	r = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"messages":[]}`))
	rec = httptest.NewRecorder()
	h.Serve(rec, r, next)
	if up.calls != 2 {
		t.Fatal("model-less must passthrough")
	}
	// Non-200 never stored.
	up.code = http.StatusBadGateway
	up.body = `{"error":"boom"}`
	r = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	h.Serve(httptest.NewRecorder(), r, next)
	up.code, up.body = 0, ""
	r = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	h.Serve(httptest.NewRecorder(), r, next)
	if up.calls != 4 {
		t.Fatalf("error responses must not be stored, calls=%d", up.calls)
	}
	// GET passthrough (hook only handles POST).
	up.calls = 0
	rg := httptest.NewRequest(http.MethodGet, "/v1/chat/completions", nil)
	h.Serve(httptest.NewRecorder(), rg, next)
	if up.calls != 1 {
		t.Fatal("GET must passthrough")
	}
	// Disabled hook is fully transparent.
	h.Config.Enabled = false
	rd := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(hookBody))
	recd := httptest.NewRecorder()
	h.Serve(recd, rd, next)
	if recd.Header().Get(CacheHeader) != "" {
		t.Fatal("disabled hook must not touch headers")
	}
	h.Config.Enabled = true
}

func TestHookBodyTooLargeKeepsBodyIntact(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MaxBodyBytes = 32
	h := NewHook(cfg, NewHashEmbedder(16))
	up := &upstreamFunc{}
	next := up.handler()
	big := `{"model":"gpt-4o","messages":[{"role":"user","content":"this body is definitely longer than thirty-two bytes"}]}`
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(big))
	rec := httptest.NewRecorder()
	h.Serve(rec, r, next)
	if rec.Header().Get(CacheReasonHeader) != "body-too-large" {
		t.Fatalf("reason: %q", rec.Header().Get(CacheReasonHeader))
	}
	if string(up.got) != big {
		t.Fatal("oversize body must reach upstream intact")
	}
	if h.Exact.Size() != 0 {
		t.Fatal("oversize bodies must not be stored")
	}
}

func TestSynthesizeAndReplaySSE(t *testing.T) {
	jsonBody := []byte(`{"choices":[{"message":{"content":"hi"}}]}`)
	sse := SynthesizeSSE(jsonBody, "gpt-4o")
	if !bytes.HasPrefix(sse, []byte("data: ")) || !bytes.HasSuffix(sse, []byte("data: [DONE]\n\n")) {
		t.Fatalf("framing: %q", sse)
	}
	w := httptest.NewRecorder()
	ReplaySSE(w, sse)
	res := w.Result()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("ct: %q", ct)
	}
	if !bytes.Equal(w.Body.Bytes(), sse) {
		t.Fatal("ReplaySSE must write bytes verbatim")
	}
}

func TestParseUsageShapes(t *testing.T) {
	u := parseUsage([]byte(`{"usage":{"prompt_tokens":3,"completion_tokens":7}}`))
	if u.prompt != 3 || u.completion != 7 {
		t.Fatalf("json usage: %+v", u)
	}
	sse := "data: {\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n"
	u = parseUsage([]byte(sse))
	if u.prompt != 4 || u.completion != 1 {
		t.Fatalf("sse usage: %+v", u)
	}
	if u := parseUsage(nil); u.prompt != 0 || u.completion != 0 {
		t.Fatal("empty usage zeroes")
	}
	if u := parseUsage([]byte("garbage")); u.prompt != 0 {
		t.Fatal("garbage usage zeroes")
	}
}

func TestCacheHookAndMiddlewareShape(t *testing.T) {
	// CacheHook matches proxy.Middleware: func(http.Handler) http.Handler.
	var mw func(http.Handler) http.Handler = CacheHook
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	body := `{"model":"unique-model-cachehook-smoke","messages":[{"role":"user","content":"ping"}]}`
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	rec := httptest.NewRecorder()
	mw(next).ServeHTTP(rec, r)
	if rec.Code != http.StatusOK || rec.Header().Get(CacheHeader) != ValueMiss {
		t.Fatalf("smoke: %d %v", rec.Code, rec.Header())
	}
	// Same-shape middleware adapter on a Hook.
	h := testHook()
	var mw2 func(http.Handler) http.Handler = h.Middleware
	r2 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	rec2 := httptest.NewRecorder()
	mw2(next).ServeHTTP(rec2, r2)
	if rec2.Code != http.StatusOK {
		t.Fatal("hook middleware must serve")
	}
	// Nil-hook Serve is a safe passthrough.
	var nilHook *Hook
	r3 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	rec3 := httptest.NewRecorder()
	nilHook.Serve(rec3, r3, next)
	if rec3.Code != http.StatusOK {
		t.Fatal("nil hook must passthrough")
	}
	// captureWriter defaults status 200 when Write comes first.
	cw := &captureWriter{ResponseWriter: httptest.NewRecorder(), status: http.StatusOK}
	_, _ = cw.Write([]byte("x"))
	if cw.status != http.StatusOK || cw.buf.String() != "x" {
		t.Fatal("capture defaults")
	}
}
