package cache

import (
	"testing"
	"time"
)

func TestTTLForPrecedence(t *testing.T) {
	c := DefaultConfig()
	c.ModelTTL["gpt-4o"] = 30 * time.Minute
	c.AgentTTL["support-bot"] = 5 * time.Minute
	if got := c.TTLFor("gpt-4o", "support-bot"); got != 5*time.Minute {
		t.Fatalf("agent wins: %v", got)
	}
	if got := c.TTLFor("gpt-4o", "other"); got != 30*time.Minute {
		t.Fatalf("model fallback: %v", got)
	}
	if got := c.TTLFor("unknown", ""); got != DefaultTTL {
		t.Fatalf("default fallback: %v", got)
	}
	// Zero/negative overrides are skipped.
	c.AgentTTL["bad"] = -time.Second
	if got := c.TTLFor("gpt-4o", "bad"); got != 30*time.Minute {
		t.Fatalf("bad agent override skipped: %v", got)
	}
	empty := Config{}
	if got := empty.TTLFor("m", "a"); got != DefaultTTL {
		t.Fatalf("zero config fallback: %v", got)
	}
}

func TestConfigValidate(t *testing.T) {
	if err := DefaultConfig().Validate(); err != nil {
		t.Fatalf("default must validate: %v", err)
	}
	bad := DefaultConfig()
	bad.SimilarityThreshold = 0.5
	if err := bad.Validate(); err == nil {
		t.Fatal("low threshold must fail")
	}
	bad = DefaultConfig()
	bad.SimilarityThreshold = 1.0
	if err := bad.Validate(); err == nil {
		t.Fatal("high threshold must fail")
	}
	bad = DefaultConfig()
	bad.ModelTTL["m"] = 0
	if err := bad.Validate(); err == nil {
		t.Fatal("zero model TTL must fail")
	}
	bad = DefaultConfig()
	bad.AgentTTL["a"] = -1
	if err := bad.Validate(); err == nil {
		t.Fatal("negative agent TTL must fail")
	}
	bad = DefaultConfig()
	bad.MaxBodyBytes = -1
	if err := bad.Validate(); err == nil {
		t.Fatal("negative body cap must fail")
	}
	bad = DefaultConfig()
	bad.DefaultTTL = -1
	if err := bad.Validate(); err == nil {
		t.Fatal("negative default TTL must fail")
	}
}

func TestFromEnv(t *testing.T) {
	t.Setenv(EnvEnabled, "false")
	t.Setenv(EnvDefaultTTLSeconds, "120")
	t.Setenv(EnvSimilarityThreshold, "0.95")
	t.Setenv(EnvMaxBodyBytes, "1024")
	t.Setenv(EnvGuardEnabled, "0")
	t.Setenv(EnvEmbedModel, "custom-model")
	t.Setenv(EnvRedisURL, "redis://localhost:6379")
	t.Setenv(EnvQdrantURL, "http://localhost:6333")
	t.Setenv(EnvQdrantCollection, "c")
	t.Setenv(EnvQdrantAPIKey, "k")
	t.Setenv(EnvAgentTTLPrefix+"SUPPORT_BOT", "60")
	t.Setenv(EnvModelTTLPrefix+"GPT_4O", "90")
	t.Setenv(EnvModelTTLPrefix+"BROKEN", "not-a-number")

	c := FromEnv()
	if c.Enabled || c.DefaultTTL != 2*time.Minute || c.SimilarityThreshold != 0.95 {
		t.Fatalf("scalars: %+v", c)
	}
	if c.MaxBodyBytes != 1024 || c.GuardEnabled || c.EmbedModel != "custom-model" {
		t.Fatalf("scalars2: %+v", c)
	}
	if c.RedisURL == "" || c.QdrantURL == "" || c.QdrantCollection != "c" || c.QdrantAPIKey != "k" {
		t.Fatalf("backends: %+v", c)
	}
	if c.AgentTTL["SUPPORT_BOT"] != time.Minute {
		t.Fatalf("agent ttl: %v", c.AgentTTL)
	}
	if c.ModelTTL["gpt_4o"] != 90*time.Second && c.ModelTTL["GPT_4O"] != 90*time.Second {
		t.Fatalf("model ttl: %v", c.ModelTTL)
	}
	if _, ok := c.ModelTTL["broken"]; ok {
		t.Fatal("malformed TTL must be ignored")
	}
	// Malformed numerics keep defaults, never fatal.
	t.Setenv(EnvDefaultTTLSeconds, "junk")
	t.Setenv(EnvSimilarityThreshold, "junk")
	if got := FromEnv().DefaultTTL; got != DefaultTTL {
		t.Fatalf("bad default ttl keeps default: %v", got)
	}
}

func TestNormalizeEnvName(t *testing.T) {
	if NormalizeEnvName("gpt-4o") != "GPT_4O" {
		t.Fatalf("got %q", NormalizeEnvName("gpt-4o"))
	}
	if NormalizeEnvName("claude-3.5-sonnet") != "CLAUDE_3_5_SONNET" {
		t.Fatalf("got %q", NormalizeEnvName("claude-3.5-sonnet"))
	}
}
