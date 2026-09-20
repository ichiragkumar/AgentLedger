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
func (m *Metrics) Observe(model, provider string, status int, tokensIn, tokensOut int, costUSD, latencyMs float64) {
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
	for code, n := range m.byStatus {
		out += fmt.Sprintf("agentledger_requests_by_status{status=%q} %d\n", fmt.Sprint(code), n)
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
