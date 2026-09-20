// Package enforce implements Phase 4 (The Enforcer): hard budgets, soft
// alerts, auto-downgrade, hard stop, policy engine, runaway loop kill,
// forecasting, and the budget management API.
//
// Hot-path contract: budget pre-check + policy eval run BEFORE cache/route
// in the Mirror chain (see WIRING below) and must stay <1ms. This package
// uses only the Go standard library on the hot path (maps, floats, regexp
// precompiled once) — no network, no reflect, no allocations in Eval loops
// beyond error strings.
//
// WIRING (pre-check hook — Mirror's chain becomes enforce → cache → route):
//
//	enforcer := enforce.NewStore()
//	policy   := enforce.MustLoadPolicy([]byte(cfgYAML))
//	kill     := enforce.NewTracker(enforce.DefaultLoopLimits())
//	precheck := enforce.PreCheckMiddleware(enforcer, policy, kill, downgrader, alerter)
//	mux.Handle("POST /v1/chat/completions",
//	    proxy.Chain(upstream, precheck, proxy.CacheStub, proxy.RouteStub))
//
// PreCheckMiddleware lives in api.go. On hard stop it writes 429 with
// X-AgentLedger-Deny-Reason and never calls next. On downgrade it rewrites
// the request model to the cheaper tier and continues (no dropped calls).
// Every decision is appended to the hash-chained audit log (Postgres
// audit_log table, see db/migrations/002_budgets.sql).
package enforce

// Action is the enforcement decision for one budget level.
type Action string

const (
	// ActionAllow means under all thresholds — proceed unchanged.
	ActionAllow Action = "allow"
	// ActionAlert means a soft threshold (50/75/90%) was crossed — proceed
	// and fire an async alert (must land within 60s, see alerts.go).
	ActionAlert Action = "alert"
	// ActionDowngrade means utilization >= 90% — proceed on a cheaper model
	// within the same request (no drop, see downgrade.go).
	ActionDowngrade Action = "downgrade"
	// ActionHardStop means utilization >= 100% — reject with 429
	// (see hardstop.go).
	ActionHardStop Action = "hard_stop"
)

// Enforcement thresholds (percent of the tighter of token/dollar limits).
const (
	ThresholdAlert50  = 50.0
	ThresholdAlert75  = 75.0
	ThresholdAlert90  = 90.0
	ThresholdHardStop = 100.0
)

// DowngradeAt is the utilization at which auto-downgrade kicks in.
const DowngradeAt = ThresholdAlert90

// ActionForUtil maps a utilization percentage to the enforcement action.
// Levels are enforced independently; the most restrictive action across
// Org → Team → Project → Agent wins (see Store.Check).
func ActionForUtil(utilPct float64) Action {
	switch {
	case utilPct >= ThresholdHardStop:
		return ActionHardStop
	case utilPct >= DowngradeAt:
		return ActionDowngrade
	case utilPct >= ThresholdAlert50:
		return ActionAlert
	default:
		return ActionAllow
	}
}

// AlertThresholdCrossed reports which soft-alert thresholds are crossed by
// utilPct. A budget already at/over prevPct only reports newly crossed
// thresholds so alerts fire once per threshold per window.
func AlertThresholdCrossed(prevPct, utilPct float64) []float64 {
	candidates := []float64{ThresholdAlert50, ThresholdAlert75, ThresholdAlert90}
	var out []float64
	for _, t := range candidates {
		if prevPct < t && utilPct >= t {
			out = append(out, t)
		}
	}
	return out
}
