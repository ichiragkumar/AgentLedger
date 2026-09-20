// Workflow cost optimizer: assign one model per step to minimize TOTAL
// expected workflow cost INCLUDING retry cost — not per-call cost.
//
// Expected-cost model (per assignment):
//
//	E_total = Σ_i c_i + Σ_i p_i · (c_i + Σ_{j ∈ descendants(i)} c_j)
//
// where c_i is the direct cost of step i's assigned model and p_i its
// failure probability on that model. The second term is the insight
// per-request routers miss: when an early step fails, you repay its own
// retry AND every downstream dollar is wasted. A cheap planner with p=0.7
// sitting above $1.50 of downstream is far more expensive than a $0.30
// frontier planner with p=0.05 — even though per-call routing picks cheap.
//
// Search: exhaustive when combinations ≤ MaxCombos (small graphs: exact
// optimum, so "within 10% of brute-force" holds trivially), otherwise
// criticality-greedy seed + hill-climbing passes. Quality floors and the
// Enforcer budget are hard constraints, never soft penalties.
package brain

import (
	"math"
	"sort"
)

// MaxCombos caps exhaustive search. Above it Optimize switches to
// greedy + hill-climb (serving path stays fast on 20-node graphs).
var MaxCombos = 65536

// ModelOption is one candidate model for a step. All numbers are per single
// execution of THIS step (cost already folds in expected tokens × price).
// Model names are plain strings: Brain extends the Router, never forks it —
// the chosen names flow back through RouterSelector (see below).
type ModelOption struct {
	Name        string
	CostUSD     float64 // direct cost of one execution
	FailureRate float64 // P(failure) of this step on this model, 0..1
	Quality     float64 // 0..1 expected output quality
}

// Step is one workflow node plus its feasible models. Options MUST already
// exclude Enforcer-denied models (policy denylist applied by the caller).
type Step struct {
	AgentID    string
	Options    []ModelOption
	MinQuality float64 // steps below this quality are infeasible
}

// Assignment maps agent ID -> chosen model name.
type Assignment map[string]string

// Plan is one optimized workflow assignment.
type Plan struct {
	Assignment       Assignment
	ExpectedTotalUSD float64
	// Feasible is false when no assignment meets quality (or budget).
	Feasible bool
	// OverBudget is true when quality-feasible plans exist but all exceed
	// MaxBudgetUSD. The returned assignment is then the cheapest feasible.
	MaxBudgetUSD float64
	OverBudget   bool
}

// RouterSelector is the Phase-3 per-call router surface, referenced by NAME
// only. Brain never imports internal/router (no cycles): the serving path
// calls ApplyTopology to turn criticality tiers into concrete model names
// via whatever selector the Router phase registered.
type RouterSelector func(agentID, tier string) (model string)

// ApplyTopology maps scored tiers through the router selector. When sel is
// nil it falls back to tier name passthrough ("frontier"/"standard"/"cheap")
// so the optimizer still runs in tests and offline jobs.
func ApplyTopology(scores []ScoredStep, sel RouterSelector) Assignment {
	a := Assignment{}
	for _, s := range scores {
		if sel != nil {
			a[s.AgentID] = sel(s.AgentID, s.Tier)
		} else {
			a[s.AgentID] = s.Tier
		}
	}
	return a
}

// lookup finds the option behind an assignment entry.
func lookup(steps map[string]Step, a Assignment, agent string) (ModelOption, bool) {
	st, ok := steps[agent]
	if !ok {
		return ModelOption{}, false
	}
	want, ok := a[agent]
	if !ok {
		return ModelOption{}, false
	}
	for _, o := range st.Options {
		if o.Name == want {
			return o, true
		}
	}
	return ModelOption{}, false
}

// ExpectedTotal evaluates an assignment. ok=false when a step is unassigned,
// names an unknown model, or violates its quality floor.
func ExpectedTotal(g *Graph, steps map[string]Step, a Assignment) (total float64, ok bool) {
	direct := make(map[string]float64, len(steps))
	failP := make(map[string]float64, len(steps))
	for agent, st := range steps {
		// Skip placeholder nodes (never observed): they carry no steps.
		if n, exists := g.Nodes[agent]; !exists || n.Calls == 0 {
			continue
		}
		o, found := lookup(steps, a, agent)
		if !found {
			return 0, false
		}
		if o.Quality < st.MinQuality {
			return 0, false
		}
		direct[agent] = o.CostUSD
		p := o.FailureRate
		if p < 0 {
			p = 0
		}
		if p > 1 {
			p = 1
		}
		failP[agent] = p
		total += o.CostUSD
	}
	for agent := range direct {
		downstream := 0.0
		for _, d := range g.Descendants(agent) {
			downstream += direct[d]
		}
		total += failP[agent] * (direct[agent] + downstream)
	}
	return total, true
}

// BruteForce enumerates every assignment (small graphs only) and returns the
// cheapest quality-feasible plan. Tests compare Optimize against this.
func BruteForce(g *Graph, steps map[string]Step) Plan {
	agents := sortedLiveAgents(g, steps)
	if len(agents) == 0 {
		return Plan{Assignment: Assignment{}, Feasible: false}
	}
	best := Plan{Assignment: Assignment{}, ExpectedTotalUSD: math.Inf(1)}
	idx := make([]int, len(agents))
	for {
		a := Assignment{}
		for i, agent := range agents {
			a[agent] = steps[agent].Options[idx[i]].Name
		}
		if total, ok := ExpectedTotal(g, steps, a); ok && total < best.ExpectedTotalUSD {
			cp := Assignment{}
			for k, v := range a {
				cp[k] = v
			}
			best = Plan{Assignment: cp, ExpectedTotalUSD: total, Feasible: true}
		}
		// odometer increment
		pos := len(idx) - 1
		for pos >= 0 {
			idx[pos]++
			if idx[pos] < len(steps[agents[pos]].Options) {
				break
			}
			idx[pos] = 0
			pos--
		}
		if pos < 0 {
			break
		}
	}
	return best
}

// Optimize returns the min-expected-cost plan. Exact (== BruteForce) when
// the search space fits MaxCombos, greedy + hill-climb otherwise — the
// acceptance bar is "within 10% of brute-force optimal on small graphs",
// and small graphs are solved exactly.
func Optimize(g *Graph, steps map[string]Step) Plan {
	return OptimizeWithBudget(g, steps, 0)
}

// OptimizeWithBudget adds the Enforcer hard cap: maxUSD <= 0 means no cap.
// When nothing fits the budget, it returns the cheapest quality-feasible
// plan with OverBudget=true so the caller can downgrade/deny instead of
// silently overspending.
func OptimizeWithBudget(g *Graph, steps map[string]Step, maxUSD float64) Plan {
	agents := sortedLiveAgents(g, steps)
	if len(agents) == 0 {
		return Plan{Assignment: Assignment{}, Feasible: false}
	}
	for _, agent := range agents {
		if len(steps[agent].Options) == 0 {
			return Plan{Assignment: Assignment{}, Feasible: false}
		}
	}
	combos := 1
	overflow := false
	for _, agent := range agents {
		combos *= len(steps[agent].Options)
		if combos > MaxCombos {
			overflow = true
			break
		}
	}
	var best Plan
	if !overflow {
		best = BruteForce(g, steps)
	} else {
		best = greedyThenClimb(g, steps, agents)
	}
	if !best.Feasible {
		return best
	}
	best.MaxBudgetUSD = maxUSD
	if maxUSD > 0 && best.ExpectedTotalUSD > maxUSD {
		best.OverBudget = true
	}
	return best
}

// sortedLiveAgents lists step agents present in the graph, sorted.
func sortedLiveAgents(g *Graph, steps map[string]Step) []string {
	var out []string
	for agent := range steps {
		if n, ok := g.Nodes[agent]; ok && n.Calls > 0 {
			out = append(out, agent)
		}
	}
	sort.Strings(out)
	return out
}

// greedyThenClimb seeds from criticality (high-score steps get their most
// reliable option) then hill-climbs single-step changes to a local optimum.
func greedyThenClimb(g *Graph, steps map[string]Step, agents []string) Plan {
	stats := map[string]StepStats{}
	for _, agent := range agents {
		// Seed failure stats from each step's cheapest option so the greedy
		// pass has a failure signal even with zero history.
		if len(steps[agent].Options) > 0 {
			cheapest := steps[agent].Options[0]
			for _, o := range steps[agent].Options {
				if o.CostUSD < cheapest.CostUSD {
					cheapest = o
				}
			}
			stats[agent] = StepStats{AgentID: agent, Calls: 10, Failures: int(cheapest.FailureRate * 10)}
		}
	}
	avgCost := map[string]float64{}
	for _, agent := range agents {
		cheapest := steps[agent].Options[0]
		for _, o := range steps[agent].Options {
			if o.CostUSD < cheapest.CostUSD {
				cheapest = o
			}
		}
		avgCost[agent] = cheapest.CostUSD
	}
	scores := ScoreSteps(g, stats, avgCost)
	rank := map[string]int{}
	for i, s := range scores {
		rank[s.AgentID] = i
	}
	// Greedy: most critical steps get most reliable passing option, least
	// critical get cheapest passing option, middle splits.
	cur := Assignment{}
	for _, agent := range agents {
		opts := passingOptions(steps[agent])
		if len(opts) == 0 {
			return Plan{Assignment: Assignment{}, Feasible: false}
		}
		byRel := append([]ModelOption{}, opts...)
		sort.Slice(byRel, func(i, j int) bool { return byRel[i].FailureRate < byRel[j].FailureRate })
		byCost := append([]ModelOption{}, opts...)
		sort.Slice(byCost, func(i, j int) bool { return byCost[i].CostUSD < byCost[j].CostUSD })
		r := float64(rank[agent]) / float64(len(agents)) // 0 = most critical
		switch {
		case r < 0.33:
			cur[agent] = byRel[0].Name
		case r < 0.66:
			// middle: best reliability-per-dollar among passing
			best := byCost[0]
			bestRatio := valueRatio(best)
			for _, o := range byCost[1:] {
				if v := valueRatio(o); v > bestRatio {
					best, bestRatio = o, v
				}
			}
			cur[agent] = best.Name
		default:
			cur[agent] = byCost[0].Name
		}
	}
	curTotal, ok := ExpectedTotal(g, steps, cur)
	if !ok {
		return Plan{Assignment: Assignment{}, Feasible: false}
	}
	// Hill-climb until no single-step change improves.
	improved := true
	for improved {
		improved = false
		for _, agent := range agents {
			for _, o := range passingOptions(steps[agent]) {
				if o.Name == cur[agent] {
					continue
				}
				trial := copyAssign(cur)
				trial[agent] = o.Name
				t, ok := ExpectedTotal(g, steps, trial)
				if ok && t < curTotal-1e-12 {
					cur, curTotal = trial, t
					improved = true
				}
			}
		}
	}
	return Plan{Assignment: cur, ExpectedTotalUSD: curTotal, Feasible: true}
}

// valueRatio scores reliability per dollar for middle-tier seeding.
func valueRatio(o ModelOption) float64 {
	return (1 - o.FailureRate) / (o.CostUSD + 1e-9)
}

// passingOptions returns options meeting the quality floor, cheapest first.
func passingOptions(st Step) []ModelOption {
	var out []ModelOption
	for _, o := range st.Options {
		if o.Quality >= st.MinQuality {
			out = append(out, o)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CostUSD < out[j].CostUSD })
	return out
}

func copyAssign(a Assignment) Assignment {
	cp := Assignment{}
	for k, v := range a {
		cp[k] = v
	}
	return cp
}

// UniformTopAssignment assigns every step its most expensive
// quality-passing option — the "we just use frontier everywhere" baseline
// the case study measures against. Returns ok=false if any step has no
// passing option.
func UniformTopAssignment(steps map[string]Step) (Assignment, bool) {
	a := Assignment{}
	for agent, st := range steps {
		pass := passingOptions(st)
		if len(pass) == 0 {
			return nil, false
		}
		a[agent] = pass[len(pass)-1].Name
	}
	return a, true
}

// SavingsVsUniform returns the fractional savings of plan vs the uniform
// frontier baseline (0.25 = 25% cheaper). ok=false when the baseline is
// infeasible or has zero cost.
func SavingsVsUniform(g *Graph, steps map[string]Step, plan Plan) (savings float64, ok bool) {
	base, feasible := UniformTopAssignment(steps)
	if !feasible || !plan.Feasible {
		return 0, false
	}
	baseTotal, ok := ExpectedTotal(g, steps, base)
	if !ok || baseTotal <= 0 {
		return 0, false
	}
	return (baseTotal - plan.ExpectedTotalUSD) / baseTotal, true
}
