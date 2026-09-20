package logger

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/agentledger/agentledger/pkg/models"
)

// TestPostgresLoggerLiveInsert is an integration test: it runs only when
// TEST_DATABASE_URL (or DATABASE_URL) reaches a real Postgres, else skips.
func TestPostgresLoggerLiveInsert(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no DATABASE_URL — skipping live insert test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	l, err := NewPostgresLogger(ctx, dsn, nil)
	if err != nil {
		t.Skipf("postgres unreachable (%v) — skipping", err)
	}
	defer l.Close()
	e := models.RequestLog{
		Model: "test-model", Provider: "openai",
		TokensIn: 10, TokensOut: 5, CostUSD: 0.0001,
		AgentID: "test-agent", TeamID: "test-team",
		VirtualKeyPrefix: "vk_test_full_key_should_redact",
		StatusCode:       200, PriceKnown: true,
	}
	if err := l.Log(ctx, e); err != nil {
		t.Fatalf("live insert: %v", err)
	}
}
