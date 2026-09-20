package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBatchEligibility(t *testing.T) {
	eligible := http.Header{"X-Agentledger-Batch": {"eligible"}}
	if !IsBatchEligible(eligible, "") {
		t.Fatal("eligible header must queue")
	}
	realtime := http.Header{"X-Agentledger-Batch": {"realtime"}}
	if IsBatchEligible(realtime, "overnight") {
		t.Fatal("explicit realtime must win over task type")
	}
	if !IsBatchEligible(http.Header{}, "overnight") {
		t.Fatal("overnight task_type must be batch-eligible")
	}
	if IsBatchEligible(http.Header{}, "chat") {
		t.Fatal("plain chat must stay realtime")
	}
	if IsBatchEligible(nil, "chat") {
		t.Fatal("nil headers + chat must stay realtime")
	}
}

func TestBatchDiscount50Pct(t *testing.T) {
	if Discounted(10.0) != 5.0 {
		t.Fatalf("batch of $10 = $%f, want $5", Discounted(10.0))
	}
	if DiscountFactor != 0.5 {
		t.Fatal("DiscountFactor must be 0.5")
	}
}

func TestMemoryQueueFIFO(t *testing.T) {
	q := NewMemoryQueue(0)
	if q.Len() != 0 {
		t.Fatal("new queue must be empty")
	}
	for _, id := range []string{"", "", ""} {
		if err := q.Enqueue(Job{ID: id, Model: "m", AgentID: "a"}); err != nil {
			t.Fatal(err)
		}
	}
	if q.Len() != 3 {
		t.Fatalf("Len = %d", q.Len())
	}
	first, ok := q.Dequeue()
	if !ok || first.ID != "batch-1" {
		t.Fatalf("FIFO order broken: %+v", first)
	}
	if _, ok := NewMemoryQueue(1).Dequeue(); ok {
		t.Fatal("empty dequeue must report false")
	}
}

func TestMemoryQueueBounded(t *testing.T) {
	q := NewMemoryQueue(2)
	_ = q.Enqueue(Job{ID: "a"})
	_ = q.Enqueue(Job{ID: "b"})
	if err := q.Enqueue(Job{ID: "c"}); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("overflow err = %v", err)
	}
	if q.Drops() != 1 {
		t.Fatalf("drops = %d", q.Drops())
	}
	// Oldest two still intact.
	if j, _ := q.Dequeue(); j.ID != "a" {
		t.Fatalf("got %q", j.ID)
	}
	var nilQ *MemoryQueue
	if err := nilQ.Enqueue(Job{}); err == nil {
		t.Fatal("nil queue enqueue must error")
	}
	if _, ok := nilQ.Dequeue(); ok {
		t.Fatal("nil queue dequeue must be empty")
	}
	if nilQ.Len() != 0 || nilQ.Drops() != 0 || nilQ.Flush(nil) != nil {
		t.Fatal("nil queue accessors must be zero-safe")
	}
}

func TestFlushRequeuesOnError(t *testing.T) {
	q := NewMemoryQueue(0)
	_ = q.Enqueue(Job{ID: "j1"})
	_ = q.Enqueue(Job{ID: "j2"})
	calls := 0
	err := q.Flush(func(j Job) error {
		calls++
		if j.ID == "j2" {
			return errors.New("send failed")
		}
		return nil
	})
	if err == nil || calls != 2 {
		t.Fatalf("flush err=%v calls=%d", err, calls)
	}
	if q.Len() != 1 {
		t.Fatalf("failed job must be re-queued, Len=%d", q.Len())
	}
	if j, _ := q.Dequeue(); j.ID != "j2" {
		t.Fatalf("head = %q, want j2", j.ID)
	}
	if err := q.Flush(func(j Job) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestWebhookDeliver(t *testing.T) {
	var gotJob string
	var gotResult Result
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotJob = r.Header.Get("X-AgentLedger-Batch-Job")
		if err := json.NewDecoder(r.Body).Decode(&gotResult); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := &Dispatcher{}
	j := Job{ID: "batch-9", WebhookURL: srv.URL}
	err := d.Deliver(context.Background(), j, Result{Output: "done", CostUSD: 4.0})
	if err != nil {
		t.Fatal(err)
	}
	if gotJob != "batch-9" || gotResult.JobID != "batch-9" {
		t.Fatalf("job=%q result=%+v", gotJob, gotResult)
	}
	if gotResult.DiscountedCostUSD != 2.0 {
		t.Fatalf("discounted = %f, want 2.0", gotResult.DiscountedCostUSD)
	}
}

func TestWebhookDeliverNoURLNoop(t *testing.T) {
	d := &Dispatcher{}
	if err := d.Deliver(context.Background(), Job{ID: "x"}, Result{}); err != nil {
		t.Fatalf("empty webhook must be no-op nil, got %v", err)
	}
}

func TestWebhookDeliverBadStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	d := &Dispatcher{}
	if err := d.Deliver(context.Background(), Job{ID: "x", WebhookURL: srv.URL}, Result{}); err == nil {
		t.Fatal("5xx webhook must error")
	}
}

func TestEnqueueStampsIDAndTime(t *testing.T) {
	q := NewMemoryQueue(0)
	before := time.Now().UTC()
	if err := q.Enqueue(Job{Model: "m"}); err != nil {
		t.Fatal(err)
	}
	j, _ := q.Dequeue()
	if j.ID == "" || j.EnqueuedAt.Before(before) {
		t.Fatalf("stamp missing: %+v", j)
	}
}
