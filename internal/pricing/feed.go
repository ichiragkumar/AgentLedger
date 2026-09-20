// Live price feed (Phase 3, spec 06 task 3.9).
//
// This file EXTENDS the Mirror price registry — it never modifies
// registry.go. Feed owns a *Registry behind an RWMutex and atomically swaps
// it on refresh, so readers (proxy cost math, router savings) never block
// and never see a half-written table. Failed refreshes keep serving the
// last-good table; staleness is observable via Status().
//
// Sources: provider/curated JSON over HTTP (RefreshFromURL, same FileFormat
// shape as data/prices.json) or a file swapped by a cron/sidecar
// (RefreshFromFile, StartPolling). Feed implements Pricer, so it drops in
// wherever *Registry is used today.
package pricing

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

// Feed is a self-refreshing price table. The zero value is unusable;
// construct with NewFeed.
type Feed struct {
	mu        sync.RWMutex
	reg       *Registry
	source    string
	updatedAt time.Time
	// client performs feed fetches (override in tests with httptest URLs).
	client *http.Client
}

// NewFeed wraps reg (nil → NewDefault()) as a refreshable feed.
func NewFeed(reg *Registry) *Feed {
	if reg == nil {
		reg = NewDefault()
	}
	return &Feed{reg: reg, client: &http.Client{Timeout: 15 * time.Second}}
}

// Cost implements Pricer against the current table (hot-path safe).
func (f *Feed) Cost(model string, promptTokens, completionTokens int) (float64, bool) {
	f.mu.RLock()
	r := f.reg
	f.mu.RUnlock()
	if r == nil {
		return DefaultFallbackCost(promptTokens, completionTokens), false
	}
	return r.Cost(model, promptTokens, completionTokens)
}

// Get implements Pricer lookup against the current table.
func (f *Feed) Get(model string) (ModelPrice, bool) {
	f.mu.RLock()
	r := f.reg
	f.mu.RUnlock()
	if r == nil {
		return DefaultFallback, false
	}
	return r.Get(model)
}

// DefaultFallbackCost prices tokens at the fallback rate (exported for
// callers that must quote before the first successful refresh).
func DefaultFallbackCost(promptTokens, completionTokens int) float64 {
	return float64(promptTokens)/1e6*DefaultFallback.InputPer1M +
		float64(completionTokens)/1e6*DefaultFallback.OutputPer1M
}

// UpdateFromBytes parses FileFormat JSON and swaps the table. Version "" is
// accepted (keeps the previous version label); parse errors leave the
// current table untouched.
func (f *Feed) UpdateFromBytes(data []byte, source string) error {
	next, err := LoadFromBytes(data)
	if err != nil {
		return fmt.Errorf("pricing: feed update from %s: %w", source, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if next.Version() == "" && f.reg != nil {
		// Preserve version label when the payload omits it.
		next.version = f.reg.version
	}
	f.reg = next
	f.source = source
	f.updatedAt = time.Now().UTC()
	return nil
}

// RefreshFromURL GETs FileFormat JSON from url (context-bounded) and swaps
// the table. Non-200s and parse errors keep the last-good table.
func (f *Feed) RefreshFromURL(ctx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("pricing: feed request %s: %w", url, err)
	}
	req.Header.Set("Accept", "application/json")
	client := f.client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("pricing: feed fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pricing: feed fetch %s: status %d", url, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4MB cap
	if err != nil {
		return fmt.Errorf("pricing: feed read %s: %w", url, err)
	}
	return f.UpdateFromBytes(data, url)
}

// RefreshFromFile reloads a FileFormat JSON file (sidecar drop path).
func (f *Feed) RefreshFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("pricing: feed read %s: %w", path, err)
	}
	return f.UpdateFromBytes(data, "file:"+path)
}

// Status reports the active source, registry version, and last refresh time
// (dashboard "prices current as of" + staleness alerts).
func (f *Feed) Status() (source, version string, updatedAt time.Time) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	v := ""
	if f.reg != nil {
		v = f.reg.Version()
	}
	return f.source, v, f.updatedAt
}

// StaleSince reports whether the table is older than maxAge (true when never
// refreshed). Operators alert on stale feeds; the proxy keeps serving.
func (f *Feed) StaleSince(maxAge time.Duration) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if f.updatedAt.IsZero() {
		return true
	}
	return time.Since(f.updatedAt) > maxAge
}

// StartPolling re-reads path every interval until stop() is called.
// Failures are reported to onErr (may be nil); the last-good table keeps
// serving. Polling is stdlib-only by design (no fsnotify dependency).
func (f *Feed) StartPolling(path string, interval time.Duration, onErr func(error)) (stop func()) {
	if f == nil || interval <= 0 {
		return func() {}
	}
	done := make(chan struct{})
	var once sync.Once
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				if err := f.RefreshFromFile(path); err != nil && onErr != nil {
					onErr(err)
				}
			}
		}
	}()
	return func() { once.Do(func() { close(done) }) }
}
