// Runaway loop kill: track chains via X-Request-Chain-Id.
//
// A chain is killed when, inside a sliding window, it exceeds MaxDepth
// (request count) OR MaxTokens (sum of prompt+completion tokens). Record is
// O(1) in-memory (mutex + map), so the kill decision lands in microseconds
// — far inside the 5s acceptance bound. Expired chains are swept lazily on
// Record and via Sweep (call from a minute ticker in production wiring).
//
// Env overrides: ENFORCER_MAX_DEPTH, ENFORCER_MAX_TOKENS,
// ENFORCER_WINDOW_SECONDS (see DefaultLoopLimits).
package enforce

import (
	"fmt"
	"os"
	"strconv"
	"sync"
	"time"
)

// LoopLimits bounds one chain inside Window.
type LoopLimits struct {
	MaxDepth  int           // max requests per window
	MaxTokens int64         // max tokens per window
	Window    time.Duration // sliding window
}

// DefaultLoopLimits returns production defaults (env-overridable).
func DefaultLoopLimits() LoopLimits {
	lim := LoopLimits{MaxDepth: 50, MaxTokens: 500_000, Window: 5 * time.Minute}
	if v := os.Getenv("ENFORCER_MAX_DEPTH"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			lim.MaxDepth = n
		}
	}
	if v := os.Getenv("ENFORCER_MAX_TOKENS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			lim.MaxTokens = n
		}
	}
	if v := os.Getenv("ENFORCER_WINDOW_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			lim.Window = time.Duration(n) * time.Second
		}
	}
	return lim
}

// Chain kill reasons.
const (
	ReasonDepthExceeded  = "loop_depth_exceeded"
	ReasonTokensExceeded = "loop_tokens_exceeded"
)

type chainState struct {
	depth     int
	tokens    int64
	firstSeen time.Time
}

// Tracker counts requests/tokens per chain ID inside a sliding window.
type Tracker struct {
	mu     sync.Mutex
	chains map[string]*chainState
	limits LoopLimits
	now    func() time.Time
}

// NewTracker builds a Tracker with lim.
func NewTracker(lim LoopLimits) *Tracker {
	return &Tracker{chains: map[string]*chainState{}, limits: lim, now: time.Now}
}

// Limits returns the active limits.
func (t *Tracker) Limits() LoopLimits {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.limits
}

// Record logs one request (tokens = prompt+completion) for chainID and
// reports whether the chain must be killed NOW. Empty chainID never kills
// (unattributed traffic is still budget-checked).
func (t *Tracker) Record(chainID string, tokens int64) (kill bool, reason string) {
	if chainID == "" {
		return false, ""
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	st, ok := t.chains[chainID]
	if !ok || now.Sub(st.firstSeen) >= t.limits.Window {
		st = &chainState{firstSeen: now}
		t.chains[chainID] = st
	}
	st.depth++
	st.tokens += tokens
	switch {
	case st.depth > t.limits.MaxDepth:
		return true, fmt.Sprintf("%s: depth %d > max %d in %s",
			ReasonDepthExceeded, st.depth, t.limits.MaxDepth, t.limits.Window)
	case st.tokens > t.limits.MaxTokens:
		return true, fmt.Sprintf("%s: tokens %d > max %d in %s",
			ReasonTokensExceeded, st.tokens, t.limits.MaxTokens, t.limits.Window)
	}
	return false, ""
}

// AddTokens adds post-response tokens to a chain WITHOUT incrementing
// depth (depth is counted once in Record at pre-check time). It reports
// whether the added tokens trip the token kill — the proxy calls this via
// API.Observe after the upstream response lands.
func (t *Tracker) AddTokens(chainID string, tokens int64) (kill bool, reason string) {
	if chainID == "" || tokens <= 0 {
		return false, ""
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	st, ok := t.chains[chainID]
	if !ok || t.now().Sub(st.firstSeen) >= t.limits.Window {
		// Observe-only flow (no pre-check Record ran): create state with
		// depth 0 so post-response tokens are still attributed to the chain.
		// Skip the kill evaluation on this creating call — a single response
		// must not kill a chain whose depth was never counted; the runaway
		// kill applies once the chain is tracked (depth ≥1 or next add).
		st = &chainState{firstSeen: t.now()}
		t.chains[chainID] = st
		st.tokens += tokens
		return false, ""
	}
	st.tokens += tokens
	if st.tokens > t.limits.MaxTokens {
		return true, fmt.Sprintf("%s: tokens %d > max %d in %s",
			ReasonTokensExceeded, st.tokens, t.limits.MaxTokens, t.limits.Window)
	}
	return false, ""
}

// Check reports current depth/tokens for chainID (for headers/tests).
func (t *Tracker) Check(chainID string) (depth int, tokens int64, ok bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	st, ok := t.chains[chainID]
	if !ok || t.now().Sub(st.firstSeen) >= t.limits.Window {
		return 0, 0, false
	}
	return st.depth, st.tokens, true
}

// Reset forgets a chain (used after an operator clears an incident).
func (t *Tracker) Reset(chainID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.chains, chainID)
}

// Sweep drops expired chains. Returns the number evicted.
func (t *Tracker) Sweep() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	n := 0
	for id, st := range t.chains {
		if now.Sub(st.firstSeen) >= t.limits.Window {
			delete(t.chains, id)
			n++
		}
	}
	return n
}

// Chains returns the number of tracked chains (for metrics).
func (t *Tracker) Chains() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.chains)
}
