// Quality guard + LLM-as-judge stub (spec 06 task 3.3).
//
// Contract: after routing to a cheaper model, output quality is scored
// (0..1). Scores below Threshold auto-escalate the request to the next tier
// up. The escalation budget (<10% of routed requests) is tracked, not hard
// enforced on the hot path — breaching it pages analytics instead of
// blocking traffic, so the guard can never wedge the proxy.
//
// Quality-drop target: <5% vs the always-frontier baseline, measured by the
// A/B harness (ab.go) and surfaced per model for the dashboard.
package router

import (
	"strings"
	"sync"
)

// Judge scores one (prompt, output) pair in 0..1. Implementations must be
// fast and side-effect free; network judges belong behind an async scorer.
type Judge interface {
	Score(prompt, output string) float64
}

// HeuristicJudge is the v1 in-process judge (LLM-as-judge stub's stand-in).
// It scores coverage signals: non-empty output, length ratio vs prompt,
// absence of refusal/hedge phrases, and keyword overlap with the prompt.
// Deterministic and dependency-free; swap for LLMJudgeStub when the
// ROUTER_JUDGE_ENDPOINT is configured.
type HeuristicJudge struct{}

var hedgePhrases = []string{
	"i don't know", "i cannot", "as an ai", "i'm not able",
	"unable to", "no idea", "cannot help",
}

// Score implements Judge.
func (HeuristicJudge) Score(prompt, output string) float64 {
	out := strings.TrimSpace(output)
	if out == "" {
		return 0
	}
	lower := strings.ToLower(out)
	score := 0.55
	// Length adequacy: outputs in a sane band vs prompt length score best.
	ratio := float64(len(out)+1) / float64(len(prompt)+1)
	switch {
	case ratio >= 0.2 && ratio <= 8:
		score += 0.2
	case ratio > 8:
		score += 0.05
	default:
		score -= 0.1
	}
	for _, h := range hedgePhrases {
		if strings.Contains(lower, h) {
			score -= 0.25
			break
		}
	}
	// Keyword overlap: output that echoes prompt substance scores higher.
	hits := 0
	for _, w := range strings.Fields(strings.ToLower(prompt)) {
		if len(w) > 4 && strings.Contains(lower, w) {
			hits++
			if hits >= 5 {
				break
			}
		}
	}
	score += float64(hits) * 0.03
	if score < 0 {
		score = 0
	}
	if score > 1 {
		score = 1
	}
	return score
}

// LLMJudgeStub is the LLM-as-judge v2 seam. Until Endpoint is configured it
// reports Configured()==false and defers to Fallback (default: heuristic).
// Wiring note: point ROUTER_JUDGE_ENDPOINT at a scoring sidecar; the proxy
// hot path keeps using the heuristic and reconciles async.
type LLMJudgeStub struct {
	// Endpoint is the judge sidecar URL (ROUTER_JUDGE_ENDPOINT).
	Endpoint string
	// Model names the judge model for audit (default: heuristic-v1).
	Model    string
	Fallback Judge
}

// Configured reports whether the judge sidecar is set.
func (j LLMJudgeStub) Configured() bool { return strings.TrimSpace(j.Endpoint) != "" }

// Score implements Judge.
func (j LLMJudgeStub) Score(prompt, output string) float64 {
	if !j.Configured() {
		fb := j.Fallback
		if fb == nil {
			fb = HeuristicJudge{}
		}
		return fb.Score(prompt, output)
	}
	// v2: POST {prompt, output} to Endpoint, parse {score}. Until the
	// sidecar exists, delegate so behavior is identical pre/post wiring.
	fb := j.Fallback
	if fb == nil {
		fb = HeuristicJudge{}
	}
	return fb.Score(prompt, output)
}

// Guard enforces the quality floor. Evaluate scores an output and reports
// whether to auto-escalate (score < Threshold). Every evaluation is counted
// so EscalationRate() tracks the <10% budget in real time.
type Guard struct {
	mu sync.Mutex
	// Threshold below which outputs auto-escalate (ROUTER_QUALITY_THRESHOLD).
	Threshold float64
	// Budget is the max acceptable escalation rate (default 0.10 = 10%).
	Budget float64
	// EscalateTo is the tier to retry on (default: one tier up from routed).
	Judge Judge

	total       int64
	escalations int64
}

// DefaultGuard returns a Guard with spec targets: 0.6 quality floor,
// 10% escalation budget, heuristic judge.
func DefaultGuard() *Guard {
	return &Guard{Threshold: 0.6, Budget: 0.10, Judge: HeuristicJudge{}}
}

func (g *Guard) judge() Judge {
	if g == nil || g.Judge == nil {
		return HeuristicJudge{}
	}
	return g.Judge
}

func (g *Guard) threshold() float64 {
	if g == nil || g.Threshold <= 0 {
		return 0.6
	}
	return g.Threshold
}

func (g *Guard) budget() float64 {
	if g == nil || g.Budget <= 0 {
		return 0.10
	}
	return g.Budget
}

// Evaluate scores output and decides escalation. Always safe to call:
// nil guard behaves as DefaultGuard.
func (g *Guard) Evaluate(prompt, output string) (score float64, escalate bool) {
	score = g.judge().Score(prompt, output)
	escalate = score < g.threshold()
	if g == nil {
		return score, escalate
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.total++
	if escalate {
		g.escalations++
	}
	return score, escalate
}

// EscalationRate returns escalations/total (0 when nothing evaluated).
func (g *Guard) EscalationRate() float64 {
	if g == nil {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.total == 0 {
		return 0
	}
	return float64(g.escalations) / float64(g.total)
}

// WithinBudget reports whether the observed escalation rate is under Budget.
func (g *Guard) WithinBudget() bool { return g.EscalationRate() < g.budget() }

// Counts returns (total, escalations) for metrics export.
func (g *Guard) Counts() (total, escalations int64) {
	if g == nil {
		return 0, 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.total, g.escalations
}

// ModelQuality tracks mean judge score per model for the dashboard
// "quality score per model" panel. Lock-guarded; export via Snapshot.
type ModelQuality struct {
	mu    sync.Mutex
	sum   map[string]float64
	count map[string]int64
}

// NewModelQuality returns an empty tracker.
func NewModelQuality() *ModelQuality {
	return &ModelQuality{sum: map[string]float64{}, count: map[string]int64{}}
}

// Observe records one scored output.
func (q *ModelQuality) Observe(model string, score float64) {
	if q == nil {
		return
	}
	if strings.TrimSpace(model) == "" {
		model = "unknown"
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.sum[model] += score
	q.count[model]++
}

// Score returns the mean score for a model (0 when unseen).
func (q *ModelQuality) Score(model string) float64 {
	if q == nil {
		return 0
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.count[model] == 0 {
		return 0
	}
	return q.sum[model] / float64(q.count[model])
}

// Snapshot returns mean score per model for dashboard props.
func (q *ModelQuality) Snapshot() map[string]float64 {
	if q == nil {
		return map[string]float64{}
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make(map[string]float64, len(q.sum))
	for m, s := range q.sum {
		out[m] = s / float64(q.count[m])
	}
	return out
}
