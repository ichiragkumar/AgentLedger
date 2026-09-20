package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/agentledger/agentledger/pkg/models"
)

func sampleLog() models.RequestLog {
	return models.RequestLog{
		Timestamp:        time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC),
		Model:            "gpt-4o-mini",
		Provider:         "openai",
		TokensIn:         10,
		TokensOut:        20,
		CostUSD:          0.0000135,
		LatencyMs:        1.234,
		AgentID:          "agent-1",
		TeamID:           "team-a",
		ProjectID:        "proj-x",
		VirtualKeyPrefix: "vk_t***",
		StatusCode:       200,
	}
}

func TestStdoutLoggerWritesJSON(t *testing.T) {
	var buf bytes.Buffer
	l := NewStdoutLogger(&buf)
	if err := l.Log(context.Background(), sampleLog()); err != nil {
		t.Fatal(err)
	}
	var decoded models.RequestLog
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &decoded); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, buf.String())
	}
	if decoded.Model != "gpt-4o-mini" || decoded.TokensIn != 10 || decoded.AgentID != "agent-1" {
		t.Fatalf("round-trip mismatch: %+v", decoded)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestStdoutLoggerDefaultsTimestamp(t *testing.T) {
	var buf bytes.Buffer
	l := NewStdoutLogger(&buf)
	e := sampleLog()
	e.Timestamp = time.Time{}
	if err := l.Log(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	var decoded models.RequestLog
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Timestamp.IsZero() {
		t.Fatal("expected timestamp default")
	}
}

func TestMemoryLoggerBuffers(t *testing.T) {
	l := &MemoryLogger{}
	if err := l.Log(context.Background(), sampleLog()); err != nil {
		t.Fatal(err)
	}
	if len(l.Entries) != 1 || l.Entries[0].Model != "gpt-4o-mini" {
		t.Fatalf("got %+v", l.Entries)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresStubFallsBackToStdout(t *testing.T) {
	var buf bytes.Buffer
	l := NewPostgresStubLogger("postgres://user:pass@localhost/db", &buf)
	if !l.DSNConfigured() {
		t.Fatal("expected DSN configured")
	}
	if err := l.Log(context.Background(), sampleLog()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "gpt-4o-mini") {
		t.Fatalf("expected fallback row, got %s", buf.String())
	}
	// DSN must never appear in output.
	if strings.Contains(buf.String(), "user:pass") {
		t.Fatal("DSN leaked into logs")
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	if (NewPostgresStubLogger("", &buf)).DSNConfigured() {
		t.Fatal("empty DSN should report false")
	}
}

func TestNewFromEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	l := NewFromEnv()
	if _, ok := l.(*StdoutLogger); !ok {
		t.Fatalf("expected StdoutLogger, got %T", l)
	}
	t.Setenv("DATABASE_URL", "postgres://x/y")
	l2 := NewFromEnv()
	if _, ok := l2.(*PostgresStubLogger); !ok {
		t.Fatalf("expected PostgresStubLogger, got %T", l2)
	}
}
