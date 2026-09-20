package proxy

import (
	"fmt"
	"sort"
	"sync"
)

// Metrics is the in-memory Prometheus source. No external client library
// (stdlib only) so `go build` works offline.
type Metrics struct {
	mu            sync.Mutex
	requestsTotal int64
	tokensIn      int64
	tokensOut     int64
	costUSD       float64
	latencySumMs  float64
	byModel       map[string]int64
	byStatus      map[int]int64
	byProvider    map[string]int64
}

// NewMetrics returns an empty registry.
func NewMetrics() *Metrics {
	return &Metrics{
		byModel:    map[string]int64{},
		byStatus:   map[int]int64{},
		byProvider: map[string]int64{},
	}
}

// Observe records one completed proxied request.
// Negative counters (callers should already sanitize) are clamped so a bad
// upstream payload can never drive totals negative. Lock hold time is one
// struct update — safe at 500+ concurrent requests.
func (m *Metrics) Observe(model, provider string, status int, tokensIn, tokensOut int, costUSD, latencyMs float64) {
	if tokensIn < 0 {
		tokensIn = 0
	}
	if tokensOut < 0 {
		tokensOut = 0
	}
	if costUSD < 0 || costUSD != costUSD { // also guard NaN
		costUSD = 0
	}
	if latencyMs < 0 || latencyMs != latencyMs {
		latencyMs = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requestsTotal++
	m.tokensIn += int64(tokensIn)
	m.tokensOut += int64(tokensOut)
	m.costUSD += costUSD
	m.latencySumMs += latencyMs
	if model == "" {
		model = "unknown"
	}
	m.byModel[model]++
	m.byStatus[status]++
	if provider == "" {
		provider = "unknown"
	}
	m.byProvider[provider]++
}

// Snapshot is a copy for tests / JSON debug.
type Snapshot struct {
	RequestsTotal int64
	TokensIn      int64
	TokensOut     int64
	CostUSD       float64
	AvgLatencyMs  float64
}

// Snapshot returns a copy of the totals.
func (m *Metrics) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	avg := 0.0
	if m.requestsTotal > 0 {
		avg = m.latencySumMs / float64(m.requestsTotal)
	}
	return Snapshot{
		RequestsTotal: m.requestsTotal,
		TokensIn:      m.tokensIn,
		TokensOut:     m.tokensOut,
		CostUSD:       m.costUSD,
		AvgLatencyMs:  avg,
	}
}

// PrometheusText renders Prometheus exposition format.
func (m *Metrics) PrometheusText() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := "# HELP agentledger_requests_total Total proxied chat completion requests\n" +
		"# TYPE agentledger_requests_total counter\n" +
		fmt.Sprintf("agentledger_requests_total %d\n", m.requestsTotal) +
		"# HELP agentledger_tokens_in_total Total prompt tokens proxied\n" +
		"# TYPE agentledger_tokens_in_total counter\n" +
		fmt.Sprintf("agentledger_tokens_in_total %d\n", m.tokensIn) +
		"# HELP agentledger_tokens_out_total Total completion tokens proxied\n" +
		"# TYPE agentledger_tokens_out_total counter\n" +
		fmt.Sprintf("agentledger_tokens_out_total %d\n", m.tokensOut) +
		"# HELP agentledger_cost_usd_total Total estimated upstream cost USD\n" +
		"# TYPE agentledger_cost_usd_total counter\n" +
		fmt.Sprintf("agentledger_cost_usd_total %f\n", m.costUSD) +
		"# HELP agentledger_latency_ms_sum Sum of handler latencies ms\n" +
		"# TYPE agentledger_latency_ms_sum counter\n" +
		fmt.Sprintf("agentledger_latency_ms_sum %f\n", m.latencySumMs)

	models := make([]string, 0, len(m.byModel))
	for k := range m.byModel {
		models = append(models, k)
	}
	sort.Strings(models)
	for _, k := range models {
		out += fmt.Sprintf("agentledger_requests_by_model{model=%q} %d\n", k, m.byModel[k])
	}
	statuses := make([]int, 0, len(m.byStatus))
	for code := range m.byStatus {
		statuses = append(statuses, code)
	}
	sort.Ints(statuses)
	for _, code := range statuses {
		out += fmt.Sprintf("agentledger_requests_by_status{status=%q} %d\n", fmt.Sprint(code), m.byStatus[code])
	}
	provs := make([]string, 0, len(m.byProvider))
	for k := range m.byProvider {
		provs = append(provs, k)
	}
	sort.Strings(provs)
	for _, k := range provs {
		out += fmt.Sprintf("agentledger_requests_by_provider{provider=%q} %d\n", k, m.byProvider[k])
	}
	return out
}

// Reset clears all counters. Tests and operator-triggered restarts only —
// never called on the request hot path.
func (m *Metrics) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requestsTotal, m.tokensIn, m.tokensOut = 0, 0, 0
	m.costUSD, m.latencySumMs = 0, 0
	m.byModel = map[string]int64{}
	m.byStatus = map[int]int64{}
	m.byProvider = map[string]int64{}
}
