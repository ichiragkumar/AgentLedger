// Cache configuration: per-model / per-agent TTLs, similarity threshold,
// bypass header, and environment bindings.
//
// Precedence for TTLs: agent > model > default (spec 05 §2.4 "per-agent TTL
// config — different expiry per agent/model").
package cache

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Attribution headers mirrored from the proxy (literals duplicated here so
// this package stays standalone; values must match internal/proxy/proxy.go).
const (
	HeaderAgentID   = "X-Agent-Id"
	HeaderTeamID    = "X-Team-Id"
	HeaderProjectID = "X-Project-Id"
)

// Defaults.
const (
	DefaultTTL         = time.Hour
	DefaultMaxBodySize = 10 << 20 // 10MB — matches the proxy body cap.
	DefaultEmbedModel  = "all-MiniLM-L6-v2"
)

// Config tunes the Saver pipeline. Zero value is usable via DefaultConfig()
// fix-ups in NewHook, but prefer DefaultConfig() + Validate().
type Config struct {
	// Enabled master-switches caching (kill-switch for incidents).
	Enabled bool
	// DefaultTTL applies when no model/agent override matches.
	DefaultTTL time.Duration
	// ModelTTL overrides per model name (e.g. "gpt-4o": 30m).
	ModelTTL map[string]time.Duration
	// AgentTTL overrides per agent id (highest precedence).
	AgentTTL map[string]time.Duration
	// SimilarityThreshold admits semantic hits in [0.85, 0.99], default 0.92.
	SimilarityThreshold float64
	// MaxBodyBytes caps inspectable request bodies; larger bodies pass
	// through uncached (MISS) rather than risking memory blowups.
	MaxBodyBytes int64
	// GuardEnabled toggles the conversation-aware skip heuristic.
	GuardEnabled bool
	// EmbedModel names the embedding model for the semantic layer.
	EmbedModel string
	// RedisURL / QdrantURL / QdrantCollection / QdrantAPIKey wire the
	// production backends (see WIRING.md). Empty = in-memory/Qdrant-stub.
	RedisURL         string
	QdrantURL        string
	QdrantCollection string
	QdrantAPIKey     string
}

// DefaultConfig returns production-sane defaults.
func DefaultConfig() Config {
	return Config{
		Enabled:             true,
		DefaultTTL:          DefaultTTL,
		ModelTTL:            map[string]time.Duration{},
		AgentTTL:            map[string]time.Duration{},
		SimilarityThreshold: DefaultSimilarityThreshold,
		MaxBodyBytes:        DefaultMaxBodySize,
		GuardEnabled:        true,
		EmbedModel:          DefaultEmbedModel,
		QdrantCollection:    "agentledger_cache",
	}
}

// TTLFor resolves the effective TTL: agent override > model override >
// default (spec 05 §2.4). Empty model/agent simply skip their lookup tier.
func (c Config) TTLFor(model, agentID string) time.Duration {
	if agentID != "" && c.AgentTTL != nil {
		if ttl, ok := c.AgentTTL[agentID]; ok && ttl > 0 {
			return ttl
		}
	}
	if model != "" && c.ModelTTL != nil {
		if ttl, ok := c.ModelTTL[model]; ok && ttl > 0 {
			return ttl
		}
	}
	if c.DefaultTTL > 0 {
		return c.DefaultTTL
	}
	return DefaultTTL
}

// Validate reports configuration errors without mutating c.
func (c Config) Validate() error {
	if c.SimilarityThreshold != 0 &&
		(c.SimilarityThreshold < MinSimilarityThreshold || c.SimilarityThreshold > MaxSimilarityThreshold) {
		return fmt.Errorf("cache: similarity threshold %.4f outside [%.2f, %.2f]",
			c.SimilarityThreshold, MinSimilarityThreshold, MaxSimilarityThreshold)
	}
	if c.DefaultTTL < 0 {
		return fmt.Errorf("cache: default TTL must be >= 0")
	}
	for m, ttl := range c.ModelTTL {
		if ttl <= 0 {
			return fmt.Errorf("cache: model TTL for %q must be > 0", m)
		}
	}
	for a, ttl := range c.AgentTTL {
		if ttl <= 0 {
			return fmt.Errorf("cache: agent TTL for %q must be > 0", a)
		}
	}
	if c.MaxBodyBytes < 0 {
		return fmt.Errorf("cache: max body bytes must be >= 0")
	}
	return nil
}

// sanitize clamps c into valid ranges (used by NewHook so a bad env value
// degrades to defaults instead of disabling the layer).
func (c Config) sanitize() Config {
	if c.SimilarityThreshold < MinSimilarityThreshold || c.SimilarityThreshold > MaxSimilarityThreshold {
		c.SimilarityThreshold = DefaultSimilarityThreshold
	}
	if c.DefaultTTL <= 0 {
		c.DefaultTTL = DefaultTTL
	}
	if c.MaxBodyBytes <= 0 {
		c.MaxBodyBytes = DefaultMaxBodySize
	}
	if c.EmbedModel == "" {
		c.EmbedModel = DefaultEmbedModel
	}
	if c.QdrantCollection == "" {
		c.QdrantCollection = "agentledger_cache"
	}
	if c.ModelTTL == nil {
		c.ModelTTL = map[string]time.Duration{}
	}
	if c.AgentTTL == nil {
		c.AgentTTL = map[string]time.Duration{}
	}
	return c
}

// Environment variable bindings (see REQUIRED_ENV in the return summary;
// FromEnv never writes files, only reads the process environment).
const (
	EnvEnabled             = "CACHE_ENABLED"
	EnvDefaultTTLSeconds   = "CACHE_TTL_DEFAULT_SECS"
	EnvSimilarityThreshold = "CACHE_SIMILARITY_THRESHOLD"
	EnvMaxBodyBytes        = "CACHE_MAX_BODY_BYTES"
	EnvGuardEnabled        = "CACHE_GUARD_ENABLED"
	EnvEmbedModel          = "EMBED_MODEL"
	EnvRedisURL            = "REDIS_URL"
	EnvQdrantURL           = "QDRANT_URL"
	EnvQdrantCollection    = "QDRANT_COLLECTION"
	EnvQdrantAPIKey        = "QDRANT_API_KEY"
	EnvModelTTLPrefix      = "CACHE_TTL_MODEL_" // + NORMALIZED model, secs
	EnvAgentTTLPrefix      = "CACHE_TTL_AGENT_" // + agent id, secs
)

// FromEnv builds a Config from the environment over DefaultConfig().
// Per-model/per-agent TTLs use prefixed vars, e.g.
// CACHE_TTL_MODEL_GPT_4O=1800, CACHE_TTL_AGENT_SUPPORT_BOT=300
// (model names normalized: uppercased, non-alphanumerics → underscore).
// Malformed values are ignored (default kept), never fatal.
func FromEnv() Config {
	c := DefaultConfig()
	if v, ok := os.LookupEnv(EnvEnabled); ok {
		c.Enabled = parseBoolDefault(v, true)
	}
	if v, ok := os.LookupEnv(EnvDefaultTTLSeconds); ok {
		if secs, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil && secs > 0 {
			c.DefaultTTL = time.Duration(secs) * time.Second
		}
	}
	if v, ok := os.LookupEnv(EnvSimilarityThreshold); ok {
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			c.SimilarityThreshold = f
		}
	}
	if v, ok := os.LookupEnv(EnvMaxBodyBytes); ok {
		if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil && n > 0 {
			c.MaxBodyBytes = n
		}
	}
	if v, ok := os.LookupEnv(EnvGuardEnabled); ok {
		c.GuardEnabled = parseBoolDefault(v, true)
	}
	if v, ok := os.LookupEnv(EnvEmbedModel); ok && strings.TrimSpace(v) != "" {
		c.EmbedModel = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvRedisURL); ok {
		c.RedisURL = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvQdrantURL); ok {
		c.QdrantURL = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvQdrantCollection); ok && strings.TrimSpace(v) != "" {
		c.QdrantCollection = strings.TrimSpace(v)
	}
	if v, ok := os.LookupEnv(EnvQdrantAPIKey); ok {
		c.QdrantAPIKey = strings.TrimSpace(v)
	}
	for _, kv := range os.Environ() {
		name, val, _ := strings.Cut(kv, "=")
		switch {
		case strings.HasPrefix(name, EnvModelTTLPrefix):
			if secs, err := strconv.ParseInt(strings.TrimSpace(val), 10, 64); err == nil && secs > 0 {
				model := denormalizeEnvName(strings.TrimPrefix(name, EnvModelTTLPrefix))
				c.ModelTTL[model] = time.Duration(secs) * time.Second
				// Also index the raw suffix — operators may use either form.
				c.ModelTTL[strings.TrimPrefix(name, EnvModelTTLPrefix)] = time.Duration(secs) * time.Second
			}
		case strings.HasPrefix(name, EnvAgentTTLPrefix):
			if secs, err := strconv.ParseInt(strings.TrimSpace(val), 10, 64); err == nil && secs > 0 {
				agent := strings.TrimPrefix(name, EnvAgentTTLPrefix)
				c.AgentTTL[agent] = time.Duration(secs) * time.Second
			}
		}
	}
	return c
}

// NormalizeEnvName maps a model name to its env-var suffix form.
func NormalizeEnvName(model string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(model) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	return strings.Trim(b.String(), "_")
}

func denormalizeEnvName(suffix string) string {
	return strings.ToLower(strings.Trim(suffix, "_"))
}

func parseBoolDefault(v string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return def
	}
}
