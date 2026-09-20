package pricing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const feedPayloadV2 = `{"version":"live-2","currency":"USD","prices":{
	"gemini-2.0-flash":{"input_per_1m":0.09,"output_per_1m":0.36},
	"claude-3-5-haiku":{"input_per_1m":0.80,"output_per_1m":4.00}}}`

func TestFeedDelegatesToRegistry(t *testing.T) {
	f := NewFeed(nil)
	cost, known := f.Cost("gpt-4o-mini", 1_000_000, 1_000_000)
	if !known || cost != 0.75 {
		t.Fatalf("feed cost = %f %v", cost, known)
	}
	if p, ok := f.Get("gpt-4o"); !ok || p.InputPer1M != 2.50 {
		t.Fatalf("feed get = %+v %v", p, ok)
	}
}

func TestFeedUpdateFromBytes(t *testing.T) {
	f := NewFeed(nil)
	if err := f.UpdateFromBytes([]byte(feedPayloadV2), "test"); err != nil {
		t.Fatal(err)
	}
	p, ok := f.Get("gemini-2.0-flash")
	if !ok || p.InputPer1M != 0.09 {
		t.Fatalf("updated price = %+v %v", p, ok)
	}
	src, ver, at := f.Status()
	if src != "test" || ver != "live-2" || at.IsZero() {
		t.Fatalf("status = %q %q %v", src, ver, at)
	}
	if f.StaleSince(time.Hour) {
		t.Fatal("fresh feed must not be stale")
	}
	// Bad payload keeps the last-good table.
	if err := f.UpdateFromBytes([]byte(`{broken`), "bad"); err == nil {
		t.Fatal("expected parse error")
	}
	if _, ok := f.Get("gemini-2.0-flash"); !ok {
		t.Fatal("last-good table must survive bad update")
	}
}

func TestFeedRefreshFromURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(feedPayloadV2))
	}))
	defer srv.Close()

	f := NewFeed(nil)
	if err := f.RefreshFromURL(context.Background(), srv.URL); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.Get("claude-3-5-haiku"); !ok {
		t.Fatal("expected refreshed model")
	}
	if err := f.RefreshFromURL(context.Background(), srv.URL+"/bad"); err == nil {
		t.Fatal("non-200 must error")
	}
	if err := f.RefreshFromURL(context.Background(), "http://127.0.0.1:1/prices"); err == nil {
		t.Fatal("unreachable feed must error")
	}
}

func TestFeedRefreshFromFileAndPolling(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "prices.json")
	if err := os.WriteFile(path, []byte(feedPayloadV2), 0o644); err != nil {
		t.Fatal(err)
	}
	f := NewFeed(nil)
	if err := f.RefreshFromFile(path); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.Get("gemini-2.0-flash"); !ok {
		t.Fatal("expected file-loaded model")
	}
	if err := f.RefreshFromFile(filepath.Join(dir, "missing.json")); err == nil {
		t.Fatal("missing file must error")
	}

	// Polling picks up a swapped file without restart.
	stop := f.StartPolling(path, 10*time.Millisecond, nil)
	defer stop()
	v3 := `{"version":"live-3","currency":"USD","prices":{"poll-model":{"input_per_1m":1,"output_per_1m":2}}}`
	if err := os.WriteFile(path, []byte(v3), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, ok := f.Get("poll-model"); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("polling did not pick up swapped file")
		}
		time.Sleep(10 * time.Millisecond)
	}
	src, ver, _ := f.Status()
	if ver != "live-3" {
		t.Fatalf("version = %q (src %q)", ver, src)
	}
}

func TestFeedStaleWhenNeverRefreshed(t *testing.T) {
	f := NewFeed(nil)
	if !f.StaleSince(time.Hour) {
		t.Fatal("never-refreshed feed must read stale")
	}
}

func TestFeedImplementsPricer(t *testing.T) {
	var _ Pricer = NewFeed(nil)
}
