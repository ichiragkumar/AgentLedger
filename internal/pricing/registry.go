// Package pricing implements the JSON price registry + cost calculator.
//
// Contract for downstream agents (Router Phase 3 reuses this):
//   - Pricer interface is stable.
//   - Cost() takes provider usage verbatim; never estimates.
//   - Unknown models fall back to a default rate with Known=false so the
//     invoice-reconciliation job can flag them (goal: invoice ±5%).
//
// Auto-update stub: Registry.Reload(path) re-reads data/prices.json without
// restart. A cron/sidecar can swap the file (future: live price feed).
package pricing

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

// ModelPrice is USD per 1M tokens.
type ModelPrice struct {
	InputPer1M  float64 `json:"input_per_1m"`
	OutputPer1M float64 `json:"output_per_1m"`
}

// FileFormat is the on-disk shape of data/prices.json.
type FileFormat struct {
	Version  string                `json:"version"`
	Currency string                `json:"currency"`
	Prices   map[string]ModelPrice `json:"prices"`
}

// Pricer is the reusable interface for Router/Enforcer.
type Pricer interface {
	Cost(model string, promptTokens, completionTokens int) (costUSD float64, known bool)
	Get(model string) (ModelPrice, bool)
}

// Registry is a concurrency-safe in-memory price table.
type Registry struct {
	mu       sync.RWMutex
	version  string
	currency string
	prices   map[string]ModelPrice
}

// DefaultFallback is used when a model is missing (flagged via known=false).
var DefaultFallback = ModelPrice{InputPer1M: 2.50, OutputPer1M: 10.00}

func New() *Registry {
	return NewWithPrices(map[string]ModelPrice{})
}

// NewWithPrices builds a registry from an explicit map (tests, defaults).
func NewWithPrices(m map[string]ModelPrice) *Registry {
	cp := make(map[string]ModelPrice, len(m))
	for k, v := range m {
		cp[normalize(k)] = v
	}
	return &Registry{version: "in-memory", currency: "USD", prices: cp}
}

// NewDefault returns a registry seeded with committed defaults matching
// data/prices.json. Used when PRICES_FILE is missing (e.g. `go test`).
func NewDefault() *Registry {
	return NewWithPrices(DefaultPrices())
}

// DefaultPrices mirrors data/prices.json. Keep them in sync.
func DefaultPrices() map[string]ModelPrice {
	return map[string]ModelPrice{
		"gpt-4o":               {InputPer1M: 2.50, OutputPer1M: 10.00},
		"gpt-4o-mini":          {InputPer1M: 0.15, OutputPer1M: 0.60},
		"gpt-5.5-pro":          {InputPer1M: 15.00, OutputPer1M: 120.00},
		"o1":                   {InputPer1M: 15.00, OutputPer1M: 60.00},
		"o3-mini":              {InputPer1M: 1.10, OutputPer1M: 4.40},
		"claude-sonnet-4":      {InputPer1M: 3.00, OutputPer1M: 15.00},
		"claude-3-5-sonnet":    {InputPer1M: 3.00, OutputPer1M: 15.00},
		"claude-3-5-haiku":     {InputPer1M: 0.80, OutputPer1M: 4.00},
		"gemini-1.5-pro":       {InputPer1M: 1.25, OutputPer1M: 5.00},
		"gemini-1.5-flash":     {InputPer1M: 0.075, OutputPer1M: 0.30},
		"gemini-2.0-flash":     {InputPer1M: 0.10, OutputPer1M: 0.40},
		"deepseek-chat":        {InputPer1M: 0.14, OutputPer1M: 0.28},
		"deepseek-reasoner":    {InputPer1M: 0.55, OutputPer1M: 2.19},
		"deepseek-v4-flash":    {InputPer1M: 0.07, OutputPer1M: 0.28},
		"mistral-large-latest": {InputPer1M: 2.00, OutputPer1M: 6.00},
	}
}

// LoadFromFile reads a FileFormat JSON file.
func LoadFromFile(path string) (*Registry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("pricing: read %s: %w", path, err)
	}
	return LoadFromBytes(data)
}

// LoadFromBytes parses FileFormat JSON. Accepts both the wrapped
// {"prices":{...}} shape and a bare {model: price} map.
func LoadFromBytes(data []byte) (*Registry, error) {
	var wrapped FileFormat
	if err := json.Unmarshal(data, &wrapped); err != nil {
		return nil, fmt.Errorf("pricing: parse: %w", err)
	}
	prices := wrapped.Prices
	if len(prices) == 0 {
		// Try bare map shape.
		var bare map[string]ModelPrice
		if err := json.Unmarshal(data, &bare); err != nil {
			return nil, fmt.Errorf("pricing: parse: no prices found")
		}
		prices = bare
		wrapped.Currency = "USD"
	}
	r := NewWithPrices(prices)
	if wrapped.Version != "" {
		r.version = wrapped.Version
	}
	if wrapped.Currency != "" {
		r.currency = wrapped.Currency
	}
	return r, nil
}

// Reload re-reads path into the registry in place (auto-update stub).
func (r *Registry) Reload(path string) error {
	next, err := LoadFromFile(path)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.prices = next.prices
	r.version = next.version
	r.currency = next.currency
	return nil
}

// Get looks up a model: exact → lowercase → prefix family (e.g.
// "gpt-4o-2024-11-20" matches "gpt-4o").
func (r *Registry) Get(model string) (ModelPrice, bool) {
	norm := normalize(model)
	r.mu.RLock()
	defer r.mu.RUnlock()
	if p, ok := r.prices[norm]; ok {
		return p, true
	}
	// Prefix fallback: longest stored key that is a prefix of norm.
	best := ""
	var bestPrice ModelPrice
	for k, v := range r.prices {
		if strings.HasPrefix(norm, k) && len(k) > len(best) {
			best, bestPrice = k, v
		}
	}
	if best != "" {
		return bestPrice, true
	}
	return DefaultFallback, false
}

// Cost computes USD cost from provider usage. Never estimates tokens.
func (r *Registry) Cost(model string, promptTokens, completionTokens int) (float64, bool) {
	p, known := r.Get(model)
	cost := float64(promptTokens)/1e6*p.InputPer1M + float64(completionTokens)/1e6*p.OutputPer1M
	return cost, known
}

// Version returns the loaded registry version string.
func (r *Registry) Version() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.version
}

func normalize(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}
