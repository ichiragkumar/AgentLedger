package enforce

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// runPreCheck executes the middleware with a capturing next handler.
func runPreCheck(api *API, headers map[string]string, body string) (*httptest.ResponseRecorder, string, http.Header) {
	var gotBody string
	var gotHdr http.Header
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHdr = r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	api.PreCheck()(next).ServeHTTP(rec, req)
	return rec, gotBody, gotHdr
}

const chatBody = `{"model":"gpt-5.5-pro","messages":[{"role":"user","content":"hello"}]}`

func TestPreCheckAllowPassthrough(t *testing.T) {
	api := NewAPI()
	rec, gotBody, _ := runPreCheck(api, map[string]string{"X-Team-Id": "ai"}, chatBody)
	if rec.Code != 200 || gotBody != chatBody {
		t.Fatalf("code=%d body=%q, want passthrough", rec.Code, gotBody)
	}
	if rec.Header().Get("X-AgentLedger-Enforce") != "enforcing" {
		t.Fatal("missing enforce diagnostic header")
	}
}

func TestPreCheckHardStop429Shape(t *testing.T) {
	api := NewAPI()
	api.Budgets.Upsert(Budget{Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100, SpentUSD: 100})
	rec, gotBody, _ := runPreCheck(api, map[string]string{"X-Team-Id": "ai"}, chatBody)
	if rec.Code != 429 {
		t.Fatalf("code=%d, want 429", rec.Code)
	}
	if gotBody != "" {
		t.Fatal("hard-stopped request must not reach upstream")
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["error"] != "budget_exceeded" || body["budget_id"] != "team:ai:monthly" ||
		body["utilization"] != "100%" || body["reset_at"] == "" {
		t.Fatalf("429 shape wrong: %v", body)
	}
	if _, err := time.Parse(time.RFC3339, body["reset_at"]); err != nil {
		t.Fatalf("reset_at not RFC3339: %v", err)
	}
	if rec.Header().Get(DenyReasonHeader) == "" {
		t.Fatal("missing deny-reason header")
	}
	// Audit must carry the hard stop.
	found := false
	for _, e := range api.Audit.Entries() {
		if e.Action == AuditHardStop && e.BudgetID == "team:ai:monthly" {
			found = true
		}
	}
	if !found {
		t.Fatal("hard stop not audited")
	}
}

func TestPreCheckDowngradeRewritesModel(t *testing.T) {
	api := NewAPI()
	api.Budgets.Upsert(Budget{Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100, SpentUSD: 95})
	rec, gotBody, gotHdr := runPreCheck(api, map[string]string{"X-Team-Id": "ai"}, chatBody)
	if rec.Code != 200 {
		t.Fatalf("downgrade must not drop the call, code=%d body=%s", rec.Code, rec.Body.String())
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(gotBody), &parsed); err != nil {
		t.Fatalf("decode forwarded body: %v", err)
	}
	if parsed["model"] != "claude-sonnet-4" {
		t.Fatalf("forwarded model = %v, want claude-sonnet-4", parsed["model"])
	}
	if gotHdr.Get("X-AgentLedger-Downgraded") != "gpt-5.5-pro->claude-sonnet-4" {
		t.Fatalf("downgrade header = %q", gotHdr.Get("X-AgentLedger-Downgraded"))
	}
	found := false
	for _, e := range api.Audit.Entries() {
		if e.Action == AuditDowngrade {
			found = true
		}
	}
	if !found {
		t.Fatal("downgrade not audited")
	}
}

func TestPreCheckDowngradeNoOpWhenCheapest(t *testing.T) {
	api := NewAPI()
	api.Budgets.Upsert(Budget{Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100, SpentUSD: 95})
	cheap := `{"model":"gemini-2.0-flash","messages":[]}`
	rec, gotBody, _ := runPreCheck(api, map[string]string{"X-Team-Id": "ai"}, cheap)
	if rec.Code != 200 {
		t.Fatalf("code=%d", rec.Code)
	}
	var parsed map[string]interface{}
	_ = json.Unmarshal([]byte(gotBody), &parsed)
	if parsed["model"] != "gemini-2.0-flash" {
		t.Fatalf("cheapest model must pass through, got %v", parsed["model"])
	}
}

func TestPreCheckPolicyDeny403(t *testing.T) {
	api := NewAPI()
	_, err := api.Policies.Put(StoredPolicy{Team: "marketing",
		Config: "policies:\n  - name: no frontier\n    team: marketing\n    deny_models: [gpt-5.5-pro]\n"})
	if err != nil {
		t.Fatalf("put policy: %v", err)
	}
	rec, gotBody, _ := runPreCheck(api, map[string]string{"X-Team-Id": "marketing"}, chatBody)
	if rec.Code != 403 {
		t.Fatalf("code=%d, want 403", rec.Code)
	}
	if gotBody != "" {
		t.Fatal("denied request must not reach upstream")
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] != "policy_denied" || body["reason"] != ReasonModelDenied {
		t.Fatalf("403 shape wrong: %v", body)
	}
}

func TestPreCheckLoopKill429(t *testing.T) {
	api := NewAPI()
	api.Loops = NewTracker(LoopLimits{MaxDepth: 2, MaxTokens: 1 << 30, Window: time.Minute})
	h := map[string]string{"X-Team-Id": "ai", "X-Request-Chain-Id": "loop-1"}
	for i := 0; i < 2; i++ {
		if rec, _, _ := runPreCheck(api, h, chatBody); rec.Code != 200 {
			t.Fatalf("request %d code=%d", i+1, rec.Code)
		}
	}
	rec, _, _ := runPreCheck(api, h, chatBody)
	if rec.Code != 429 {
		t.Fatalf("loop kill code=%d, want 429", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] != "loop_killed" || body["chain_id"] != "loop-1" {
		t.Fatalf("kill shape wrong: %v", body)
	}
}

func TestPreCheckHierarchyMostRestrictiveWins(t *testing.T) {
	api := NewAPI()
	api.Budgets.Upsert(Budget{Level: LevelOrg, Key: "acme", Window: WindowMonthly, DollarLimit: 100000})
	api.Budgets.Upsert(Budget{Level: LevelAgent, Key: "ai/bot", Window: WindowMonthly, DollarLimit: 10, SpentUSD: 10})
	h := map[string]string{"X-Org-Id": "acme", "X-Agent-Id": "ai/bot"}
	rec, _, _ := runPreCheck(api, h, chatBody)
	if rec.Code != 429 {
		t.Fatalf("agent-level stop must win over healthy org, code=%d", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["budget_id"] != "agent:ai/bot:monthly" {
		t.Fatalf("budget_id = %q, want innermost blocker", body["budget_id"])
	}
}

func TestRewriteModelFallback(t *testing.T) {
	if out := rewriteModel([]byte("not json"), "x"); string(out) != "not json" {
		t.Fatal("non-JSON must pass through untouched")
	}
	out := rewriteModel([]byte(`{"model":"a","x":1}`), "b")
	var m map[string]interface{}
	_ = json.Unmarshal(out, &m)
	if m["model"] != "b" || m["x"] != float64(1) {
		t.Fatalf("rewrite = %s", out)
	}
}

func TestAttributionDefaults(t *testing.T) {
	req := httptest.NewRequest("POST", "/", nil)
	a := AttributionFromRequest(req)
	if a.OrgID != DefaultOrgID {
		t.Fatalf("org default = %q", a.OrgID)
	}
	req.Header.Set(HeaderOrgID, "acme")
	if a := AttributionFromRequest(req); a.OrgID != "acme" {
		t.Fatalf("org = %q", a.OrgID)
	}
}
