package proxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/enforce"
)

func testMux() *http.ServeMux {
	mux := http.NewServeMux()
	MountMgmt(mux, enforce.NewAPI(), auth.NewVault(nil))
	return mux
}

func TestKeysIssueListUseRevoke(t *testing.T) {
	mux := testMux()
	// Issue.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/keys", strings.NewReader(`{"name":"e2e","agent_scope":"bot"}`))
	mux.ServeHTTP(rec, req)
	if rec.Code != 201 {
		t.Fatalf("issue = %d: %s", rec.Code, rec.Body.String())
	}
	var issued struct {
		ID   string `json:"id"`
		Key  string `json:"key"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &issued); err != nil || issued.Key == "" {
		t.Fatalf("bad issue body: %s", rec.Body.String())
	}
	// List must NOT contain material.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/keys", nil))
	if rec.Code != 200 || strings.Contains(rec.Body.String(), issued.Key) {
		t.Fatalf("list leaks or fails: %d %s", rec.Code, rec.Body.String())
	}
	// Unknown key → 404 on revoke.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("DELETE", "/v1/keys/nope", nil))
	if rec.Code != 404 {
		t.Fatalf("revoke unknown = %d, want 404", rec.Code)
	}
	// Revoke real.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("DELETE", "/v1/keys/"+issued.ID, nil))
	if rec.Code != 200 {
		t.Fatalf("revoke = %d: %s", rec.Code, rec.Body.String())
	}
}

func TestKeysRotate(t *testing.T) {
	mux := testMux()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/keys", strings.NewReader(`{"name":"r"}`)))
	var issued struct {
		ID  string `json:"id"`
		Key string `json:"key"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &issued)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/keys/"+issued.ID+"/rotate", strings.NewReader(`{}`)))
	if rec.Code != 201 {
		t.Fatalf("rotate = %d: %s", rec.Code, rec.Body.String())
	}
	var rot struct {
		Key string `json:"key"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &rot)
	if rot.Key == "" || rot.Key == issued.Key {
		t.Fatal("rotated key must be fresh material")
	}
}

func TestMgmtBudgetsAlertsAuditMounted(t *testing.T) {
	mux := testMux()
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/v1/budgets", 200},
		{"GET", "/v1/alerts", 200},
		{"GET", "/v1/audit", 200},
		{"GET", "/v1/policies", 200},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != tc.want {
			t.Fatalf("%s %s = %d, want %d: %s", tc.method, tc.path, rec.Code, tc.want, rec.Body.String())
		}
	}
}

func TestMgmtNilSafe(t *testing.T) {
	mux := http.NewServeMux()
	MountMgmt(mux, nil, nil) // must not panic, mounts nothing
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/budgets", nil))
	if rec.Code != 404 {
		t.Fatalf("unmounted = %d, want 404", rec.Code)
	}
}
