// Step criticality scoring: "if this step fails, downstream $X is wasted."
//
// Score = wPos*position + wWaste*wasteNorm + wFail*failureRate, each factor
// in [0,1], weights summing to 1. The serving path uses fixed default
// weights; an offline Python/ML job may fit better weights from historical
// outcomes and push them via SetWeights (Learner plan: +5% decision quality
// in 7 days of prod data — see learner.go).
package brain

import (
	"math"
	"sort"
	"sync"
)

// Criticality weights. Defaults encode the Phase 5 thesis: downstream waste
// dominates (a cheap planner that fails wastes the whole swarm), position
// matters (early failures cascade), history corrects (flaky steps earn
// frontier even late in the chain).
var (
	weightsMu sync.RWMutex
	wPos      = 0.25
	wWaste    = 0.50
	wFail     = 0.25
)

// PriorFailureRate is the Laplace prior for steps with no history.
const PriorFailureRate = 0.10

// SetWeights overrides the scoring weights (offline ML loop). Must sum to
// ~1; returns false and keeps old weights otherwise.
func SetWeights(pos, waste, fail float64) bool {
	if pos < 0 || waste < 0 || fail < 0 {
		return false
	}
	if math.Abs(pos+waste+fail-1.0) > 1e-6 {
		return false
	}
	weightsMu.Lock()
	defer weightsMu.Unlock()
	wPos, wWaste, wFail = pos, waste, fail
	return true
}

// GetWeights returns the current weights.
func GetWeights() (pos, waste, fail float64) {
	weightsMu.RLock()
	defer weightsMu.RUnlock()
	return wPos, wWaste, wFail
}

// StepStats aggregates history for one agent step.
type StepStats struct {
	AgentID    string
	Calls      int
	Failures   int
	AvgCostUSD float64
	AvgQuality float64 // 0..1 judge score, optional (0 = unknown)
}

// FailureRate returns the Laplace-smoothed historical failure rate so a
// step with 1 call / 1 failure does not score as "always fails".
func (s StepStats) FailureRate() float64 {
	return float64(s.Failures+1) / float64(s.Calls+2)
}

// RawFailureRate is the unsmoothed rate (for dashboards).
func (s StepStats) RawFailureRate() float64 {
	if s.Calls == 0 {
		return PriorFailureRate
	}
	return float64(s.Failures) / float64(s.Calls)
}

// DownstreamWaste estimates "if this step fails, downstream $X is wasted":
// the sum of expected per-execution costs of all descendants. costOf gives
// the expected direct cost of one execution of an agent (historical average
// or the candidate model's price — the optimizer passes the latter).
func DownstreamWaste(g *Graph, agentID string, costOf func(string) float64) float64 {
	total := 0.0
	for _, d := range g.Descendants(agentID) {
		total += costOf(d)
	}
	return total
}

// ScoredStep is one step with its criticality breakdown.
type ScoredStep struct {
	AgentID            string
	Score              float64 // 0..1, higher = more critical
	Depth              int
	PositionFactor     float64
	DownstreamWasteUSD float64
	WasteFactor        float64
	FailureRate        float64
	Tier               string // "frontier" | "standard" | "cheap"
}

// TierFor maps a score to a routing tier. Thresholds are deliberately coarse:
// high-stakes → frontier, low-stakes → cheapest (spec 08, task 5.3).
func TierFor(score float64) string {
	switch {
	case score >= 0.60:
		return "frontier"
	case score >= 0.30:
		return "standard"
	default:
		return "cheap"
	}
}

// ScoreSteps scores every live node in g. stats may be nil (all priors).
// avgCost maps agent -> expected direct cost per execution; when absent for
// an agent the graph's observed average is used.
func ScoreSteps(g *Graph, stats map[string]StepStats, avgCost map[string]float64) []ScoredStep {
	depths := g.Depths()
	maxDepth := 0
	for _, d := range depths {
		if d > maxDepth {
			maxDepth = d
		}
	}
	costOf := func(agent string) float64 {
		if avgCost != nil {
			if c, ok := avgCost[agent]; ok {
				return c
			}
		}
		if n, ok := g.Nodes[agent]; ok && n.Calls > 0 {
			return n.TotalCost / float64(n.Calls)
		}
		return 0
	}
	type pending struct {
		id    string
		depth int
		pos   float64
		waste float64
		fail  float64
	}
	var list []pending
	maxWaste := 0.0
	for id, n := range g.Nodes {
		if n.Calls == 0 {
			continue
		}
		d := depths[id]
		pos := 0.0
		if maxDepth > 0 {
			// Early steps are more critical: 1 at root, 0 at max depth.
			pos = 1.0 - float64(d)/float64(maxDepth)
		} else {
			pos = 0.5 // single-node chain: neutral position
		}
		waste := DownstreamWaste(g, id, costOf)
		if waste > maxWaste {
			maxWaste = waste
		}
		fail := PriorFailureRate
		if s, ok := stats[id]; ok {
			fail = s.FailureRate()
		} else if n.Calls > 0 {
			fail = float64(n.Failures+1) / float64(n.Calls+2)
		}
		list = append(list, pending{id: id, depth: d, pos: pos, waste: waste, fail: fail})
	}
	wp, ww, wf := GetWeights()
	out := make([]ScoredStep, 0, len(list))
	for _, p := range list {
		wf2 := 0.0
		if maxWaste > 0 {
			wf2 = p.waste / maxWaste
		}
		score := wp*p.pos + ww*wf2 + wf*p.fail
		out = append(out, ScoredStep{
			AgentID:            p.id,
			Score:              score,
			Depth:              p.depth,
			PositionFactor:     p.pos,
			DownstreamWasteUSD: p.waste,
			WasteFactor:        wf2,
			FailureRate:        p.fail,
			Tier:               TierFor(score),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].AgentID < out[j].AgentID
		}
		return out[i].Score > out[j].Score
	})
	return out
}

// WastePredictionError is the relative error |predicted-actual|/actual of a
// "downstream $X" estimate. Validation plan for the ±20% acceptance bar
// (spec 08): on every failed run, record predicted waste at routing time vs
// realized downstream spend that was discarded; the rolling mean error must
// stay < 0.20. Returns 0 when actual is 0 and predicted is 0, 1 when actual
// is 0 but predicted is not (maximally wrong, avoids div-by-zero).
func WastePredictionError(predicted, actual float64) float64 {
	if actual == 0 {
		if predicted == 0 {
			return 0
		}
		return 1
	}
	return math.Abs(predicted-actual) / math.Abs(actual)
}
