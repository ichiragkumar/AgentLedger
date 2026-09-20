package brain

import (
	"math"
	"math/rand"
	"testing"
)

// workflowFixture is the 3-step chain from the design doc:
// plan → heavy → format. Numbers chosen so the topology-aware answer
// (frontier plan, standard heavy, cheap format) beats BOTH uniform-frontier
// (>25%) and naive cheapest-passing — the "why per-request routing is
// broken" demo in one fixture.
func workflowFixture() (*Graph, map[string]Step) {
	g := BuildGraph("w", []Span{
		{ChainID: "w", AgentID: "plan", Success: true},
		{ChainID: "w", AgentID: "heavy", ParentAgentID: "plan", Success: true},
		{ChainID: "w", AgentID: "format", ParentAgentID: "heavy", Success: true},
	})
	steps := map[string]Step{
		"plan": {
			AgentID: "plan", MinQuality: 0.80,
			Options: []ModelOption{
				{Name: "frontier", CostUSD: 0.30, FailureRate: 0.05, Quality: 0.99},
				{Name: "cheap", CostUSD: 0.05, FailureRate: 0.70, Quality: 0.85},
			},
		},
		"heavy": {
			AgentID: "heavy", MinQuality: 0.90,
			Options: []ModelOption{
				{Name: "pro", CostUSD: 2.00, FailureRate: 0.02, Quality: 0.99},
				{Name: "standard", CostUSD: 1.50, FailureRate: 0.10, Quality: 0.95},
			},
		},
		"format": {
			AgentID: "format", MinQuality: 0.80,
			Options: []ModelOption{
				{Name: "pro", CostUSD: 0.30, FailureRate: 0.02, Quality: 0.99},
				{Name: "cheap", CostUSD: 0.02, FailureRate: 0.15, Quality: 0.85},
			},
		},
	}
	return g, steps
}

func TestExpectedTotalHandComputed(t *testing.T) {
	g, steps := workflowFixture()
	a := Assignment{"plan": "frontier", "heavy": "standard", "format": "cheap"}
	total, ok := ExpectedTotal(g, steps, a)
	if !ok {
		t.Fatal("assignment must be feasible")
	}
	// direct 1.82 + plan .05*(.3+1.52) + heavy .10*(1.5+.02) + format .15*.02
	want := 1.82 + 0.05*1.82 + 0.10*1.52 + 0.15*0.02
	if math.Abs(total-want) > 1e-9 {
		t.Fatalf("want %.6f, got %.6f", want, total)
	}
}

func TestExpectedTotalRejects(t *testing.T) {
	g, steps := workflowFixture()
	// Unknown model.
	if _, ok := ExpectedTotal(g, steps, Assignment{"plan": "nope", "heavy": "standard", "format": "cheap"}); ok {
		t.Fatal("unknown model must be infeasible")
	}
	// Missing step.
	if _, ok := ExpectedTotal(g, steps, Assignment{"plan": "cheap", "heavy": "standard"}); ok {
		t.Fatal("missing step must be infeasible")
	}
	// Quality floor: standard (0.95) on heavy passes 0.90; force a violation
	// with a floor no option meets.
	steps["heavy"] = Step{AgentID: "heavy", MinQuality: 0.999, Options: steps["heavy"].Options}
	if _, ok := ExpectedTotal(g, steps, Assignment{"plan": "cheap", "heavy": "standard", "format": "cheap"}); ok {
		t.Fatal("quality violation must be infeasible")
	}
}

func TestOptimizePicksTopologyAwarePlan(t *testing.T) {
	g, steps := workflowFixture()
	plan := Optimize(g, steps)
	if !plan.Feasible {
		t.Fatal("must be feasible")
	}
	// The cheap plan model PASSES the quality floor (0.85 ≥ 0.80) so a
	// per-call router picks it — but topology must pick frontier because a
	// 70% failure above $1.52 downstream is catastrophic.
	if plan.Assignment["plan"] != "frontier" {
		t.Fatalf("plan must be frontier, got %v", plan.Assignment)
	}
	if plan.Assignment["heavy"] != "standard" {
		t.Fatalf("heavy must be standard, got %v", plan.Assignment)
	}
	if plan.Assignment["format"] != "cheap" {
		t.Fatalf("format (leaf, no downstream) must be cheap, got %v", plan.Assignment)
	}
	// ...and it must beat the naive cheapest-passing assignment.
	naive := Assignment{"plan": "cheap", "heavy": "standard", "format": "cheap"}
	naiveTotal, ok := ExpectedTotal(g, steps, naive)
	if !ok {
		t.Fatal("naive must be feasible")
	}
	if plan.ExpectedTotalUSD >= naiveTotal {
		t.Fatalf("topology %.4f must beat naive-cheapest %.4f", plan.ExpectedTotalUSD, naiveTotal)
	}
}

func TestSavingsVsUniformOver25(t *testing.T) {
	g, steps := workflowFixture()
	plan := Optimize(g, steps)
	sav, ok := SavingsVsUniform(g, steps, plan)
	if !ok {
		t.Fatal("savings computable")
	}
	if sav < 0.25 {
		t.Fatalf("need ≥25%% vs uniform-frontier, got %.2f%%", sav*100)
	}
	t.Logf("workflow savings vs uniform-frontier: %.1f%%", sav*100)
}

func TestOptimizeMatchesBruteForce(t *testing.T) {
	g, steps := workflowFixture()
	got := Optimize(g, steps)
	want := BruteForce(g, steps)
	if !want.Feasible || !got.Feasible {
		t.Fatal("both must be feasible")
	}
	if got.Assignment["plan"] != want.Assignment["plan"] ||
		got.Assignment["heavy"] != want.Assignment["heavy"] ||
		got.Assignment["format"] != want.Assignment["format"] {
		t.Fatalf("Optimize %v != BruteForce %v", got.Assignment, want.Assignment)
	}
	if math.Abs(got.ExpectedTotalUSD-want.ExpectedTotalUSD) > 1e-9 {
		t.Fatalf("totals differ: %v vs %v", got.ExpectedTotalUSD, want.ExpectedTotalUSD)
	}
}

// TestOptimizeWithin10PctRandomized fuzzes small graphs: Optimize must stay
// within 10% of BruteForce optimal (it is exact here, so this guards the
// greedy fallback boundary too).
func TestOptimizeWithin10PctRandomized(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	for trial := 0; trial < 50; trial++ {
		n := 2 + rng.Intn(3) // 2-4 steps
		chain := "fuzz"
		var spans []Span
		prev := ""
		var agents []string
		for i := 0; i < n; i++ {
			id := string(rune('a' + i))
			agents = append(agents, id)
			spans = append(spans, Span{ChainID: chain, AgentID: id, ParentAgentID: prev, Success: true})
			prev = id
		}
		g := BuildGraph(chain, spans)
		steps := map[string]Step{}
		for _, a := range agents {
			m := 2 + rng.Intn(2) // 2-3 models
			var opts []ModelOption
			for j := 0; j < m; j++ {
				cost := 0.01 + rng.Float64()*2.0
				fail := rng.Float64() * 0.6
				q := 0.7 + rng.Float64()*0.29
				opts = append(opts, ModelOption{
					Name:        string(rune('m' + j)),
					CostUSD:     cost,
					FailureRate: fail,
					Quality:     q,
				})
			}
			steps[a] = Step{AgentID: a, MinQuality: 0.70, Options: opts}
		}
		want := BruteForce(g, steps)
		if !want.Feasible {
			continue
		}
		got := Optimize(g, steps)
		if !got.Feasible {
			t.Fatalf("trial %d: feasible optimum exists but Optimize gave up", trial)
		}
		if got.ExpectedTotalUSD > want.ExpectedTotalUSD*1.10+1e-9 {
			t.Fatalf("trial %d: %.4f > 110%% of optimal %.4f", trial, got.ExpectedTotalUSD, want.ExpectedTotalUSD)
		}
	}
}

func TestHeuristicPathWithin10Pct(t *testing.T) {
	g, steps := workflowFixture()
	old := MaxCombos
	MaxCombos = 1 // force greedy + hill-climb
	defer func() { MaxCombos = old }()
	got := Optimize(g, steps)
	want := BruteForce(g, steps)
	if !got.Feasible {
		t.Fatal("heuristic must stay feasible on fixture")
	}
	if got.ExpectedTotalUSD > want.ExpectedTotalUSD*1.10+1e-9 {
		t.Fatalf("heuristic %.4f > 110%% of optimal %.4f", got.ExpectedTotalUSD, want.ExpectedTotalUSD)
	}
}

func TestOptimizeWithBudget(t *testing.T) {
	g, steps := workflowFixture()
	opt := Optimize(g, steps)
	// Generous budget: same plan, not over budget.
	p := OptimizeWithBudget(g, steps, opt.ExpectedTotalUSD+1)
	if !p.Feasible || p.OverBudget {
		t.Fatalf("generous budget must pass: %+v", p)
	}
	// Tight budget: feasible plan exists but exceeds it → flag, don't hide.
	p = OptimizeWithBudget(g, steps, 0.01)
	if !p.Feasible || !p.OverBudget {
		t.Fatalf("tight budget must flag OverBudget: %+v", p)
	}
	// No budget (0) = uncapped.
	p = OptimizeWithBudget(g, steps, 0)
	if !p.Feasible || p.OverBudget {
		t.Fatalf("uncapped must behave like Optimize: %+v", p)
	}
	// Empty options → infeasible, never panics.
	bad := map[string]Step{"plan": {AgentID: "plan", Options: nil}}
	if q := Optimize(g, bad); q.Feasible {
		t.Fatal("empty options must be infeasible")
	}
	if q := Optimize(g, map[string]Step{}); q.Feasible {
		t.Fatal("no steps must be infeasible")
	}
}

func TestApplyTopology(t *testing.T) {
	scores := []ScoredStep{
		{AgentID: "plan", Score: 0.9, Tier: "frontier"},
		{AgentID: "format", Score: 0.1, Tier: "cheap"},
	}
	// Nil selector: tier passthrough (tests/offline).
	a := ApplyTopology(scores, nil)
	if a["plan"] != "frontier" || a["format"] != "cheap" {
		t.Fatalf("passthrough broken: %v", a)
	}
	// Router selector: brain tiers become concrete model names, router owns them.
	sel := func(agent, tier string) string {
		if tier == "frontier" {
			return "claude-sonnet-4"
		}
		return "gemini-2.0-flash"
	}
	a = ApplyTopology(scores, sel)
	if a["plan"] != "claude-sonnet-4" || a["format"] != "gemini-2.0-flash" {
		t.Fatalf("selector mapping broken: %v", a)
	}
}

func TestUniformTopAssignment(t *testing.T) {
	_, steps := workflowFixture()
	a, ok := UniformTopAssignment(steps)
	if !ok {
		t.Fatal("must be feasible")
	}
	if a["plan"] != "frontier" || a["heavy"] != "pro" || a["format"] != "pro" {
		t.Fatalf("uniform-top must pick priciest passing: %v", a)
	}
	impossible := map[string]Step{"x": {AgentID: "x", MinQuality: 2.0, Options: []ModelOption{{Name: "m", Quality: 0.5}}}}
	if _, ok := UniformTopAssignment(impossible); ok {
		t.Fatal("impossible floor must fail")
	}
}
