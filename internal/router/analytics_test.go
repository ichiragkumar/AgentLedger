package router

import (
	"math"
	"testing"
)

func TestDistributionSumsToOne(t *testing.T) {
	shares := Distribution([]ModelStat{
		{Model: "gemini-2.0-flash", Requests: 50, SpendUSD: 1.0},
		{Model: "claude-3-5-haiku", Requests: 22, SpendUSD: 2.0},
		{Model: "claude-3-5-sonnet", Requests: 14, SpendUSD: 3.0},
		{Model: "gpt-4o", Requests: 14, SpendUSD: 4.0},
	})
	if len(shares) != 4 {
		t.Fatalf("want 4 slices, got %d", len(shares))
	}
	var sum float64
	for _, s := range shares {
		sum += s.Share
	}
	if math.Abs(sum-1.0) > 1e-9 {
		t.Fatalf("shares sum to %v, want 1", sum)
	}
	if shares[0].Model != "gemini-2.0-flash" {
		t.Fatalf("want desc sort, head=%q", shares[0].Model)
	}
}

func TestDistributionEmptyIsZeroState(t *testing.T) {
	if got := Distribution(nil); len(got) != 0 {
		t.Fatalf("nil input: want empty, got %v", got)
	}
	if got := Distribution([]ModelStat{{Model: "x", Requests: 0}}); len(got) != 0 {
		t.Fatalf("zero requests: want empty, got %v", got)
	}
}

func TestDistributionClampsNegatives(t *testing.T) {
	shares := Distribution([]ModelStat{
		{Model: "a", Requests: 10, SpendUSD: -5},
		{Model: "b", Requests: -3, SpendUSD: 1},
	})
	if len(shares) != 2 {
		t.Fatalf("want 2 slices, got %d", len(shares))
	}
	for _, s := range shares {
		if s.SpendUSD < 0 || s.Share < 0 {
			t.Fatalf("negative leaked: %+v", s)
		}
	}
}

func TestSummarizeSavingsCanonical(t *testing.T) {
	stats := []ModelStat{
		{Model: "gemini-2.0-flash", Requests: 80, SpendUSD: 60},
		{Model: "gpt-4o", Requests: 20, SpendUSD: 61.90},
	}
	s := SummarizeSavings(stats, 160.10)
	if math.Abs(s.Spent-121.90) > 1e-9 {
		t.Fatalf("spent=%v want 121.90", s.Spent)
	}
	if math.Abs(s.Saved-38.20) > 1e-9 {
		t.Fatalf("saved=%v want 38.20", s.Saved)
	}
	wantPct := 38.20 / 160.10 * 100
	if math.Abs(s.SavedPct-wantPct) > 1e-9 {
		t.Fatalf("pct=%v want %v", s.SavedPct, wantPct)
	}
	if s.Requests != 100 {
		t.Fatalf("requests=%d want 100", s.Requests)
	}
}

func TestSummarizeSavingsClamps(t *testing.T) {
	s := SummarizeSavings([]ModelStat{{Model: "x", Requests: 1, SpendUSD: 200}}, 100)
	if s.Saved != 0 || s.SavedPct != 0 {
		t.Fatalf("over-baseline must clamp to 0, got %+v", s)
	}
	z := SummarizeSavings(nil, 0)
	if z.Saved != 0 || z.SavedPct != 0 || z.Requests != 0 {
		t.Fatalf("zero baseline must be zero-state, got %+v", z)
	}
}

func TestSummarizeEscalation(t *testing.T) {
	g := DefaultGuard()
	if s := SummarizeEscalation(g); s.Rate != 0 || s.OverBudget {
		t.Fatalf("fresh guard must be within budget, got %+v", s)
	}
	if s := SummarizeEscalation(nil); s.Rate != 0 || s.OverBudget {
		t.Fatalf("nil guard must be within budget, got %+v", s)
	}
	// Force over budget: threshold 2.0 escalates everything.
	hot := &Guard{Threshold: 2.0, Budget: 0.10, Judge: HeuristicJudge{}}
	hot.Evaluate("summarize this", "a fine summary with substance")
	if s := SummarizeEscalation(hot); !s.OverBudget || s.Rate != 1 {
		t.Fatalf("want over budget at rate 1, got %+v", s)
	}
}
