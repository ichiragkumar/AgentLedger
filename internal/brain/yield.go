// Token yield rate at WORKFLOW level — the Brain's moat metric.
//
// Per-request routers validate savings with "quality didn't drop". That
// breaks for swarms: a cheap planner can keep per-call quality flat while
// silently multiplying retries and wasted downstream. So Brain validates at
// the workflow level:
//
//	TokenYieldRate = Σ(success ? quality : 0) / TotalCostUSD
//
// i.e. quality-weighted successful workflows per dollar. The optimization
// verdict is then unambiguous:
//
//	"yield flat + cost down = win" (Compare reports Win=true).
//
// If yield drops while cost drops, the optimizer traded quality for dollars
// and must escalate back to frontier on the critical steps.
package brain

// WorkflowOutcome is one finished workflow (chain).
type WorkflowOutcome struct {
	WorkflowID string
	CostUSD    float64
	Success    bool
	Quality    float64 // 0..1 judge score; 0 = unjudged (counts as 1 on success)
}

// YieldReport is the workflow-level validation snapshot.
type YieldReport struct {
	Workflows         int
	SuccessRate       float64
	TotalCostUSD      float64
	CostPerSuccessUSD float64
	TokenYieldRate    float64 // quality-weighted successes per $1
	AvgQuality        float64 // mean quality over successful workflows
	UnjudgedSuccesses int
}

// qualityOf normalizes missing judge scores so unjudged successes neither
// inflate nor zero the yield.
func (o WorkflowOutcome) qualityOf() float64 {
	if !o.Success {
		return 0
	}
	if o.Quality <= 0 {
		return 1
	}
	if o.Quality > 1 {
		return 1
	}
	return o.Quality
}

// ComputeYield folds outcomes into a report.
func ComputeYield(outcomes []WorkflowOutcome) YieldReport {
	r := YieldReport{Workflows: len(outcomes)}
	if len(outcomes) == 0 {
		return r
	}
	successes := 0
	weighted := 0.0
	qSum := 0.0
	qN := 0
	for _, o := range outcomes {
		r.TotalCostUSD += o.CostUSD
		if o.Success {
			successes++
			q := o.qualityOf()
			weighted += q
			if o.Quality <= 0 {
				r.UnjudgedSuccesses++
			} else {
				qSum += o.Quality
				qN++
			}
		}
	}
	r.SuccessRate = float64(successes) / float64(len(outcomes))
	if successes > 0 {
		r.CostPerSuccessUSD = r.TotalCostUSD / float64(successes)
	}
	if r.TotalCostUSD > 0 {
		r.TokenYieldRate = weighted / r.TotalCostUSD
	}
	if qN > 0 {
		r.AvgQuality = qSum / float64(qN)
	}
	return r
}

// Verdict compares a before/after pair: Win requires cost DOWN with yield
// NOT down (flat within tolerance). Tolerance defaults to 2% relative so
// noise never blocks a real win, and never hides a real regression.
func (r YieldReport) Verdict(after YieldReport, tolerance float64) (win bool, reason string) {
	if tolerance <= 0 {
		tolerance = 0.02
	}
	if after.TotalCostUSD >= r.TotalCostUSD {
		return false, "cost did not decrease"
	}
	if r.TokenYieldRate > 0 && after.TokenYieldRate < r.TokenYieldRate*(1-tolerance) {
		return false, "yield regressed while cost dropped — quality was traded for dollars"
	}
	if r.SuccessRate > 0 && after.SuccessRate < r.SuccessRate*(1-tolerance) {
		return false, "success rate regressed while cost dropped"
	}
	return true, "yield flat + cost down = win"
}

// CompareYield is the one-call headline: before vs after optimization.
func CompareYield(before, after []WorkflowOutcome) (win bool, reason string, beforeR, afterR YieldReport) {
	beforeR = ComputeYield(before)
	afterR = ComputeYield(after)
	win, reason = beforeR.Verdict(afterR, 0.02)
	return win, reason, beforeR, afterR
}
