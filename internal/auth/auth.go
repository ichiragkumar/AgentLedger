// Package auth resolves virtual keys (vk_xxx) to real upstream keys.
//
// Rules:
//   - Agents send `AgentLedger-Key: vk_xxx` (or Authorization: Bearer vk_xxx).
//   - Real keys live only in env / vault, resolved server-side per request.
//   - Real keys are NEVER logged. Log only RedactedPrefix(vk) e.g. "vk_t***".
//   - This is a stub for the Phase 4 Key Vault (DB-backed, per-team keys,
//     rotation). The Resolver interface is stable — swap the backend later.
package auth

import (
	"errors"
	"net/http"
	"os"
	"strings"
)

// ErrMissingKey is returned when no virtual key was supplied.
var ErrMissingKey = errors.New("auth: missing virtual key (send AgentLedger-Key: vk_xxx)")

// ErrUnknownKey is returned when the virtual key is not recognised.
var ErrUnknownKey = errors.New("auth: unknown virtual key")

// Resolution is the server-side secret material for one request.
// Callers must never log UpstreamKey.
type Resolution struct {
	// UpstreamKey is the real provider key (from env). Never log.
	UpstreamKey string
	// KeyPrefix is safe to log (e.g. "vk_t***").
	KeyPrefix string
}

// Resolver maps a virtual key to upstream credentials.
type Resolver interface {
	Resolve(virtualKey string) (Resolution, error)
}

// MapResolver is the Phase 1 in-memory stub.
type MapResolver struct {
	keys map[string]Resolution
}

// NewMapResolver builds a stub resolver from an explicit map.
func NewMapResolver(m map[string]string) *MapResolver {
	keys := make(map[string]Resolution, len(m))
	for vk, upstream := range m {
		keys[vk] = Resolution{UpstreamKey: upstream, KeyPrefix: RedactedPrefix(vk)}
	}
	return &MapResolver{keys: keys}
}

// NewMapResolverFromEnv seeds well-known dev keys from env:
//
//	vk_test, vk_test_123, vk_dev -> OPENAI_API_KEY (fallback "test-only-no-key")
//	Provider-specific upstream keys (ANTHROPIC_API_KEY, GOOGLE_API_KEY,
//	DEEPSEEK_API_KEY) are resolved at forward time by the proxy, not here —
//	this resolver only authenticates the virtual key itself. The single
//	UpstreamKey stored here is the default (OpenAI) key; per-provider keys
//	are read from env directly by internal/proxy.
func NewMapResolverFromEnv() *MapResolver {
	def := os.Getenv("OPENAI_API_KEY")
	extra := parseExtraKeys(os.Getenv("VIRTUAL_KEYS"))
	for k, v := range extra {
		_ = k
		_ = v
	}
	m := map[string]string{}
	for _, vk := range []string{"vk_test", "vk_test_123", "vk_dev"} {
		if vkEnv := os.Getenv("VIRTUAL_KEY_" + strings.ToUpper(strings.TrimPrefix(vk, "vk_"))); vkEnv != "" {
			// Allow VIRTUAL_KEY_TEST=sk-... overrides (never logged).
			m[vk] = vkEnv
			continue
		}
		if def == "" {
			def = "test-only-no-key"
		}
		m[vk] = def
	}
	for k, v := range extra {
		m[k] = v
	}
	return NewMapResolver(m)
}

// Resolve authenticates a virtual key.
func (r *MapResolver) Resolve(virtualKey string) (Resolution, error) {
	vk := strings.TrimSpace(virtualKey)
	if vk == "" {
		return Resolution{}, ErrMissingKey
	}
	if res, ok := r.keys[vk]; ok {
		return res, nil
	}
	return Resolution{}, ErrUnknownKey
}

// VirtualKeyFromRequest extracts the virtual key without logging it.
// Priority: AgentLedger-Key > X-AgentLedger-Key > Authorization: Bearer vk_...
func VirtualKeyFromRequest(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("AgentLedger-Key")); v != "" {
		return v
	}
	if v := strings.TrimSpace(r.Header.Get("X-AgentLedger-Key")); v != "" {
		return v
	}
	if auth := strings.TrimSpace(r.Header.Get("Authorization")); auth != "" {
		if rest, ok := strings.CutPrefix(auth, "Bearer "); ok {
			if strings.HasPrefix(strings.TrimSpace(rest), "vk_") {
				return strings.TrimSpace(rest)
			}
		}
	}
	return ""
}

// RedactedPrefix returns a log-safe prefix like "vk_t***".
// Never return more than 4 chars of the secret.
func RedactedPrefix(vk string) string {
	vk = strings.TrimSpace(vk)
	if len(vk) <= 4 {
		return "***"
	}
	return vk[:4] + "***"
}

// parseExtraKeys parses VIRTUAL_KEYS="vk_a=sk-a,vk_b=sk-b".
func parseExtraKeys(s string) map[string]string {
	out := map[string]string{}
	for _, pair := range strings.Split(s, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		kv := strings.SplitN(pair, "=", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(kv[1])
		if k != "" && v != "" {
			out[k] = v
		}
	}
	return out
}
