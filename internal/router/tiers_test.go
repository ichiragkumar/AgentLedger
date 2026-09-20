package router

import (
	"testing"

	"github.com/agentledger/agentledger/internal/pricing"
)

func TestDefaultTierMapModels(t *testing.T) {
	tm := DefaultTierMap()
	reg := pricing.NewDefault()
	want := map[Complexity]string{
		ComplexitySimple:   "gemini-2.0-flash",
		ComplexityModerate: "claude-3-5-haiku",
		ComplexityComplex:  "claude-3-5-sonnet",
		ComplexityFrontier: "gpt-5.5-pro",
	}
	for c, model := range want {
		tier := tm.Select(c, StrategyBalanced)
		if tier.Model != model {
			t.Fatalf("bucket %s → %q, want %q", c, tier.Model, model)
		}
		if _, known := reg.Get(model); !known {
			t.Fatalf("tier model %q missing from price registry (must be Known=true)", model)
		}
	}
}

func TestTierSelectionAllBuckets(t *testing.T) {
	tm := DefaultTierMap()
	for c := ComplexitySimple; c <= ComplexityFrontier; c++ {
		tier := tm.Select(c, StrategyBalanced)
		if tier.ID != TierFor(c) {
			t.Fatalf("bucket %s selected tier %q", c, tier.ID)
		}
	}
}

func TestStrategiesShiftTiers(t *testing.T) {
	tm := DefaultTierMap()
	if got := tm.Select(ComplexityComplex, StrategyCostFirst); got.ID != TierModerate {
		t.Fatalf("cost-first complex → %q, want moderate", got.ID)
	}
	if got := tm.Select(ComplexitySimple, StrategyCostFirst); got.ID != TierSimple {
		t.Fatalf("cost-first clamps at simple, got %q", got.ID)
	}
	if got := tm.Select(ComplexityComplex, StrategyQualityFirst); got.ID != TierFrontier {
		t.Fatalf("quality-first complex → %q, want frontier", got.ID)
	}
	if got := tm.Select(ComplexityFrontier, StrategyQualityFirst); got.ID != TierFrontier {
		t.Fatalf("quality-first clamps at frontier, got %q", got.ID)
	}
	if got := tm.Select(ComplexityModerate, StrategyBalanced); got.ID != TierModerate {
		t.Fatalf("balanced must be identity, got %q", got.ID)
	}
	if ParseStrategy("COST-FIRST") != StrategyCostFirst || ParseStrategy("nope") != StrategyBalanced {
		t.Fatal("ParseStrategy mapping wrong")
	}
}

func TestDecideRulesOverrideBeatsClassify(t *testing.T) {
	e := NewEngine()
	if err := e.LoadBytes([]byte(`{"rules":[{"id":"support-faq","agent_id":"support_bot","task_type":"faq","model":"gemini-2.0-flash","tier":"simple","priority":10}]}`)); err != nil {
		t.Fatal(err)
	}
	d := Decide(Input{Prompt: "Prove a deep theorem about consensus with full formal verification apparatus", TaskType: "faq", AgentID: "support_bot"}, e, DefaultTierMap(), StrategyBalanced)
	if d.Model != "gemini-2.0-flash" || d.RuleID != "support-faq" {
		t.Fatalf("rules override lost: %+v", d)
	}
	h := d.Headers()
	if h["X-AgentLedger-Route"] != "gemini-2.0-flash" || h["X-AgentLedger-Tier"] != "simple" {
		t.Fatalf("RouteStub headers wrong: %v", h)
	}
}

func TestDecideClassifyPath(t *testing.T) {
	d := Decide(Input{Prompt: "Is this spam, yes or no", TaskType: "classification"}, nil, nil, StrategyBalanced)
	if d.Model != "gemini-2.0-flash" || d.Tier != TierSimple || d.Complexity != ComplexitySimple {
		t.Fatalf("simple prompt misrouted: %+v", d)
	}
	if d.Reason == "" || d.Confidence <= 0 {
		t.Fatalf("decision needs audit reason + confidence: %+v", d)
	}
}

func TestSpreadConstants(t *testing.T) {
	if SpreadMultiple < 600 || SpreadMultiple > 700 {
		t.Fatalf("spread %f should be ≈640x", SpreadMultiple)
	}
}

// TestMixedWorkloadSavingsOver40Pct simulates a realistic mixed workload
// (50% simple / 25% moderate / 15% complex / 10% frontier, 1k/2k tokens)
// and asserts >40% savings vs always-frontier with live registry prices.
func TestMixedWorkloadSavingsOver40Pct(t *testing.T) {
	reg := pricing.NewDefault()
	tiers := DefaultTierMap()
	type leg struct {
		c     Complexity
		share float64
	}
	mix := []leg{{ComplexitySimple, 0.50}, {ComplexityModerate, 0.25}, {ComplexityComplex, 0.15}, {ComplexityFrontier, 0.10}}
	var base, routed float64
	for _, l := range mix {
		d := Decide(Input{Prompt: "x"}, nil, tiers, StrategyBalanced)
		// Force the bucket under test through Select (Classify("x") is simple).
		tier := tiers.Select(l.c, StrategyBalanced)
		d.Model = tier.Model
		b, r, _ := d.Savings(reg, "", 1000, 2000)
		base += b * l.share
		routed += r * l.share
	}
	saved := base - routed
	pct := SavingsPct(base, saved)
	t.Logf("baseline=$%.4f routed=$%.4f saved=$%.4f (%.1f%%)", base, routed, saved, pct)
	if pct < 40 {
		t.Fatalf("mixed-workload savings %.1f%% < 40%% target", pct)
	}
}

func TestSavingsMath(t *testing.T) {
	reg := pricing.NewDefault()
	d := Decision{Model: "gemini-2.0-flash", Tier: TierSimple, Complexity: ComplexitySimple}
	b, r, s := d.Savings(reg, "", 1_000_000, 1_000_000)
	if b <= r || s != b-r {
		t.Fatalf("savings math broken: base=%f routed=%f saved=%f", b, r, s)
	}
	if SavingsPct(0, 5) != 0 {
		t.Fatal("zero baseline must yield 0%")
	}
	cost, known := d.CostOf(reg, 1000, 500)
	if !known || cost <= 0 {
		t.Fatalf("CostOf = %f %v", cost, known)
	}
	if _, known := d.CostOf(nil, 1, 1); known {
		t.Fatal("nil pricer must be unknown")
	}
	if b2, _, _ := d.Savings(nil, "", 1, 1); b2 != 0 {
		t.Fatal("nil pricer savings must be zero")
	}
}
