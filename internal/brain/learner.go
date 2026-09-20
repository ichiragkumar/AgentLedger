// Learning loop: routing improves from actual outcomes.
//
// Serving path (Go): every finished step calls Learner.Observe; failure
// rates are exponential moving averages, so criticality adapts within hours
// without a retrain. Offline path (Python/ML allowed): a nightly job fits
// better scoring weights from step_stats + roi_signals rows and pushes them
// via SetWeights.
//
// +5% in 7 days validation plan (acceptance: specs/08):
//  1. Split traffic: 90% Brain-optimized, 10% static-baseline (uniform
//     frontier) as control.
//  2. Daily metric: expected-total prediction error
//     |predicted - realized| / realized on failed workflows, plus realized
//     $/workflow on matched pipelines.
//  3. PASS when the Brain arm's $/workflow drops ≥5% over 7 days while the
//     control stays flat (±2%) and token yield (see yield.go) does not drop.
//
// The Learner.StatsSnapshot + StepStats history rows are the audit trail.
package brain

import (
	"sync"
	"time"
)

// Outcome is one finished step execution.
type Outcome struct {
	AgentID   string
	Success   bool
	CostUSD   float64
	Quality   float64 // 0..1, 0 = unjudged
	Timestamp time.Time
}

// DefaultAlpha is the EWMA learning rate: 0.2 adapts to a regime shift in
// ~10 observations while ignoring single outliers.
const DefaultAlpha = 0.2

// Learner holds running per-agent stats. Safe for concurrent use.
type Learner struct {
	mu    sync.Mutex
	alpha float64
	stats map[string]*StepStats
}

// NewLearner returns a Learner with DefaultAlpha.
func NewLearner() *Learner {
	return &Learner{alpha: DefaultAlpha, stats: map[string]*StepStats{}}
}

// NewLearnerWithAlpha returns a Learner with a custom EWMA rate in (0,1].
func NewLearnerWithAlpha(alpha float64) *Learner {
	if alpha <= 0 || alpha > 1 {
		alpha = DefaultAlpha
	}
	return &Learner{alpha: alpha, stats: map[string]*StepStats{}}
}

// Observe folds one outcome into the running stats.
func (l *Learner) Observe(o Outcome) {
	l.mu.Lock()
	defer l.mu.Unlock()
	s, ok := l.stats[o.AgentID]
	if !ok {
		s = &StepStats{AgentID: o.AgentID}
		l.stats[o.AgentID] = s
	}
	s.Calls++
	if !o.Success {
		s.Failures++
	}
	// EWMA on cost and quality (robust to scale shifts, e.g. model repriced).
	if s.Calls == 1 {
		s.AvgCostUSD = o.CostUSD
		s.AvgQuality = o.Quality
	} else {
		s.AvgCostUSD += l.alpha * (o.CostUSD - s.AvgCostUSD)
		if o.Quality > 0 {
			s.AvgQuality += l.alpha * (o.Quality - s.AvgQuality)
		}
	}
}

// FailureRate returns the smoothed failure rate for an agent
// (PriorFailureRate when unseen).
func (l *Learner) FailureRate(agentID string) float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	if s, ok := l.stats[agentID]; ok {
		return s.FailureRate()
	}
	return PriorFailureRate
}

// Snapshot returns a copy of all running stats (for ScoreSteps + export to
// the step_stats table).
func (l *Learner) Snapshot() map[string]StepStats {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make(map[string]StepStats, len(l.stats))
	for k, v := range l.stats {
		out[k] = *v
	}
	return out
}

// UpdateFailureRate is the pure EWMA step (unit-testable without a Learner):
// new = (1-alpha)*prior + alpha*sample, where sample is 1 on failure.
func UpdateFailureRate(prior, alpha float64, failed bool) float64 {
	sample := 0.0
	if failed {
		sample = 1.0
	}
	return (1-alpha)*prior + alpha*sample
}
