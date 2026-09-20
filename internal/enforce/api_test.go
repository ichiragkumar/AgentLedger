package enforce

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testAPI() *API { return NewAPI() }

func doReq(api *API, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	api.RegisterRoutes(mux)
	var rdr *strings.Reader
	if body == "" {
		rdr = strings.NewReader("")
	} else {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rdr)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func adminH() map[string]string {
	return map[string]string{"X-Ledger-Role": "admin", "X-Ledger-Actor": "alice"}
}
func managerH(team string) map[string]string {
	return map[string]string{"X-Ledger-Role": "manager", "X-Ledger-Team": team, "X-Ledger-Actor": "miguel"}
}

func TestBudgetRBACMatrix(t *testing.T) {
	api := testAPI()
	teamBudget := `{"level":"team","key":"ai","window":"monthly","token_limit":1000,"dollar_limit":100}`
	orgBudget := `{"level":"org","key":"acme","window":"monthly","dollar_limit":5000}`

	// viewer: read ok, write denied.
	if rec := doReq(api, "POST", "/v1/budgets", teamBudget, nil); rec.Code != 403 {
		t.Fatalf("viewer POST = %d, want 403", rec.Code)
	}
	// manager: own team ok.
	if rec := doReq(api, "POST", "/v1/budgets", teamBudget, managerH("ai")); rec.Code != 201 {
		t.Fatalf("manager own-team POST = %d, want 201", rec.Code)
	}
	// manager: org denied, other team denied.
	if rec := doReq(api, "POST", "/v1/budgets", orgBudget, managerH("ai")); rec.Code != 403 {
		t.Fatalf("manager org POST = %d, want 403", rec.Code)
	}
	other := `{"level":"team","key":"other","window":"monthly","dollar_limit":10}`
	if rec := doReq(api, "POST", "/v1/budgets", other, managerH("ai")); rec.Code != 403 {
		t.Fatalf("manager cross-team POST = %d, want 403", rec.Code)
	}
	// admin: org ok.
	rec := doReq(api, "POST", "/v1/budgets", orgBudget, adminH())
	if rec.Code != 201 {
		t.Fatalf("admin org POST = %d, want 201", rec.Code)
	}
	// invalid payloads → 400.
	for _, bad := range []string{
		`{}`,
		`{"level":"planet","key":"x","window":"monthly"}`,
		`{"level":"team","key":"x","window":"yearly"}`,
		`{"level":"team","key":"","window":"monthly"}`,
		`{"level":"team","key":"x","window":"monthly","token_limit":-1}`,
		`not json`,
	} {
		if rec := doReq(api, "POST", "/v1/budgets", bad, adminH()); rec.Code != 400 {
			t.Fatalf("bad budget %q = %d, want 400", bad, rec.Code)
		}
	}
	// GET one + 404.
	if rec := doReq(api, "GET", "/v1/budgets/team:ai:monthly", "", nil); rec.Code != 200 {
		t.Fatalf("GET budget = %d", rec.Code)
	}
	if rec := doReq(api, "GET", "/v1/budgets/nope", "", nil); rec.Code != 404 {
		t.Fatalf("GET missing = %d, want 404", rec.Code)
	}
	// Manager cannot DELETE org budget; admin can.
	if rec := doReq(api, "DELETE", "/v1/budgets/org:acme:monthly", "", managerH("ai")); rec.Code != 403 {
		t.Fatalf("manager delete org = %d, want 403", rec.Code)
	}
	if rec := doReq(api, "DELETE", "/v1/budgets/org:acme:monthly", "", adminH()); rec.Code != 200 {
		t.Fatalf("admin delete org = %d", rec.Code)
	}
}

func TestBudgetRaisePreservesSpentResume(t *testing.T) {
	// E2E core: hard-stopped budget is raised via API → traffic resumes.
	api := testAPI()
	api.Budgets.Upsert(Budget{ID: "team:ai:monthly", Level: LevelTeam, Key: "ai",
		Window: WindowMonthly, DollarLimit: 100, SpentUSD: 100})
	attr := Attribution{TeamID: "ai"}
	if got := WorstAction(api.Budgets.Check(attr)); got != ActionHardStop {
		t.Fatalf("pre-raise = %v, want hard_stop", got)
	}
	raise := `{"level":"team","key":"ai","window":"monthly","token_limit":0,"dollar_limit":200}`
	rec := doReq(api, "PUT", "/v1/budgets/team:ai:monthly", raise, adminH())
	if rec.Code != 200 {
		t.Fatalf("raise = %d", rec.Code)
	}
	var b Budget
	if err := json.NewDecoder(rec.Body).Decode(&b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.SpentUSD != 100 || b.DollarLimit != 200 {
		t.Fatalf("raise must preserve spent: %+v", b)
	}
	if got := WorstAction(api.Budgets.Check(attr)); got != ActionAlert {
		t.Fatalf("post-raise = %v, want alert (50%% crossed, traffic resumes)", got)
	}
}

func TestPolicyCRUDRBAC(t *testing.T) {
	api := testAPI()
	cfg := "policies:\n  - name: cheap only\n    team: support\n    allow_models: [gemini-2.0-flash]\n"
	body := `{"name":"cheap only","team":"support","config":` + jsonQuote(cfg) + `}`
	// viewer denied, wrong-team manager denied, own-team manager allowed.
	if rec := doReq(api, "POST", "/v1/policies", body, nil); rec.Code != 403 {
		t.Fatalf("viewer POST policy = %d", rec.Code)
	}
	if rec := doReq(api, "POST", "/v1/policies", body, managerH("ai")); rec.Code != 403 {
		t.Fatalf("cross-team POST policy = %d", rec.Code)
	}
	rec := doReq(api, "POST", "/v1/policies", body, managerH("support"))
	if rec.Code != 201 {
		t.Fatalf("own-team POST policy = %d", rec.Code)
	}
	var stored StoredPolicy
	if err := json.NewDecoder(rec.Body).Decode(&stored); err != nil || stored.ID == "" {
		t.Fatalf("stored = %+v err=%v", stored, err)
	}
	// Merged engine actually enforces the new policy.
	res := api.Policies.Engine().Eval(PolicyRequest{Model: "gpt-4o", Team: "support", HourUTC: 12})
	if res.Allow || res.Reason != ReasonModelNotAllowed {
		t.Fatalf("merged engine = %+v, want deny", res)
	}
	// Bad YAML config → 400.
	bad := `{"name":"bad","team":"support","config":"policies:\n  - name: r\n    max_tokens_per_request: lots\n"}`
	if rec := doReq(api, "POST", "/v1/policies", bad, managerH("support")); rec.Code != 400 {
		t.Fatalf("bad config = %d, want 400", rec.Code)
	}
	// Update + delete round-trip.
	upd := `{"name":"cheap only","team":"support","config":` + jsonQuote(cfg) + `}`
	if rec := doReq(api, "PUT", "/v1/policies/"+stored.ID, upd, managerH("support")); rec.Code != 200 {
		t.Fatalf("PUT policy = %d", rec.Code)
	}
	if rec := doReq(api, "GET", "/v1/policies/"+stored.ID, "", nil); rec.Code != 200 {
		t.Fatalf("GET policy = %d", rec.Code)
	}
	if rec := doReq(api, "DELETE", "/v1/policies/"+stored.ID, "", adminH()); rec.Code != 200 {
		t.Fatalf("DELETE policy = %d", rec.Code)
	}
	if rec := doReq(api, "GET", "/v1/policies/"+stored.ID, "", nil); rec.Code != 404 {
		t.Fatalf("GET deleted = %d, want 404", rec.Code)
	}
}

func jsonQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestAlertCRUD(t *testing.T) {
	api := testAPI()
	api.Budgets.Upsert(Budget{ID: "team:ai:monthly", Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100})
	body := `{"budget_id":"team:ai:monthly","channels":["webhook","slack"],"target":"https://hooks.test/x"}`
	if rec := doReq(api, "POST", "/v1/alerts", body, nil); rec.Code != 403 {
		t.Fatalf("viewer POST alert = %d", rec.Code)
	}
	rec := doReq(api, "POST", "/v1/alerts", body, managerH("ai"))
	if rec.Code != 201 {
		t.Fatalf("manager POST alert = %d", rec.Code)
	}
	var c AlertConfig
	if err := json.NewDecoder(rec.Body).Decode(&c); err != nil || c.ID == "" {
		t.Fatalf("stored = %+v", c)
	}
	if rec := doReq(api, "GET", "/v1/alerts", "", nil); rec.Code != 200 {
		t.Fatalf("GET alerts = %d", rec.Code)
	}
	// Cross-team manager cannot delete.
	if rec := doReq(api, "DELETE", "/v1/alerts/"+c.ID, "", managerH("other")); rec.Code != 403 {
		t.Fatalf("cross-team DELETE = %d, want 403", rec.Code)
	}
	if rec := doReq(api, "DELETE", "/v1/alerts/"+c.ID, "", managerH("ai")); rec.Code != 200 {
		t.Fatalf("DELETE alert = %d", rec.Code)
	}
	if rec := doReq(api, "POST", "/v1/alerts", `{"channels":[]}`, managerH("ai")); rec.Code != 400 {
		t.Fatalf("bad alert = %d, want 400", rec.Code)
	}
}

func TestAuditChainAndTamper(t *testing.T) {
	api := testAPI()
	api.Audit.Append("alice", AuditBudgetCreate, "b1", "created")
	api.Audit.Append("alice", AuditBudgetUpdate, "b1", "raised")
	if err := api.Audit.Verify(); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if n := len(api.Audit.Entries()); n != 2 {
		t.Fatalf("entries = %d", n)
	}
	// Tamper → Verify fails.
	api.Audit.mu.Lock()
	api.Audit.entries[0].Detail = "forged"
	api.Audit.mu.Unlock()
	if err := api.Audit.Verify(); err == nil {
		t.Fatal("tampered chain must fail Verify")
	}
	// GET /v1/audit exposes entries (viewer-readable).
	rec := doReq(api, "GET", "/v1/audit", "", nil)
	if rec.Code != 200 {
		t.Fatalf("GET audit = %d", rec.Code)
	}
}

func TestObserveRecordsAlertsAndAudit(t *testing.T) {
	api := testAPI()
	rec := NewRecordSender(ChannelWebhook)
	api.Alerter = NewDispatcher(rec)
	api.Budgets.Upsert(Budget{Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100})
	ds := api.Observe(Attribution{TeamID: "ai"}, "chain-1", 500, 80)
	if WorstAction(ds) != ActionAlert {
		t.Fatalf("worst = %v", WorstAction(ds))
	}
	// Alert fan-out is async: poll briefly (bound is 60s, lands in ms).
	sent := 0
	for i := 0; i < 2000; i++ {
		sent = len(rec.Alerts())
		if sent >= 2 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if sent < 2 {
		t.Fatalf("alerts sent = %d, want ≥2 (50+75)", sent)
	}
	found := false
	for _, e := range api.Audit.Entries() {
		if e.Action == AuditAlertFire {
			found = true
		}
	}
	if !found {
		t.Fatal("Observe must audit alert fires")
	}
	if d, tk, ok := api.Loops.Check("chain-1"); !ok || tk != 500 || d != 0 {
		t.Fatalf("loop tokens = (%d,%d,%v), want depth 0 + 500 tokens", d, tk, ok)
	}
}

func TestActorDefaults(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	a := ActorFromRequest(req)
	if a.Role != RoleViewer || !a.CanRead() || a.CanWriteBudget(LevelTeam, "ai") {
		t.Fatalf("default actor = %+v", a)
	}
	mgr := Actor{Role: RoleManager, TeamID: "ai"}
	if !mgr.CanWritePolicy("ai") || mgr.CanWritePolicy("other") || mgr.CanWritePolicy("*") {
		t.Fatal("manager policy scope wrong")
	}
	if !mgr.CanWriteBudget(LevelAgent, "ai/bot") || mgr.CanWriteBudget(LevelOrg, "acme") {
		t.Fatal("manager budget scope wrong")
	}
	admin := Actor{Role: RoleAdmin}
	if !admin.CanWriteBudget(LevelOrg, "acme") || !admin.CanWritePolicy("*") {
		t.Fatal("admin must write all")
	}
}
