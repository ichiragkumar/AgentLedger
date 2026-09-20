package router

import (
	"testing"
)

func TestHeuristicJudgeBounds(t *testing.T) {
	j := HeuristicJudge{}
	if s := j.Score("anything", ""); s != 0 {
		t.Fatalf("empty output must score 0, got %f", s)
	}
	good := j.Score("Explain ocean tides for beginners", "Ocean tides rise and fall because the moon's gravity pulls ocean water as Earth rotates beneath it.")
	bad := j.Score("Explain ocean tides for beginners", "I don't know, I cannot help with that.")
	if good <= bad {
		t.Fatalf("good=%f should beat refusal=%f", good, bad)
	}
	for _, s := range []float64{good, bad, j.Score("p", "decent output here")} {
		if s < 0 || s > 1 {
			t.Fatalf("score %f out of [0,1]", s)
		}
	}
}

func TestLLMJudgeStubDelegates(t *testing.T) {
	j := LLMJudgeStub{}
	if j.Configured() {
		t.Fatal("empty endpoint must be unconfigured")
	}
	if (LLMJudgeStub{Endpoint: "http://judge:9000"}).Configured() != true {
		t.Fatal("set endpoint must be configured")
	}
	// Both modes behave like the heuristic until the sidecar exists.
	if a, b := j.Score("p", "o"), (HeuristicJudge{}).Score("p", "o"); a != b {
		t.Fatalf("stub %f != heuristic %f", a, b)
	}
}

func TestGuardAutoEscalatesBelowThreshold(t *testing.T) {
	g := DefaultGuard()
	_, esc := g.Evaluate("Explain tides", "Tides rise because the moon pulls the oceans as Earth turns.")
	if esc {
		t.Fatal("good output must not escalate")
	}
	_, esc = g.Evaluate("Explain tides", "")
	if !esc {
		t.Fatal("empty output must escalate")
	}
	if rate := g.EscalationRate(); rate != 0.5 {
		t.Fatalf("rate = %f, want 0.5", rate)
	}
	if total, escs := g.Counts(); total != 2 || escs != 1 {
		t.Fatalf("counts = %d/%d", total, escs)
	}
}

func TestGuardEscalationBudgetUnder10Pct(t *testing.T) {
	// Mixed stream: 95 good outputs + 5 failures → 5% escalation < 10%.
	g := DefaultGuard()
	good := "The summary covers the river market garden story with the key actors and outcome stated clearly."
	for i := 0; i < 95; i++ {
		g.Evaluate("Summarize the story", good)
	}
	for i := 0; i < 5; i++ {
		g.Evaluate("Summarize the story", "")
	}
	if rate := g.EscalationRate(); rate >= 0.10 {
		t.Fatalf("escalation rate %f violates <10%% budget", rate)
	}
	if !g.WithinBudget() {
		t.Fatal("5% stream must be within budget")
	}
}

func TestGuardNilSafe(t *testing.T) {
	var g *Guard
	s, esc := g.Evaluate("p", "")
	if s != 0 || !esc {
		t.Fatalf("nil guard = %f %v", s, esc)
	}
	if g.EscalationRate() != 0 || !g.WithinBudget() {
		t.Fatal("nil guard stats must be zero/within budget")
	}
	if total, escs := g.Counts(); total != 0 || escs != 0 {
		t.Fatal("nil guard counts must be zero")
	}
}

func TestModelQualitySnapshot(t *testing.T) {
	q := NewModelQuality()
	q.Observe("gemini-2.0-flash", 0.8)
	q.Observe("gemini-2.0-flash", 0.6)
	q.Observe("gpt-5.5-pro", 0.95)
	if s := q.Score("gemini-2.0-flash"); s != 0.7 {
		t.Fatalf("mean = %f, want 0.7", s)
	}
	if s := q.Score("unseen-model"); s != 0 {
		t.Fatalf("unseen = %f, want 0", s)
	}
	snap := q.Snapshot()
	if len(snap) != 2 || snap["gpt-5.5-pro"] != 0.95 {
		t.Fatalf("snapshot = %v", snap)
	}
	var nilQ *ModelQuality
	nilQ.Observe("m", 1)
	if nilQ.Score("m") != 0 || len(nilQ.Snapshot()) != 0 {
		t.Fatal("nil tracker must be safe")
	}
}
