// ROI correlation: token cost vs business outcome.
//
// A workflow's dollar cost is known from request_logs. Its VALUE comes from
// a business signal the operator already has — no new instrumentation by
// default:
//
//   - "webhook": an external system POSTs the outcome value (e.g. order
//     placed → $45). HMAC-verified by the serving path (secret in env).
//   - "status": terminal-step status code (2xx = success worth a configured
//     flat value, e.g. support ticket resolved → $8).
//   - "custom": caller-supplied metric name + value with a $/unit rate
//     (e.g. lines_of_tested_code × $0.02).
//
// Output reads like: "this workflow cost $2.30 and generated $45".
package brain

import (
	"sort"
)

// Signal sources. Keep in sync with db/migrations/003_brain.sql CHECK.
const (
	SourceWebhook = "webhook"
	SourceStatus  = "status"
	SourceCustom  = "custom"
)

// BusinessSignal is one outcome event for a finished workflow (chain).
type BusinessSignal struct {
	WorkflowID  string // == ChainID
	Source      string // webhook | status | custom
	Success     bool
	ValueUSD    float64 // explicit value (webhook/custom precompute it)
	StatusCode  int     // status source: 2xx => success
	MetricName  string  // custom source, e.g. "resolved_tickets"
	MetricValue float64 // custom source units
}

// Value resolves the dollar value of a signal. For status signals without
// an explicit value, successValueUSD prices a successful terminal step
// (e.g. $8 per resolved ticket). For custom signals without explicit value,
// ratePerUnit converts metric units to dollars.
func (s BusinessSignal) Value(successValueUSD, ratePerUnit float64) float64 {
	if s.ValueUSD != 0 {
		return s.ValueUSD
	}
	switch s.Source {
	case SourceStatus:
		if s.Success || (s.StatusCode >= 200 && s.StatusCode < 300) {
			return successValueUSD
		}
		return 0
	case SourceCustom:
		return s.MetricValue * ratePerUnit
	default: // webhook with no value: success flag only, value unknown
		return 0
	}
}

// WorkflowCost is the summed token spend for one chain (from request_logs).
type WorkflowCost struct {
	WorkflowID string
	CostUSD    float64
	Steps      int
}

// ROIRecord joins one workflow's cost to its business value.
type ROIRecord struct {
	WorkflowID string
	CostUSD    float64
	ValueUSD   float64
	NetUSD     float64 // value - cost
	ROI        float64 // value / cost (0 when cost is 0 and value is 0)
}

// Correlate joins costs to signals by workflow ID. Signals aggregate by
// SUM when several arrive for one workflow (e.g. status + webhook); costs
// without any signal produce a zero-value record so "unattributed spend" is
// visible instead of silently dropped.
func Correlate(costs []WorkflowCost, signals []BusinessSignal, successValueUSD, ratePerUnit float64) []ROIRecord {
	values := map[string]float64{}
	for _, s := range signals {
		values[s.WorkflowID] += s.Value(successValueUSD, ratePerUnit)
	}
	seen := map[string]bool{}
	var out []ROIRecord
	for _, c := range costs {
		v := values[c.WorkflowID]
		seen[c.WorkflowID] = true
		out = append(out, ROIRecord{
			WorkflowID: c.WorkflowID,
			CostUSD:    c.CostUSD,
			ValueUSD:   v,
			NetUSD:     v - c.CostUSD,
			ROI:        roiOf(v, c.CostUSD),
		})
	}
	// Signals for unknown workflows (late-arriving webhooks) still surface.
	for _, s := range signals {
		if !seen[s.WorkflowID] {
			seen[s.WorkflowID] = true
			v := values[s.WorkflowID]
			out = append(out, ROIRecord{WorkflowID: s.WorkflowID, ValueUSD: v, NetUSD: v, ROI: roiOf(v, 0)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WorkflowID < out[j].WorkflowID })
	return out
}

// ROISummary aggregates records into the dashboard headline.
type ROISummary struct {
	Workflows   int
	TotalCost   float64
	TotalValue  float64
	TotalNet    float64
	AverageROI  float64
	Attribution float64 // fraction of workflows with nonzero value
}

// Summarize folds records into one headline.
func Summarize(records []ROIRecord) ROISummary {
	s := ROISummary{Workflows: len(records)}
	attributed := 0
	for _, r := range records {
		s.TotalCost += r.CostUSD
		s.TotalValue += r.ValueUSD
		s.TotalNet += r.NetUSD
		if r.ValueUSD != 0 {
			attributed++
		}
	}
	s.AverageROI = roiOf(s.TotalValue, s.TotalCost)
	if s.Workflows > 0 {
		s.Attribution = float64(attributed) / float64(s.Workflows)
	}
	return s
}

func roiOf(value, cost float64) float64 {
	if cost <= 0 {
		if value > 0 {
			return 1 // value with no measured cost: report neutrally, not +Inf
		}
		return 0
	}
	return value / cost
}
