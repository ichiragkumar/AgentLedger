// Provider routing: map the OpenAI `model` field to an upstream.
//
// Out of the box: OpenAI, Anthropic, Google. DeepSeek ships as a working
// stub (same OpenAI-compatible path, own base URL). Unknown models fall
// through to OpenAI-compatible forwarding so new models keep working.
//
// Upstream bases are overridable via env for tests / self-hosted gateways:
//
//	OPENAI_BASE_URL, ANTHROPIC_BASE_URL, GOOGLE_BASE_URL, DEEPSEEK_BASE_URL
//
// Tests use these to point at httptest servers.
package proxy

import (
	"os"
	"strings"
)

// Provider identifies an upstream LLM provider.
type Provider string

const (
	ProviderOpenAI    Provider = "openai"
	ProviderAnthropic Provider = "anthropic"
	ProviderGoogle    Provider = "google"
	ProviderDeepSeek  Provider = "deepseek"
)

func (p Provider) String() string { return string(p) }

// ResolveProvider maps a model name to a provider by prefix.
//
//   - gpt-, o1, o3, openai/          -> OpenAI
//   - claude-, anthropic/             -> Anthropic
//   - gemini-, google/, gemma-        -> Google
//   - deepseek-, deepseek/            -> DeepSeek
//   - mistral-, llama- (stub)         -> OpenAI-compatible passthrough (openai)
//   - "" or unknown                   -> OpenAI (default passthrough)
func ResolveProvider(model string) Provider {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.HasPrefix(m, "claude-") || strings.HasPrefix(m, "anthropic/"):
		return ProviderAnthropic
	case strings.HasPrefix(m, "gemini-") || strings.HasPrefix(m, "google/") || strings.HasPrefix(m, "gemma-"):
		return ProviderGoogle
	case strings.HasPrefix(m, "deepseek-") || strings.HasPrefix(m, "deepseek/"):
		return ProviderDeepSeek
	case strings.HasPrefix(m, "gpt-") || strings.HasPrefix(m, "o1") || strings.HasPrefix(m, "o3") ||
		strings.HasPrefix(m, "openai/") || m == "":
		return ProviderOpenAI
	default:
		// Future router extension point: model-tier table.
		// Today: default to OpenAI-compatible passthrough.
		return ProviderOpenAI
	}
}

// DefaultUpstreamBase returns the OpenAI-compatible chat-completions base
// for a provider (no trailing path).
func DefaultUpstreamBase(p Provider) string {
	switch p {
	case ProviderAnthropic:
		return "https://api.anthropic.com"
	case ProviderGoogle:
		return "https://generativelanguage.googleapis.com"
	case ProviderDeepSeek:
		return "https://api.deepseek.com"
	default:
		return "https://api.openai.com"
	}
}

// UpstreamChatCompletionsURL returns the full /chat/completions URL.
// Google exposes an OpenAI-compatible endpoint; Anthropic translation
// (Messages API) is a documented Phase-2 stub — Phase 1 forwards the
// OpenAI-compatible body to the configured base so self-hosted
// Anthropic-compatible gateways work today.
func UpstreamChatCompletionsURL(p Provider) string {
	base := DefaultUpstreamBase(p)
	var envOverride string
	switch p {
	case ProviderAnthropic:
		envOverride = strings.TrimRight(os.Getenv("ANTHROPIC_BASE_URL"), "/")
	case ProviderGoogle:
		envOverride = strings.TrimRight(os.Getenv("GOOGLE_BASE_URL"), "/")
	case ProviderDeepSeek:
		envOverride = strings.TrimRight(os.Getenv("DEEPSEEK_BASE_URL"), "/")
	default:
		envOverride = strings.TrimRight(os.Getenv("OPENAI_BASE_URL"), "/")
	}
	if envOverride != "" {
		base = envOverride
	}
	base = strings.TrimRight(base, "/")
	// If the override already contains /chat/completions, use as-is
	// (lets tests point directly at a mock handler).
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	if p == ProviderGoogle && envOverride == "" {
		// Google's OpenAI-compatible endpoint.
		return base + "/v1beta/openai/chat/completions"
	}
	return base + "/v1/chat/completions"
}

// UpstreamAPIKeyEnv returns the env var holding the real key for p.
func UpstreamAPIKeyEnv(p Provider) string {
	switch p {
	case ProviderAnthropic:
		return "ANTHROPIC_API_KEY"
	case ProviderGoogle:
		return "GOOGLE_API_KEY"
	case ProviderDeepSeek:
		return "DEEPSEEK_API_KEY"
	default:
		return "OPENAI_API_KEY"
	}
}
