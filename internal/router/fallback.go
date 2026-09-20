// Fallback chain (spec 06 task 3.6): if the primary model fails or times
// out, cascade to the next model within 2 seconds of the primary failure.
//
// The chain carries model NAMES only; execution is injected as
// `do func(ctx, model) error` so the proxy (which owns HTTP) stays the only
// place that dials upstream. Per-attempt timeouts default well under the 2s
// trigger budget; a TotalTimeout caps the whole cascade.
package router

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// FallbackTriggerBudget is the spec acceptance target: the cascade must
// start the next model within 2 seconds of the primary failure.
const FallbackTriggerBudget = 2 * time.Second

// DefaultFallbackModels is the documented example cascade
// (spec 06 task 3.6): Sonnet → GPT-5.6 Terra → Gemini Pro.
var DefaultFallbackModels = []string{
	"claude-3-5-sonnet",
	"gpt-5.6-terra",
	"gemini-1.5-pro",
}

// Chain is an ordered model cascade.
type Chain struct {
	// Models in try order. Empty → Execute fails fast with ErrEmptyChain.
	Models []string
	// PerAttemptTimeout bounds each attempt (default 1500ms < trigger budget).
	PerAttemptTimeout time.Duration
	// TotalTimeout bounds the whole cascade (default FallbackTriggerBudget).
	TotalTimeout time.Duration
	// OnFallback, when set, fires after each failed attempt (metrics hook).
	OnFallback func(failedModel, nextModel string, err error)
}

// ErrEmptyChain is returned when a Chain has no models.
var ErrEmptyChain = &ChainError{Model: "", Msg: "router: fallback chain is empty"}

// ChainError records which model failed and why.
type ChainError struct {
	Model string
	Msg   string
	Err   error
}

func (e *ChainError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s: %v", e.Msg, e.Model, e.Err)
	}
	return fmt.Sprintf("%s: %s", e.Msg, e.Model)
}

func (e *ChainError) Unwrap() error { return e.Err }

func (c *Chain) perAttempt() time.Duration {
	if c != nil && c.PerAttemptTimeout > 0 {
		return c.PerAttemptTimeout
	}
	return 1500 * time.Millisecond
}

func (c *Chain) total() time.Duration {
	if c != nil && c.TotalTimeout > 0 {
		return c.TotalTimeout
	}
	return FallbackTriggerBudget
}

// DefaultChain builds the documented cascade rooted at primary:
// [primary, gpt-5.6-terra, gemini-1.5-pro] (deduped, blanks dropped).
func DefaultChain(primary string) *Chain {
	models := []string{}
	seen := map[string]bool{}
	for _, m := range append([]string{primary}, DefaultFallbackModels...) {
		m = strings.TrimSpace(m)
		if m == "" || seen[strings.ToLower(m)] {
			continue
		}
		seen[strings.ToLower(m)] = true
		models = append(models, m)
	}
	return &Chain{Models: models}
}

// Execute tries each model in order until do succeeds, returning the model
// that served the request. Each attempt gets min(remaining total budget,
// per-attempt timeout); the next attempt starts immediately on failure, so
// the trigger latency after a fast primary failure is microseconds, and
// after a hung primary it is bounded by PerAttemptTimeout (< 2s budget).
// Context cancellation aborts the cascade. When every model fails, the last
// error is returned wrapped with the full attempt history.
func (c *Chain) Execute(ctx context.Context, do func(ctx context.Context, model string) error) (string, error) {
	if c == nil || len(c.Models) == 0 {
		return "", ErrEmptyChain
	}
	if do == nil {
		return "", &ChainError{Msg: "router: fallback execute needs a do func"}
	}
	ctx, cancel := context.WithTimeout(ctx, c.total())
	defer cancel()

	var errs []string
	for i, model := range c.Models {
		attempt, stop := context.WithTimeout(ctx, c.perAttempt())
		err := do(attempt, model)
		stop()
		if err == nil {
			return model, nil
		}
		errs = append(errs, model+": "+err.Error())
		if c.OnFallback != nil && i+1 < len(c.Models) {
			c.OnFallback(model, c.Models[i+1], err)
		}
		if ctx.Err() != nil {
			return "", &ChainError{Model: model, Msg: "router: fallback cascade aborted, attempts [" + strings.Join(errs, "; ") + "]", Err: ctx.Err()}
		}
	}
	return "", &ChainError{Model: c.Models[len(c.Models)-1], Msg: "router: all fallback models failed, attempts [" + strings.Join(errs, "; ") + "]"}
}
