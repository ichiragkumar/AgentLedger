package pricing

import "testing"

// Hardening coverage: negative-clamp, file validation, registry getters.

func TestCostClampsNegativeTokens(t *testing.T) {
	r := NewDefault()
	cost, known := r.Cost("gpt-4o-mini", -100, -50)
	if !known || cost != 0 {
		t.Fatalf("expected clamped 0 known, got %f %v", cost, known)
	}
}

func TestLoadRejectsNegativeRates(t *testing.T) {
	bad := []byte(`{"version":"bad","prices":{"evil":{"input_per_1m":-1,"output_per_1m":2}}}`)
	if _, err := LoadFromBytes(bad); err == nil {
		t.Fatal("expected error for negative input rate")
	}
	badOut := []byte(`{"evil":{"input_per_1m":1,"output_per_1m":-5}}`)
	if _, err := LoadFromBytes(badOut); err == nil {
		t.Fatal("expected error for negative output rate")
	}
}

func TestRegistryGetters(t *testing.T) {
	r := NewDefault()
	if r.Size() <= 0 {
		t.Fatal("expected non-empty registry")
	}
	models := r.Models()
	if len(models) != r.Size() {
		t.Fatalf("Models len %d != Size %d", len(models), r.Size())
	}
	for i := 1; i < len(models); i++ {
		if models[i-1] >= models[i] {
			t.Fatalf("Models not sorted: %v", models)
		}
	}
	if r.Currency() != "USD" {
		t.Fatalf("currency = %q", r.Currency())
	}
	// Wrapped file without currency defaults to USD.
	raw := []byte(`{"prices":{"x":{"input_per_1m":1,"output_per_1m":1}}}`)
	r2, err := LoadFromBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if r2.Currency() != "USD" {
		t.Fatalf("currency = %q", r2.Currency())
	}
}
