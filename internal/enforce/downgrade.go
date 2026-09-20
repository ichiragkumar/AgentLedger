// Auto-downgrade: at 90% utilization, route to cheaper models in-request.
//
// Contract with the Router (Phase 3): tier names are shared as plain
// strings so neither package imports the other (no import cycle):
//
//	tiers:  simple → moderate → complex → frontier
//	models: simple   → gemini-2.0-flash   (~$0.40/M out)
//	         moderate → claude-3-5-haiku   (~$4.00/M out)
//	         complex  → claude-sonnet-4    (~$15/M out)
//	         frontier → operator's frontier (request model, unchanged)
//
// Downgrade walks one step cheaper (frontier→complex→moderate→simple).
// The proxy rewrites the request model and continues — no dropped calls.
// Unknown models fall back to the configured CheapDefault.
package enforce

import "strings"

// Tier names shared with the Router by string value (do NOT import router).
const (
	TierSimple   = "simple"
	TierModerate = "moderate"
	TierComplex  = "complex"
	TierFrontier = "frontier"
)

// TierModels maps each tier to its canonical cheap model. Operators
// override via Downgrader.Models.
var TierModels = map[string]string{
	TierSimple:   "gemini-2.0-flash",
	TierModerate: "claude-3-5-haiku",
	TierComplex:  "claude-sonnet-4",
	// Frontier has no fixed model — the request model is already frontier.
}

// ModelTier classifies a model name into a tier by substring match.
// Cheap suffixes win over family prefixes (gpt-4o-mini → simple, not
// complex). Unknown models are treated as frontier (safest: downgrading
// an unknown expensive model saves the most).
func ModelTier(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	// Simple: flash + mini class. "mini" matches as a hyphen/space-delimited
	// token ("gpt-4o-mini", "o3-mini") — never as a substring of "gemini".
	if strings.Contains(m, "flash") || hasMiniToken(m) {
		return TierSimple
	}
	// Moderate: haiku + small reasoning/efficient models.
	if strings.Contains(m, "haiku") || strings.Contains(m, "o3-mini") ||
		strings.Contains(m, "deepseek-v4") {
		return TierModerate
	}
	// Complex: sonnet, gpt-4o, pro, large.
	if strings.Contains(m, "sonnet") || strings.Contains(m, "gpt-4o") ||
		strings.Contains(m, "gemini-1.5-pro") || strings.Contains(m, "gemini-2") && !strings.Contains(m, "flash") ||
		strings.Contains(m, "mistral-large") || strings.Contains(m, "deepseek-chat") ||
		strings.Contains(m, "deepseek-reasoner") {
		return TierComplex
	}
	// Frontier: gpt-5.5-pro, o1, opus-class, unknown.
	return TierFrontier
}

// hasMiniToken reports whether the lowercased model name carries "mini" as
// a standalone token ("gpt-4o-mini", "o3-mini", "mini-7b"). A substring
// check would false-positive on "geMINI".
func hasMiniToken(m string) bool {
	for _, tok := range strings.FieldsFunc(m, func(r rune) bool {
		switch r {
		case '-', '_', ' ', '/', '.', ':', '+':
			return true
		}
		return false
	}) {
		if tok == "mini" {
			return true
		}
	}
	return false
}

// CheaperTier steps one rung down the ladder (simple stays simple).
func CheaperTier(tier string) string {
	switch tier {
	case TierFrontier:
		return TierComplex
	case TierComplex:
		return TierModerate
	case TierModerate:
		return TierSimple
	default:
		return TierSimple
	}
}

// Downgrader rewrites models to cheaper tiers.
type Downgrader struct {
	// Models maps tier → model. Defaults to TierModels.
	Models map[string]string
	// CheapDefault is used when the target tier has no mapping.
	CheapDefault string
	// DowngradeHeader is set on downgraded requests for observability.
	DowngradeHeader string
}

// NewDefaultDowngrader returns a Downgrader with canonical tier models.
func NewDefaultDowngrader() *Downgrader {
	cp := make(map[string]string, len(TierModels))
	for k, v := range TierModels {
		cp[k] = v
	}
	return &Downgrader{Models: cp, CheapDefault: TierModels[TierSimple], DowngradeHeader: "X-AgentLedger-Downgraded"}
}

// Downgrade maps model one step cheaper. Returns (newModel, true) when the
// model actually changes; (model, false) when already cheapest.
func (d *Downgrader) Downgrade(model string) (string, bool) {
	tier := ModelTier(model)
	if tier == TierSimple {
		if cur := TierModels[TierSimple]; strings.EqualFold(cur, strings.TrimSpace(model)) {
			return model, false
		}
		// A "simple-tier" alias we don't know exactly → normalize to canonical.
		if next, ok := d.Models[TierSimple]; ok && next != "" {
			if strings.EqualFold(next, strings.TrimSpace(model)) {
				return model, false
			}
			return next, true
		}
		return model, false
	}
	next := CheaperTier(tier)
	target, ok := d.Models[next]
	if !ok || target == "" {
		target = d.CheapDefault
	}
	if target == "" || strings.EqualFold(target, strings.TrimSpace(model)) {
		return model, false
	}
	return target, true
}

// ShouldDowngrade reports whether utilPct triggers a downgrade
// (>=90% and not yet hard-stopped at 100%).
func ShouldDowngrade(utilPct float64) bool {
	return utilPct >= DowngradeAt && utilPct < ThresholdHardStop
}
