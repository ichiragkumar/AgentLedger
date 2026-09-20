// Tier map + routing decision (spec 06 task 3.2).
//
// Default tiers exploit the provider price spread: routine work rides cheap
// high-throughput models, frontier work keeps the frontier model. Blended
// $/M figures below are the documented spec values; live cost math always
// goes through pricing.Pricer (Mirror registry or the Phase 3 live feed),
// never these constants.
package router

import (
	"strings"
	"sync"

	"github.com/agentledger/agentledger/internal/pricing"
)

// Price-spread context (spec 06 pitch: "The 640x Spread").
// Output tokens range from ~$0.28/M (batch-efficient cheap tiers) to
// ~$180/M (frontier reasoning). Routing exists to exploit this spread.
const (
	// CheapestOutputPer1M is the floor seen on batch/cheap tiers ($/M out).
	CheapestOutputPer1M = 0.28
	// FrontierOutputPer1M is the ceiling on frontier reasoning tiers ($/M out).
	FrontierOutputPer1M = 180.0
	// SpreadMultiple is FrontierOutputPer1M / CheapestOutputPer1M (≈640x).
	SpreadMultiple = FrontierOutputPer1M / CheapestOutputPer1M
)

// TierID names a model tier. It matches the Complexity bucket 1:1 by default
// but strategies may shift the selected tier up/down.
type TierID string

const (
	TierSimple   TierID = "simple"
	TierModerate TierID = "moderate"
	TierComplex  TierID = "complex"
	TierFrontier TierID = "frontier"
)

// Tier binds a bucket to a concrete model plus its documented blended price.
type Tier struct {
	ID           TierID  `json:"id"`
	Model        string  `json:"model"`
	BlendedPer1M float64 `json:"blended_per_1m"`
	Description  string  `json:"description"`
}

// TierFor maps a complexity bucket to its tier (identity mapping).
func TierFor(c Complexity) TierID { return TierID(c.String()) }

// Strategy selects the cost/quality posture applied on top of tier selection.
// The three documented strategies (spec 06 Definition of Done):
//
//	cost-first    — downgrade one tier (never below simple); max savings.
//	balanced      — route exactly as classified; default.
//	quality-first — upgrade one tier (never above frontier); max quality.
type Strategy string

const (
	StrategyCostFirst    Strategy = "cost-first"
	StrategyBalanced     Strategy = "balanced"
	StrategyQualityFirst Strategy = "quality-first"
)

// ParseStrategy maps env/config strings to a Strategy; unknown → balanced.
func ParseStrategy(s string) Strategy {
	switch Strategy(strings.ToLower(strings.TrimSpace(s))) {
	case StrategyCostFirst:
		return StrategyCostFirst
	case StrategyQualityFirst:
		return StrategyQualityFirst
	default:
		return StrategyBalanced
	}
}

// ApplyStrategy shifts a tier: cost-first steps down, quality-first steps up,
// balanced is identity. Shifts clamp at the ends.
func ApplyStrategy(t TierID, s Strategy) TierID {
	order := []TierID{TierSimple, TierModerate, TierComplex, TierFrontier}
	i := 0
	for k, v := range order {
		if v == t {
			i = k
			break
		}
	}
	switch s {
	case StrategyCostFirst:
		if i > 0 {
			i--
		}
	case StrategyQualityFirst:
		if i < len(order)-1 {
			i++
		}
	}
	return order[i]
}

// TierMap is the configurable complexity → tier binding. Configure via
// Set/Load; hot path reads take an RLock and do one map lookup.
type TierMap struct {
	mu    sync.RWMutex
	tiers map[Complexity]Tier
}

// DefaultTierMap returns the spec 06 tier table. Every model exists in the
// Mirror price registry so cost math is always Known=true:
//
//	simple   → gemini-2.0-flash   ($0.75/M blended doc value)
//	moderate → claude-3-5-haiku   ($0.80/M blended doc value)
//	complex  → claude-3-5-sonnet  ($3/M blended doc value)
//	frontier → gpt-5.5-pro        (frontier; priced live from registry)
func DefaultTierMap() *TierMap {
	return &TierMap{tiers: defaultTiers()}
}

func defaultTiers() map[Complexity]Tier {
	return map[Complexity]Tier{
		ComplexitySimple:   {ID: TierSimple, Model: "gemini-2.0-flash", BlendedPer1M: 0.75, Description: "simple tasks: classification, extraction, FAQ, formatting"},
		ComplexityModerate: {ID: TierModerate, Model: "claude-3-5-haiku", BlendedPer1M: 0.80, Description: "moderate tasks: summaries, explanations, drafts, translation"},
		ComplexityComplex:  {ID: TierComplex, Model: "claude-3-5-sonnet", BlendedPer1M: 3.00, Description: "complex tasks: code, analysis, multi-step planning"},
		ComplexityFrontier: {ID: TierFrontier, Model: "gpt-5.5-pro", BlendedPer1M: 15.00, Description: "frontier tasks: proofs, novel research, long-context reasoning"},
	}
}

// Set overrides one bucket binding (config reload path).
func (m *TierMap) Set(c Complexity, t Tier) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.tiers == nil {
		m.tiers = map[Complexity]Tier{}
	}
	m.tiers[c] = t
}

// Select returns the tier for a bucket after applying the strategy.
func (m *TierMap) Select(c Complexity, s Strategy) Tier {
	m.mu.RLock()
	t, ok := m.tiers[c]
	m.mu.RUnlock()
	if !ok {
		t = defaultTiers()[c]
	}
	t.ID = ApplyStrategy(TierFor(c), s)
	if shifted, ok := m.lookupID(t.ID); ok {
		shifted.ID = t.ID
		return shifted
	}
	return t
}

func (m *TierMap) lookupID(id TierID) (Tier, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, t := range m.tiers {
		if t.ID == id {
			return t, true
		}
	}
	return Tier{}, false
}

// DefaultTierMapUnsafe exposes the default table for tests/config diffing.
func DefaultTierMapUnsafe() map[Complexity]Tier {
	return defaultTiers()
}

// tierForModel reverse-matches a model name to its tier (rules path).
func (m *TierMap) tierForModel(model string) TierID {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for c, t := range m.tiers {
		if strings.EqualFold(t.Model, model) {
			return TierID(TierFor(c))
		}
	}
	return TierModerate
}

// Decision is the single routing verdict passed to the proxy layer.
type Decision struct {
	Model      string     `json:"model"`
	Tier       TierID     `json:"tier"`
	Complexity Complexity `json:"-"`
	Confidence float64    `json:"confidence"`
	// RuleID is set when a rules-engine override fired ("" otherwise).
	RuleID string `json:"rule_id,omitempty"`
	// Reason is a human-readable audit trail (logged, never sent upstream).
	Reason string `json:"reason"`
}

// Headers returns the response headers the proxy sets for a decision.
// X-AgentLedger-Route carries the selected model (RouteStub contract);
// the tier/complexity headers feed dashboard analytics.
func (d Decision) Headers() map[string]string {
	return map[string]string{
		"X-AgentLedger-Route":      d.Model,
		"X-AgentLedger-Tier":       string(d.Tier),
		"X-AgentLedger-Complexity": d.Complexity.String(),
	}
}

// Decide runs the full pipeline: rules override → classify → strategy → tier.
// Rules fire first (explicit team control beats heuristics); otherwise the
// prompt is classified and mapped through the strategy. Pure + fast: no I/O,
// safe on the proxy hot path after a cache MISS.
func Decide(in Input, rules *Engine, tiers *TierMap, strategy Strategy) Decision {
	if tiers == nil {
		tiers = DefaultTierMap()
	}
	if rules != nil {
		if r, ok := rules.Eval(in.AgentID, in.TaskType, ComplexityModerate); ok && r.Model != "" {
			tier := TierID(strings.ToLower(strings.TrimSpace(r.Tier)))
			if tier == "" {
				tier = tiers.tierForModel(r.Model)
			}
			return Decision{
				Model:      r.Model,
				Tier:       tier,
				Complexity: ComplexityModerate,
				Confidence: 1,
				RuleID:     r.ID,
				Reason:     "rules override agent=" + in.AgentID + " task=" + in.TaskType,
			}
		}
	}
	c, conf := ClassifyPrompt(in.Prompt, in.TaskType)
	tier := tiers.Select(c, strategy)
	reason := "classify=" + c.String()
	if strategy != StrategyBalanced {
		reason += " strategy=" + string(strategy)
	}
	return Decision{
		Model:      tier.Model,
		Tier:       tier.ID,
		Complexity: c,
		Confidence: conf,
		Reason:     reason,
	}
}

// CostOf computes the live USD cost of running prompt/completion tokens on
// the decision's model via pricer (registry or live feed).
func (d Decision) CostOf(pricer pricing.Pricer, promptTokens, completionTokens int) (float64, bool) {
	if pricer == nil {
		return 0, false
	}
	return pricer.Cost(d.Model, promptTokens, completionTokens)
}

// Savings compares a routed decision against the always-frontier baseline.
// Returns (baselineCost, routedCost, savedUSD). Powers the dashboard
// "You would have spent $X. You spent $Y. Saved $Z (N%)."
func (d Decision) Savings(pricer pricing.Pricer, frontierModel string, promptTokens, completionTokens int) (baseline, routed, saved float64) {
	if pricer == nil {
		return 0, 0, 0
	}
	if strings.TrimSpace(frontierModel) == "" {
		frontierModel = DefaultTierMapUnsafe()[ComplexityFrontier].Model
	}
	baseline, _ = pricer.Cost(frontierModel, promptTokens, completionTokens)
	routed, _ = pricer.Cost(d.Model, promptTokens, completionTokens)
	saved = baseline - routed
	if saved < 0 {
		saved = 0
	}
	return baseline, routed, saved
}

// SavingsPct renders saved/baseline as a 0..100 percent.
func SavingsPct(baseline, saved float64) float64 {
	if baseline <= 0 {
		return 0
	}
	return saved / baseline * 100
}
