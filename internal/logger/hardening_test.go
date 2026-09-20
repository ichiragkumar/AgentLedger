package logger

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/agentledger/agentledger/pkg/models"
)

// Hardening coverage: Sanitize bounds, secret-prefix reduction, DiscardLogger.

func TestSanitizeClampsAndTruncates(t *testing.T) {
	e := Sanitize(models.RequestLog{
		Model:            strings.Repeat("m", 300),
		Provider:         strings.Repeat("p", 300),
		TokensIn:         -5,
		TokensOut:        -7,
		CostUSD:          -1.5,
		LatencyMs:        -2,
		AgentID:          strings.Repeat("a", 300),
		VirtualKeyPrefix: "vk_test_123_full_leak",
		StatusCode:       9999,
	})
	if len(e.Model) != 256 || len(e.AgentID) != 256 {
		t.Fatalf("not truncated: model=%d agent=%d", len(e.Model), len(e.AgentID))
	}
	if e.TokensIn != 0 || e.TokensOut != 0 || e.CostUSD != 0 || e.LatencyMs != 0 {
		t.Fatalf("not clamped: %+v", e)
	}
	if e.VirtualKeyPrefix != "vk_t***" {
		t.Fatalf("full vk not reduced: %q", e.VirtualKeyPrefix)
	}
	if e.StatusCode != 0 {
		t.Fatalf("bad status not zeroed: %d", e.StatusCode)
	}
	if e.Timestamp.IsZero() {
		t.Fatal("expected timestamp default")
	}
}

func TestSanitizeKeepsRedactedPrefix(t *testing.T) {
	e := Sanitize(models.RequestLog{Timestamp: time.Now(), VirtualKeyPrefix: "vk_t***"})
	if e.VirtualKeyPrefix != "vk_t***" {
		t.Fatalf("got %q", e.VirtualKeyPrefix)
	}
}

func TestDiscardLogger(t *testing.T) {
	var l Logger = DiscardLogger{}
	if err := l.Log(context.Background(), sampleLog()); err != nil {
		t.Fatal(err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
}
