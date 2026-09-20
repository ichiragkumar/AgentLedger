package enforce

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDispatcherDedupePerWindow(t *testing.T) {
	rec := NewRecordSender(ChannelWebhook)
	d := NewDispatcher(rec)
	a := Alert{BudgetID: "b", Level: LevelTeam, Threshold: 75, Utilization: 76, ResetAt: time.Now().Add(time.Hour)}
	d.Dispatch(a)
	d.Dispatch(a) // duplicate must be swallowed
	if len(rec.Alerts()) != 1 {
		t.Fatalf("sent = %d, want 1 (dedupe)", len(rec.Alerts()))
	}
	if d.ShouldFire("b", 75, a.ResetAt) {
		t.Fatal("ShouldFire must be false after fire")
	}
	if !d.ShouldFire("b", 90, a.ResetAt) {
		t.Fatal("ShouldFire must be true for a new threshold")
	}
}

func TestDispatchDecisionsFansOut(t *testing.T) {
	w, s := NewRecordSender(ChannelWebhook), NewRecordSender(ChannelSlack)
	d := NewDispatcher(w, s)
	ds := []Decision{{
		BudgetID: "team:ai:monthly", Level: LevelTeam,
		Utilization: 91, Action: ActionDowngrade,
		Alerts:  []float64{50, 75, 90},
		ResetAt: time.Now().Add(time.Hour),
	}}
	results := d.DispatchDecisions(ds)
	if len(results) != 3 {
		t.Fatalf("dispatches = %d, want 3 (one per threshold)", len(results))
	}
	for _, r := range results {
		for _, rr := range r {
			if rr.Err != nil {
				t.Fatalf("sender %s failed: %v", rr.Channel, rr.Err)
			}
		}
	}
	if len(w.Alerts()) != 3 || len(s.Alerts()) != 3 {
		t.Fatalf("webhook=%d slack=%d, want 3/3", len(w.Alerts()), len(s.Alerts()))
	}
	// Second pass: all deduped, nothing new.
	if again := d.DispatchDecisions(ds); len(again) != 0 {
		t.Fatalf("re-dispatch = %d, want 0", len(again))
	}
}

func TestWebhookSenderPostsJSON(t *testing.T) {
	var gotBody, gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get("Content-Type")
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.WriteHeader(200)
	}))
	defer srv.Close()
	s := &WebhookSender{URL: srv.URL, Client: srv.Client()}
	err := s.Send(context.Background(), Alert{BudgetID: "b", Threshold: 50, Utilization: 51, ResetAt: time.Now()})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if gotCT != "application/json" || len(gotBody) == 0 {
		t.Fatalf("ct=%q body=%q", gotCT, gotBody)
	}
	if s.Channel() != ChannelWebhook {
		t.Fatalf("channel = %v", s.Channel())
	}
}

func TestWebhookSenderSurfaces5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()
	s := &WebhookSender{URL: srv.URL, Client: srv.Client()}
	if err := s.Send(context.Background(), Alert{BudgetID: "b"}); err == nil {
		t.Fatal("5xx must return error")
	}
}

func TestSlackAndEmailSenders(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		got = string(buf[:n])
		w.WriteHeader(200)
	}))
	defer srv.Close()
	sl := &SlackSender{WebhookURL: srv.URL, Client: srv.Client()}
	if err := sl.Send(context.Background(), Alert{BudgetID: "team:ai", Threshold: 90, Utilization: 91}); err != nil {
		t.Fatalf("slack: %v", err)
	}
	if len(got) == 0 || sl.Channel() != ChannelSlack {
		t.Fatalf("slack body=%q", got)
	}
	var sb bytes.Buffer
	em := &EmailSender{To: "cfo@acme.test", From: "al@acme.test", Out: &sb}
	if err := em.Send(context.Background(), Alert{BudgetID: "team:ai", Threshold: 75, Utilization: 76}); err != nil {
		t.Fatalf("email: %v", err)
	}
	if em.Channel() != ChannelEmail || sb.Len() == 0 {
		t.Fatal("email stub must render to writer")
	}
}

func TestRecordSenderFailure(t *testing.T) {
	rec := NewRecordSender(ChannelEmail)
	rec.Fail = errors.New("boom")
	if err := rec.Send(context.Background(), Alert{}); err == nil || err.Error() != "boom" {
		t.Fatalf("want injected failure, got %v", err)
	}
	if len(rec.Alerts()) != 0 {
		t.Fatal("failed sends must not be recorded")
	}
}
