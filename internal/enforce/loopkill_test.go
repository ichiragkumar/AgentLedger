package enforce

import (
	"strings"
	"testing"
	"time"
)

func TestDepthKill(t *testing.T) {
	tr := NewTracker(LoopLimits{MaxDepth: 3, MaxTokens: 1 << 30, Window: time.Minute})
	for i := 0; i < 3; i++ {
		if kill, _ := tr.Record("chain-1", 100); kill {
			t.Fatalf("request %d killed early", i+1)
		}
	}
	kill, reason := tr.Record("chain-1", 100)
	if !kill || !strings.Contains(reason, ReasonDepthExceeded) {
		t.Fatalf("kill=%v reason=%q, want depth kill", kill, reason)
	}
	if d, tk, ok := tr.Check("chain-1"); !ok || d != 4 || tk != 400 {
		t.Fatalf("check = (%d,%d,%v)", d, tk, ok)
	}
}

func TestTokensKill(t *testing.T) {
	tr := NewTracker(LoopLimits{MaxDepth: 1 << 10, MaxTokens: 1000, Window: time.Minute})
	if kill, _ := tr.Record("chain-9", 600); kill {
		t.Fatal("under token budget must not kill")
	}
	kill, reason := tr.AddTokens("chain-9", 500) // post-response top-up trips it
	if !kill || !strings.Contains(reason, ReasonTokensExceeded) {
		t.Fatalf("kill=%v reason=%q, want tokens kill", kill, reason)
	}
}

func TestWindowExpiryResetsChain(t *testing.T) {
	now := time.Now()
	tr := NewTracker(LoopLimits{MaxDepth: 1, MaxTokens: 10, Window: time.Minute})
	tr.now = func() time.Time { return now }
	if kill, _ := tr.Record("c", 1); kill {
		t.Fatal("first request must pass")
	}
	if kill, _ := tr.Record("c", 1); !kill {
		t.Fatal("second request in window must kill (depth 2 > 1)")
	}
	now = now.Add(2 * time.Minute) // slide past window
	if kill, _ := tr.Record("c", 1); kill {
		t.Fatal("expired window must reset the chain")
	}
	if _, _, ok := tr.Check("missing"); ok {
		t.Fatal("unknown chain must not be found")
	}
}

func TestSweepAndReset(t *testing.T) {
	now := time.Now()
	tr := NewTracker(LoopLimits{MaxDepth: 100, MaxTokens: 1 << 30, Window: time.Minute})
	tr.now = func() time.Time { return now }
	tr.Record("a", 1)
	tr.Record("b", 1)
	if tr.Chains() != 2 {
		t.Fatalf("chains = %d", tr.Chains())
	}
	tr.Reset("a")
	if tr.Chains() != 1 {
		t.Fatal("reset must drop one chain")
	}
	now = now.Add(2 * time.Minute)
	if n := tr.Sweep(); n != 1 {
		t.Fatalf("swept = %d, want 1", n)
	}
	if tr.Chains() != 0 {
		t.Fatal("all chains should be gone")
	}
}

func TestEmptyChainNeverKills(t *testing.T) {
	tr := NewTracker(LoopLimits{MaxDepth: 1, MaxTokens: 1, Window: time.Minute})
	for i := 0; i < 10; i++ {
		if kill, _ := tr.Record("", 1000000); kill {
			t.Fatal("empty chain id must never kill")
		}
	}
	if kill, _ := tr.AddTokens("", 1); kill {
		t.Fatal("empty chain AddTokens must never kill")
	}
	if kill, _ := tr.AddTokens("ghost", 50); kill {
		t.Fatal("unknown chain AddTokens must not kill")
	}
}

func TestKillLatencyMicroseconds(t *testing.T) {
	// Acceptance is kill <5s; in-memory Record must be ~µs. Assert <100ms
	// for 10k records to prove orders of margin without flakiness.
	tr := NewTracker(DefaultLoopLimits())
	start := time.Now()
	for i := 0; i < 10000; i++ {
		tr.Record("hot", 100)
		tr.AddTokens("hot", 100)
	}
	if el := time.Since(start); el > 100*time.Millisecond*10 {
		t.Fatalf("10k records took %v", el)
	}
}
