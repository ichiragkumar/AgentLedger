package brain

import (
	"math"
	"testing"
)

func TestScoreStepsOrdering(t *testing.T) {
	g := BuildGraph("c1", sevenAgentSpans("c1"))
	for _, n := range g.Nodes {
		n.TotalCost = 0.10 // uniform $0.10/step
	}
	scores := ScoreSteps(g, nil, nil)
	if len(scores) != 7 {
		t.Fatalf("want 7 scores, got %d", len(scores))
	}
	// Planner (root, $0.60 downstream) must outrank publisher (leaf, $0 waste).
	var planScore, pubScore float64
	var planWaste, pubWaste float64
	for _, s := range scores {
		if s.AgentID == "planner" {
			planScore, planWaste = s.Score, s.DownstreamWasteUSD
		}
		if s.AgentID == "publisher" {
			pubScore, pubWaste = s.Score, s.DownstreamWasteUSD
		}
	}
	if math.Abs(planWaste-0.60) > 1e-9 {
		t.Fatalf("planner waste should be $0.60, got %v", planWaste)
	}
	if pubWaste != 0 {
		t.Fatalf("leaf waste must be 0, got %v", pubWaste)
	}
	if planScore <= pubScore {
		t.Fatalf("planner %.3f must outrank publisher %.3f", planScore, pubScore)
	}
	if scores[0].AgentID != "planner" {
		t.Fatalf("most critical should be planner, got %v", scores[0].AgentID)
	}
	if scores[0].Tier != "frontier" {
		t.Fatalf("planner tier should be frontier, got %v", scores[0].Tier)
	}
	if scores[len(scores)-1].Tier != "cheap" {
		t.Fatalf("leaf tier should be cheap, got %v", scores[len(scores)-1].Tier)
	}
}

func TestScoreStepsFlakyLeafEscalates(t *testing.T) {
	g := BuildGraph("c", []Span{
		{ChainID: "c", AgentID: "root", Success: true},
		{ChainID: "c", AgentID: "leaf", ParentAgentID: "root", Success: false},
	})
	stats := map[string]StepStats{
		"leaf": {AgentID: "leaf", Calls: 100, Failures: 90, AvgCostUSD: 0.01},
		"root": {AgentID: "root", Calls: 100, Failures: 0, AvgCostUSD: 0.01},
	}
	scores := ScoreSteps(g, stats, nil)
	byID := map[string]ScoredStep{}
	for _, s := range scores {
		byID[s.AgentID] = s
	}
	if byID["leaf"].FailureRate < 0.5 {
		t.Fatalf("leaf failure rate should reflect history: %v", byID["leaf"].FailureRate)
	}
}

func TestDownstreamWasteCustomCost(t *testing.T) {
	g := BuildGraph("c1", sevenAgentSpans("c1"))
	w := DownstreamWaste(g, "qa", func(string) float64 { return 2.0 })
	if w != 2.0 { // only publisher downstream
		t.Fatalf("want 2.0, got %v", w)
	}
	w = DownstreamWaste(g, "publisher", func(string) float64 { return 2.0 })
	if w != 0 {
		t.Fatalf("leaf waste 0, got %v", w)
	}
}

func TestTierFor(t *testing.T) {
	if TierFor(0.9) != "frontier" || TierFor(0.6) != "frontier" {
		t.Fatal("≥0.60 → frontier")
	}
	if TierFor(0.45) != "standard" || TierFor(0.3) != "standard" {
		t.Fatal("0.30–0.60 → standard")
	}
	if TierFor(0.29) != "cheap" || TierFor(0) != "cheap" {
		t.Fatal("<0.30 → cheap")
	}
}

func TestSetWeights(t *testing.T) {
	defer func() { SetWeights(0.25, 0.50, 0.25) }()
	if !SetWeights(0.3, 0.4, 0.3) {
		t.Fatal("valid weights must apply")
	}
	p, w, f := GetWeights()
	if p != 0.3 || w != 0.4 || f != 0.3 {
		t.Fatalf("bad weights: %v %v %v", p, w, f)
	}
	if SetWeights(0.5, 0.5, 0.5) {
		t.Fatal("weights summing ≠1 must be rejected")
	}
	if SetWeights(-0.1, 0.6, 0.5) {
		t.Fatal("negative weights must be rejected")
	}
	p2, _, _ := GetWeights()
	if p2 != 0.3 {
		t.Fatal("rejected SetWeights must keep old weights")
	}
}

func TestWastePredictionError(t *testing.T) {
	if e := WastePredictionError(1.0, 1.0); e != 0 {
		t.Fatalf("exact → 0, got %v", e)
	}
	if e := WastePredictionError(1.1, 1.0); math.Abs(e-0.1) > 1e-9 {
		t.Fatalf("10%% off → 0.1, got %v", e)
	}
	if e := WastePredictionError(0, 0); e != 0 {
		t.Fatalf("0/0 → 0, got %v", e)
	}
	if e := WastePredictionError(5, 0); e != 1 {
		t.Fatalf("phantom prediction → 1, got %v", e)
	}
	// Acceptance bar helper: 20% boundary.
	if e := WastePredictionError(1.19, 1.0); e >= 0.20 {
		t.Fatalf("19%% error must pass the 20%% bar, got %v", e)
	}
}

func TestStepStatsRates(t *testing.T) {
	empty := StepStats{AgentID: "x"}
	if empty.RawFailureRate() != PriorFailureRate {
		t.Fatalf("no history → prior, got %v", empty.RawFailureRate())
	}
	s := StepStats{AgentID: "x", Calls: 4, Failures: 1}
	if s.RawFailureRate() != 0.25 {
		t.Fatalf("raw 1/4, got %v", s.RawFailureRate())
	}
	if s.FailureRate() == 0.25 {
		t.Fatal("smoothed rate must differ from raw on small N (Laplace)")
	}
}

func TestScoreSingleNodeChain(t *testing.T) {
	g := BuildGraph("solo", []Span{{ChainID: "solo", AgentID: "only", CostUSD: 0.5, Success: true}})
	scores := ScoreSteps(g, nil, nil)
	if len(scores) != 1 {
		t.Fatalf("want 1 score, got %d", len(scores))
	}
	if scores[0].PositionFactor != 0.5 {
		t.Fatalf("single node position must be neutral 0.5, got %v", scores[0].PositionFactor)
	}
	// Explicit avgCost override path.
	scores2 := ScoreSteps(g, nil, map[string]float64{"only": 3.0})
	if scores2[0].AgentID != "only" {
		t.Fatalf("override path broken: %+v", scores2)
	}
}

func TestSavingsEdgeCases(t *testing.T) {
	g, steps := workflowFixture()
	if _, ok := SavingsVsUniform(g, steps, Plan{Feasible: false}); ok {
		t.Fatal("infeasible plan → not ok")
	}
	// Zero-cost baseline → not ok (no division by zero).
	zero := map[string]Step{"plan": {AgentID: "plan", Options: []ModelOption{{Name: "free", CostUSD: 0, FailureRate: 0, Quality: 1}}}}
	gz := BuildGraph("z", []Span{{ChainID: "z", AgentID: "plan", Success: true}})
	pz := Optimize(gz, zero)
	if _, ok := SavingsVsUniform(gz, zero, pz); ok {
		t.Fatal("zero-cost baseline → not ok")
	}
	// Uniform infeasible (impossible floor) → not ok.
	impossible := map[string]Step{"plan": {AgentID: "plan", MinQuality: 2.0, Options: []ModelOption{{Name: "m", CostUSD: 1, Quality: 0.5}}}}
	if _, ok := SavingsVsUniform(g, impossible, Plan{Feasible: true}); ok {
		t.Fatal("infeasible baseline → not ok")
	}
}

func TestLearner(t *testing.T) {
	l := NewLearner()
	if r := l.FailureRate("unseen"); r != PriorFailureRate {
		t.Fatalf("unseen → prior %v, got %v", PriorFailureRate, r)
	}
	for i := 0; i < 9; i++ {
		l.Observe(Outcome{AgentID: "qa", Success: true, CostUSD: 0.02, Quality: 0.9})
	}
	l.Observe(Outcome{AgentID: "qa", Success: false, CostUSD: 0.05, Quality: 0.2})
	snap := l.Snapshot()
	s := snap["qa"]
	if s.Calls != 10 || s.Failures != 1 {
		t.Fatalf("bad snapshot: %+v", s)
	}
	// EWMA cost must sit between first and last observation.
	if s.AvgCostUSD <= 0.02 || s.AvgCostUSD >= 0.05 {
		t.Fatalf("EWMA cost out of range: %v", s.AvgCostUSD)
	}
	if r := l.FailureRate("qa"); r <= 0 || r >= 1 {
		t.Fatalf("smoothed rate in (0,1): %v", r)
	}
	if got := UpdateFailureRate(0.5, 0.2, true); math.Abs(got-0.6) > 1e-9 {
		t.Fatalf("EWMA fail step: want 0.6, got %v", got)
	}
	if got := UpdateFailureRate(0.5, 0.2, false); math.Abs(got-0.4) > 1e-9 {
		t.Fatalf("EWMA success step: want 0.4, got %v", got)
	}
	if bad := NewLearnerWithAlpha(-1); bad.alpha != DefaultAlpha {
		t.Fatal("bad alpha must fall back to default")
	}
}

func TestCorrelateAndSummarize(t *testing.T) {
	costs := []WorkflowCost{
		{WorkflowID: "w1", CostUSD: 2.30, Steps: 7},
		{WorkflowID: "w2", CostUSD: 0.40, Steps: 3},
	}
	signals := []BusinessSignal{
		{WorkflowID: "w1", Source: SourceWebhook, Success: true, ValueUSD: 45.00},
		{WorkflowID: "w2", Source: SourceStatus, Success: true, StatusCode: 200},
	}
	recs := Correlate(costs, signals, 8.0, 0)
	if len(recs) != 2 {
		t.Fatalf("want 2 records, got %d", len(recs))
	}
	if recs[0].WorkflowID != "w1" || recs[0].ValueUSD != 45 || recs[0].CostUSD != 2.30 {
		t.Fatalf("w1 record wrong: %+v", recs[0])
	}
	// "cost $2.30 → $45 value": ROI ≈ 19.57.
	if math.Abs(recs[0].ROI-45.0/2.30) > 1e-9 {
		t.Fatalf("bad ROI: %v", recs[0].ROI)
	}
	if recs[1].ValueUSD != 8.0 { // status fallback price
		t.Fatalf("status value should be $8, got %v", recs[1].ValueUSD)
	}
	// Custom metric pricing.
	custom := []BusinessSignal{{WorkflowID: "w3", Source: SourceCustom, MetricName: "tickets", MetricValue: 4}}
	recs2 := Correlate([]WorkflowCost{{WorkflowID: "w3", CostUSD: 1}}, custom, 8.0, 2.0)
	if recs2[0].ValueUSD != 8.0 {
		t.Fatalf("custom 4 × $2 should be $8, got %v", recs2[0].ValueUSD)
	}
	// Unattributed spend stays visible.
	recs3 := Correlate([]WorkflowCost{{WorkflowID: "w9", CostUSD: 3}}, nil, 8.0, 0)
	if len(recs3) != 1 || recs3[0].ValueUSD != 0 {
		t.Fatalf("unattributed spend must surface with 0 value: %+v", recs3)
	}
	sum := Summarize(recs)
	if sum.Workflows != 2 || math.Abs(sum.TotalCost-2.70) > 1e-9 || math.Abs(sum.TotalValue-53) > 1e-9 {
		t.Fatalf("bad summary: %+v", sum)
	}
	if sum.Attribution != 1.0 {
		t.Fatalf("both attributed: %v", sum.Attribution)
	}
}

func TestYieldWin(t *testing.T) {
	before := []WorkflowOutcome{
		{WorkflowID: "a", CostUSD: 2.30, Success: true, Quality: 0.9},
		{WorkflowID: "b", CostUSD: 2.30, Success: true, Quality: 0.9},
		{WorkflowID: "c", CostUSD: 2.30, Success: false},
	}
	// After: same successes/quality at ~40% lower cost → win.
	after := []WorkflowOutcome{
		{WorkflowID: "a", CostUSD: 1.38, Success: true, Quality: 0.9},
		{WorkflowID: "b", CostUSD: 1.38, Success: true, Quality: 0.9},
		{WorkflowID: "c", CostUSD: 1.38, Success: false},
	}
	win, reason, bR, aR := CompareYield(before, after)
	if !win {
		t.Fatalf("yield flat + cost down must win: %s (%.4f → %.4f)", reason, bR.TokenYieldRate, aR.TokenYieldRate)
	}
	if aR.TotalCostUSD >= bR.TotalCostUSD {
		t.Fatal("after must cost less")
	}
}

func TestYieldRegressionBlocksWin(t *testing.T) {
	before := []WorkflowOutcome{{WorkflowID: "a", CostUSD: 2.0, Success: true, Quality: 0.9}}
	after := []WorkflowOutcome{{WorkflowID: "a", CostUSD: 1.0, Success: true, Quality: 0.4}}
	win, reason, _, _ := CompareYield(before, after)
	if win {
		t.Fatal("quality collapse must NOT win even when cheaper")
	}
	t.Logf("correctly blocked: %s", reason)
	// Cost increase never wins either.
	win2, _, _, _ := CompareYield(after, before)
	if win2 {
		t.Fatal("cost increase must not win")
	}
	// Empty is safe.
	if r := ComputeYield(nil); r.Workflows != 0 || r.TokenYieldRate != 0 {
		t.Fatalf("empty yield must be zero: %+v", r)
	}
}
