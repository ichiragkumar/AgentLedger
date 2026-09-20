package cache

import (
	"testing"
)

func f64(v float64) *float64 { return &v }

func TestKeyForDeterministic(t *testing.T) {
	msgs := []Message{{Role: "user", Content: "hello"}}
	a := KeyFor("gpt-4o", msgs, f64(0.7))
	b := KeyFor("gpt-4o", msgs, f64(0.7))
	if a != b || len(a) != 64 {
		t.Fatalf("key not deterministic/hex256: %q", a)
	}
}

func TestKeyForPrecisionDiscriminators(t *testing.T) {
	msgs := []Message{{Role: "user", Content: "hello"}}
	base := KeyFor("gpt-4o", msgs, f64(0.7))
	cases := map[string]string{
		"model":       KeyFor("gpt-4o-mini", msgs, f64(0.7)),
		"content":     KeyFor("gpt-4o", []Message{{Role: "user", Content: "hello!"}}, f64(0.7)),
		"role":        KeyFor("gpt-4o", []Message{{Role: "system", Content: "hello"}}, f64(0.7)),
		"temperature": KeyFor("gpt-4o", msgs, f64(0.8)),
		"nil-temp":    KeyFor("gpt-4o", msgs, nil),
		"order":       KeyFor("gpt-4o", []Message{{Role: "a", Content: "x"}, {Role: "b", Content: "y"}}, f64(0.7)),
	}
	// order discriminator needs a reordered counterpart
	reordered := KeyFor("gpt-4o", []Message{{Role: "b", Content: "y"}, {Role: "a", Content: "x"}}, f64(0.7))
	if cases["order"] == reordered {
		t.Fatal("message order must affect key")
	}
	for name, k := range cases {
		if name == "order" {
			continue
		}
		if k == base {
			t.Fatalf("%s must change key", name)
		}
	}
	// nil temp vs explicit 0 must differ
	if KeyFor("gpt-4o", msgs, f64(0)) == KeyFor("gpt-4o", msgs, nil) {
		t.Fatal("nil temperature must differ from 0")
	}
}

func TestEstimateSavedUSD(t *testing.T) {
	if got := EstimateSavedUSD(100, 0.002); got != 0.2 {
		t.Fatalf("got %v", got)
	}
	if EstimateSavedUSD(0, 0.5) != 0 || EstimateSavedUSD(10, 0) != 0 || EstimateSavedUSD(-5, 1) != 0 {
		t.Fatal("non-positive inputs must yield 0")
	}
}

func TestStatsAccounting(t *testing.T) {
	var s Stats
	s.RecordExactHit(0.01)
	s.RecordSemanticHit(0.02)
	s.RecordMiss()
	s.RecordMiss()
	s.RecordStore()
	snap := s.Snapshot()
	if snap.ExactHits != 1 || snap.SemanticHits != 1 || snap.Misses != 2 || snap.Stored != 1 {
		t.Fatalf("bad snapshot: %+v", snap)
	}
	if snap.Total != 4 {
		t.Fatalf("total: %+v", snap)
	}
	if snap.HitRate != 0.5 {
		t.Fatalf("hit rate: %v", snap.HitRate)
	}
	if snap.SavedUSD < 0.02999 || snap.SavedUSD > 0.03001 {
		t.Fatalf("saved: %v", snap.SavedUSD)
	}
	s.Reset()
	if s.Snapshot().Total != 0 || s.Snapshot().SavedUSD != 0 {
		t.Fatal("reset must zero counters")
	}
	if new(Stats).HitRate() != 0 {
		t.Fatal("empty stats hit rate must be 0")
	}
}
