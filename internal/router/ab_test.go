package router

import (
	"fmt"
	"math/rand"
	"testing"
)

func TestAssignSplitRatio(t *testing.T) {
	e := NewExperiment("flash-vs-haiku", "gemini-2.0-flash", "claude-3-5-haiku", 50)
	counts := map[string]int{}
	for i := 0; i < 1000; i++ {
		counts[e.Assign(fmt.Sprintf("chain-%d", i))]++
	}
	a := counts["gemini-2.0-flash"]
	t.Logf("A=%d B=%d", a, 1000-a)
	if a < 400 || a > 600 {
		t.Fatalf("50/50 split skewed: A=%d/1000", a)
	}
	// Stable: same key always same arm.
	if e.Assign("chain-42") != e.Assign("chain-42") {
		t.Fatal("assignment must be deterministic per key")
	}
}

func TestAssignEdges(t *testing.T) {
	if got := NewExperiment("x", "a", "b", 100).Assign("anything"); got != "a" {
		t.Fatalf("pctA=100 must always route A, got %q", got)
	}
	if got := NewExperiment("x", "a", "b", 0).Assign("anything"); got != "b" {
		t.Fatalf("pctA=0 must always route B, got %q", got)
	}
	if got := NewExperiment("x", "a", "b", 999).Assign("k"); got != "a" {
		t.Fatal("pctA must clamp to 100")
	}
	if arm := NewExperiment("x", "a", "b", 50).ArmOf("zzz"); arm != "" {
		t.Fatalf("unknown model arm = %q", arm)
	}
	var nilE *Experiment
	if nilE.Assign("k") != "" || nilE.Name() != "" {
		t.Fatal("nil experiment must be safe")
	}
	nilE.Record("a", 1, 1) // must not panic
	if (Comparison{}).Recommendation != "" {
		t.Fatal("zero comparison has no recommendation")
	}
}

func TestSignificantWithin1000(t *testing.T) {
	// Realistic gap: A (cheap) costs ~$0.50±0.10 at quality 0.80;
	// B (frontier) costs ~$5.00±1.00 at quality 0.83 (within the <5%
	// quality-drop target, so the cheaper arm is recommendable).
	rng := rand.New(rand.NewSource(7))
	e := NewExperiment("cheap-vs-frontier", "cheap-model", "frontier-model", 50)
	for i := 0; i < 500; i++ {
		e.Record("cheap-model", 0.50+rng.NormFloat64()*0.10, 0.80+rng.NormFloat64()*0.03)
		e.Record("frontier-model", 5.00+rng.NormFloat64()*1.00, 0.83+rng.NormFloat64()*0.02)
	}
	c := e.Compare()
	t.Logf("N=%d cpqA=%.3f cpqB=%.3f significant=%v rec=%s", c.N, c.CostPerQualityA, c.CostPerQualityB, c.Significant, c.Recommendation)
	if c.N != 1000 {
		t.Fatalf("N = %d, want 1000", c.N)
	}
	if !c.Significant {
		t.Fatal("10x cost gap must be significant at N=1000")
	}
	if c.CheaperArm != "A" || c.Recommendation != "route-all-A" {
		t.Fatalf("verdict = %s / %s", c.CheaperArm, c.Recommendation)
	}
	if c.QualityDropVsBest > 0.05 {
		t.Fatalf("quality drop %.3f exceeds <5%% retention target", c.QualityDropVsBest)
	}
}

func TestIdenticalArmsNotSignificant(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	e := NewExperiment("same", "m1", "m2", 50)
	for i := 0; i < 500; i++ {
		e.Record("m1", 1.0+rng.NormFloat64()*0.1, 0.85)
		e.Record("m2", 1.0+rng.NormFloat64()*0.1, 0.85)
	}
	if c := e.Compare(); c.Significant {
		t.Fatal("identical arms must not be significant")
	}
}

func TestSmallSampleNotSignificant(t *testing.T) {
	e := NewExperiment("small", "m1", "m2", 50)
	for i := 0; i < 10; i++ {
		e.Record("m1", 0.1, 0.9)
		e.Record("m2", 100.0, 0.9)
	}
	if c := e.Compare(); c.Significant {
		t.Fatal("N=20 must never claim significance (floor is 1000)")
	}
}

func TestQualityGateBlocksDowngrade(t *testing.T) {
	e := NewExperiment("q", "cheap", "frontier", 50)
	for i := 0; i < 500; i++ {
		e.Record("cheap", 0.10, 0.40) // cheap but terrible
		e.Record("frontier", 5.00, 0.95)
	}
	c := e.Compare()
	if c.Recommendation == "route-all-A" {
		t.Fatalf("must not recommend the cheap arm at %.1f%% quality drop", c.QualityDropVsBest*100)
	}
}

func TestRecordClampsAndIgnores(t *testing.T) {
	e := NewExperiment("x", "a", "b", 50)
	e.Record("ghost", 5, 0.9) // unknown model ignored
	e.Record("a", 1, -2)      // quality clamps to 0 → 0.05 floor
	e.Record("b", 1, 99)      // quality clamps to 1
	if c := e.Compare(); c.N != 2 {
		t.Fatalf("N = %d, want 2", c.N)
	}
}
