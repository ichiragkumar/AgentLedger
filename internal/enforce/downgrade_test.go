package enforce

import "testing"

func TestModelTierClassification(t *testing.T) {
	cases := []struct {
		model, tier string
	}{
		{"gemini-2.0-flash", TierSimple},
		{"gemini-1.5-flash", TierSimple},
		{"gpt-4o-mini", TierSimple},
		{"claude-3-5-haiku", TierModerate},
		{"o3-mini", TierSimple}, // mini wins → simple
		{"claude-sonnet-4", TierComplex},
		{"claude-3-5-sonnet", TierComplex},
		{"gpt-4o", TierComplex},
		{"gemini-1.5-pro", TierComplex},
		{"mistral-large-latest", TierComplex},
		{"deepseek-chat", TierComplex},
		{"gpt-5.5-pro", TierFrontier},
		{"o1", TierFrontier},
		{"mystery-model-3000", TierFrontier}, // unknown → frontier (fail safe)
	}
	for _, c := range cases {
		if got := ModelTier(c.model); got != c.tier {
			t.Errorf("ModelTier(%q) = %q, want %q", c.model, got, c.tier)
		}
	}
}

func TestCheaperTierWalk(t *testing.T) {
	if CheaperTier(TierFrontier) != TierComplex ||
		CheaperTier(TierComplex) != TierModerate ||
		CheaperTier(TierModerate) != TierSimple ||
		CheaperTier(TierSimple) != TierSimple {
		t.Fatal("tier ladder broken")
	}
}

func TestDowngradeStepsDownOneTier(t *testing.T) {
	d := NewDefaultDowngrader()
	cases := []struct {
		in, want string
		changed  bool
	}{
		{"gpt-5.5-pro", "claude-sonnet-4", true},        // frontier → complex
		{"o1", "claude-sonnet-4", true},                 // frontier → complex
		{"claude-sonnet-4", "claude-3-5-haiku", true},   // complex → moderate
		{"gpt-4o", "claude-3-5-haiku", true},            // complex → moderate
		{"claude-3-5-haiku", "gemini-2.0-flash", true},  // moderate → simple
		{"gemini-2.0-flash", "gemini-2.0-flash", false}, // already cheapest
	}
	for _, c := range cases {
		got, changed := d.Downgrade(c.in)
		if got != c.want || changed != c.changed {
			t.Errorf("Downgrade(%q) = (%q,%v), want (%q,%v)", c.in, got, changed, c.want, c.changed)
		}
	}
}

func TestDowngradeCustomMap(t *testing.T) {
	d := &Downgrader{Models: map[string]string{TierComplex: "internal-cheap"}, CheapDefault: "internal-cheap"}
	got, changed := d.Downgrade("gpt-5.5-pro")
	if !changed || got != "internal-cheap" {
		t.Fatalf("custom downgrade = (%q,%v)", got, changed)
	}
	// Missing tier mapping falls back to CheapDefault.
	d2 := &Downgrader{CheapDefault: "fallback-mini"}
	got, _ = d2.Downgrade("gpt-5.5-pro")
	if got != "fallback-mini" {
		t.Fatalf("fallback downgrade = %q", got)
	}
}

func TestShouldDowngradeBand(t *testing.T) {
	for _, u := range []float64{90, 92.5, 99.9} {
		if !ShouldDowngrade(u) {
			t.Errorf("ShouldDowngrade(%v) = false, want true", u)
		}
	}
	for _, u := range []float64{0, 50, 89.9, 100, 120} {
		if ShouldDowngrade(u) {
			t.Errorf("ShouldDowngrade(%v) = true, want false", u)
		}
	}
}
