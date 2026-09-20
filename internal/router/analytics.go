// Routing analytics aggregates (spec 06 task 3.7).
//
// The proxy hot path records per-model traffic (requests + spend via
// Decision.CostOf); this file rolls those counters into the dashboard
// shapes: normalized distribution shares (conic pie), the "You would have
// spent $X. You spent $Y. Saved $Z (N%)" savings summary vs the
// always-frontier baseline, and the escalation-budget summary behind the
// 10% line. Pure + stdlib-only: safe to call from the proxy management
// plane (future /v1/routing/distribution) or from tests. The dashboard
// Route Handlers compute the same math in SQL over request_logs; the two
// must agree — see SummarizeSavings for the canonical formula.
package router

import (
	"sort"
	"strings"
)

// ModelStat is one model's observed traffic over a window.
type ModelStat struct {
	Model    string
	Requests int64
	SpendUSD float64
	Tokens   int64
}

// Share is one model's normalized slice of routed traffic.
type Share struct {
	Model    string  `json:"model"`
	Requests int64   `json:"requests"`
	SpendUSD float64 `json:"spend_usd"`
	Share    float64 `json:"share"`
}

// Distribution normalizes per-model counters into shares summing to ~1,
// sorted by requests desc (stable on ties). Empty input → empty output
// (dashboard renders zero-state, never a fabricated pie). Negative counts
// clamp to zero so a malformed payload can never invert the pie.
func Distribution(stats []ModelStat) []Share {
	var total int64
	for _, s := range stats {
		if s.Requests > 0 {
			total += s.Requests
		}
	}
	if total == 0 {
		return []Share{}
	}
	out := make([]Share, 0, len(stats))
	for _, s := range stats {
		req := s.Requests
		if req < 0 {
			req = 0
		}
		spend := s.SpendUSD
		if spend < 0 {
			spend = 0
		}
		out = append(out, Share{
			Model:    strings.TrimSpace(s.Model),
			Requests: req,
			SpendUSD: spend,
			Share:    float64(req) / float64(total),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Requests != out[j].Requests {
			return out[i].Requests > out[j].Requests
		}
		return out[i].Model < out[j].Model
	})
	return out
}

// SavingsSummary is the canonical "would have spent / spent / saved"
// rollup. BaselineUSD is the always-frontier cost for the same tokens
// (caller prices total tokens at the frontier tier rate); RoutedUSD is the
// observed spend. Saved clamps at zero so over-frontier experiments read
// as $0 saved, never negative savings.
type SavingsSummary struct {
	WouldHaveSpent float64 `json:"would_have_spent"`
	Spent          float64 `json:"spent"`
	Saved          float64 `json:"saved"`
	SavedPct       float64 `json:"saved_pct"`
	Requests       int64   `json:"requests"`
}

// SummarizeSavings rolls per-model spend into the headline. It must match
// the dashboard SQL: baseline − routed, pct = saved/baseline×100.
func SummarizeSavings(stats []ModelStat, baselineUSD float64) SavingsSummary {
	var routed float64
	var req int64
	for _, s := range stats {
		if s.SpendUSD > 0 {
			routed += s.SpendUSD
		}
		if s.Requests > 0 {
			req += s.Requests
		}
	}
	if baselineUSD < 0 {
		baselineUSD = 0
	}
	saved := baselineUSD - routed
	if saved < 0 {
		saved = 0
	}
	return SavingsSummary{
		WouldHaveSpent: baselineUSD,
		Spent:          routed,
		Saved:          saved,
		SavedPct:       SavingsPct(baselineUSD, saved),
		Requests:       req,
	}
}

// EscalationSummary tracks the cheap → expensive retry rate against the
// <10% budget (spec 06 acceptance). OverBudget pages analytics; it never
// blocks traffic (see Guard).
type EscalationSummary struct {
	Rate       float64 `json:"rate"`
	Budget     float64 `json:"budget"`
	OverBudget bool    `json:"over_budget"`
}

// SummarizeEscalation snapshots a Guard for dashboard export. A nil guard
// reads as 0 evaluations, within budget.
func SummarizeEscalation(g *Guard) EscalationSummary {
	rate := 0.0
	if g != nil {
		rate = g.EscalationRate()
	}
	budget := 0.10
	if g != nil && g.Budget > 0 {
		budget = g.Budget
	}
	return EscalationSummary{Rate: rate, Budget: budget, OverBudget: rate >= budget}
}
