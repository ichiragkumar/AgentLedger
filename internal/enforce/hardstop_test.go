package enforce

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHardStopBodyShape(t *testing.T) {
	reset := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	rec := httptest.NewRecorder()
	WriteHardStop(rec, "team:ai:monthly", 100, reset)
	res := rec.Result()
	if res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", res.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := map[string]string{
		"error":       "budget_exceeded",
		"budget_id":   "team:ai:monthly",
		"utilization": "100%",
		"reset_at":    "2026-10-01T00:00:00Z",
	}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("body[%q] = %q, want %q (full body %v)", k, body[k], v, body)
		}
	}
	if len(body) != 4 {
		t.Errorf("body has %d keys, want exactly 4 %v", len(body), body)
	}
	if res.Header.Get("Content-Type") != "application/json" {
		t.Errorf("content-type = %q", res.Header.Get("Content-Type"))
	}
	if res.Header.Get(DenyReasonHeader) == "" {
		t.Error("missing X-AgentLedger-Deny-Reason header")
	}
	if res.Header.Get("Retry-After") == "" {
		t.Error("missing Retry-After header")
	}
}

func TestHardStopOvershootRounds(t *testing.T) {
	b := NewHardStopBody("x", 104.2, time.Now())
	if b.Utilization != "104%" {
		t.Fatalf("util = %q, want 104%%", b.Utilization)
	}
	if b.Error != ErrBudgetExceeded || StatusBudgetExceeded != 429 {
		t.Fatal("error code/status constants wrong")
	}
}

func TestIsHardStop(t *testing.T) {
	if !IsHardStop(100) || !IsHardStop(150) {
		t.Fatal("100+ must hard stop")
	}
	if IsHardStop(99.9) {
		t.Fatal("99.9 must not hard stop")
	}
}
