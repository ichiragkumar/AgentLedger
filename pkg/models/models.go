// Package models holds shared request/response/log types for AgentLedger.
//
// Phase 1 (Mirror) scope: OpenAI-compatible chat completions + request log.
// Router (Phase 3) and Enforcer (Phase 4) reuse these types — do not break them.
package models

import "time"

// Message is a single chat message (OpenAI-compatible, minimal subset).
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamOptions mirrors OpenAI stream_options (e.g. {"include_usage": true}).
type StreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"`
}

// ChatCompletionRequest is the minimal parsed subset. The proxy forwards the
// raw body untouched, so unknown fields are preserved upstream.
type ChatCompletionRequest struct {
	Model         string         `json:"model"`
	Messages      []Message      `json:"messages,omitempty"`
	Stream        bool           `json:"stream,omitempty"`
	StreamOptions *StreamOptions `json:"stream_options,omitempty"`
	MaxTokens     *int           `json:"max_tokens,omitempty"`
	Temperature   *float64       `json:"temperature,omitempty"`
}

// Usage mirrors OpenAI usage block. Token counts MUST match provider
// values within 1% — we take them verbatim from the upstream response,
// never estimate.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ChatCompletionResponse is the minimal parsed subset for cost accounting.
type ChatCompletionResponse struct {
	ID      string `json:"id,omitempty"`
	Object  string `json:"object,omitempty"`
	Model   string `json:"model,omitempty"`
	Created int64  `json:"created,omitempty"`
	Usage   Usage  `json:"usage,omitempty"`
}

// Attribution carries the passthrough headers. No SDK required for v1.
type Attribution struct {
	AgentID       string
	TeamID        string
	ProjectID     string
	ChainID       string
	ParentAgentID string
}

// RequestLog is one row in Postgres (see db/schema.sql).
// Real API keys are NEVER stored here — only a virtual-key prefix.
type RequestLog struct {
	Timestamp         time.Time `json:"timestamp"`
	Model             string    `json:"model"`
	Provider          string    `json:"provider"`
	TokensIn          int       `json:"tokens_in"`
	TokensOut         int       `json:"tokens_out"`
	CostUSD           float64   `json:"cost_usd"`
	LatencyMs         float64   `json:"latency_ms"`
	UpstreamLatencyMs float64   `json:"upstream_latency_ms,omitempty"`
	AgentID           string    `json:"agent_id,omitempty"`
	TeamID            string    `json:"team_id,omitempty"`
	ProjectID         string    `json:"project_id,omitempty"`
	ChainID           string    `json:"chain_id,omitempty"`
	ParentAgentID     string    `json:"parent_agent_id,omitempty"`
	VirtualKeyPrefix  string    `json:"virtual_key_prefix,omitempty"`
	StatusCode        int       `json:"status_code"`
	Stream            bool      `json:"stream"`
	PriceKnown        bool      `json:"price_known"`
}
