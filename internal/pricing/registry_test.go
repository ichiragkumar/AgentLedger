package pricing

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCostMath(t *testing.T) {
	r := NewDefault()
	// gpt-4o-mini: 0.15 / 0.60 per 1M
	cost, known := r.Cost("gpt-4o-mini", 1_000_000, 1_000_000)
	if !known {
		t.Fatal("expected known price")
	}
	if cost != 0.75 {
		t.Fatalf("expected 0.75, got %f", cost)
	}
}

func TestCostZeroTokens(t *testing.T) {
	r := NewDefault()
	cost, known := r.Cost("gpt-4o", 0, 0)
	if !known || cost != 0 {
		t.Fatalf("expected 0 known, got %f %v", cost, known)
	}
}

func TestGetExactAndCaseInsensitive(t *testing.T) {
	r := NewDefault()
	if _, ok := r.Get("GPT-4o-Mini"); !ok {
		t.Fatal("expected case-insensitive match")
	}
}

func TestGetPrefixFamily(t *testing.T) {
	r := NewDefault()
	p, ok := r.Get("gpt-4o-2024-11-20")
	if !ok {
		t.Fatal("expected prefix fallback for dated variant")
	}
	base, _ := r.Get("gpt-4o")
	if p != base {
		t.Fatalf("expected family price %+v, got %+v", base, p)
	}
}

func TestGetUnknownFallsBack(t *testing.T) {
	r := NewDefault()
	p, known := r.Get("future-model-9000")
	if known {
		t.Fatal("expected known=false for unknown model")
	}
	if p != DefaultFallback {
		t.Fatalf("expected default fallback, got %+v", p)
	}
	cost, known := r.Cost("future-model-9000", 1_000_000, 0)
	if known {
		t.Fatal("expected known=false in Cost too")
	}
	want := 2.50
	if cost != want {
		t.Fatalf("expected fallback cost %f, got %f", want, cost)
	}
}

func TestLoadFromBytesWrapped(t *testing.T) {
	data := []byte(`{"version":"test-1","currency":"USD","prices":{"my-model":{"input_per_1m":1,"output_per_1m":2}}}`)
	r, err := LoadFromBytes(data)
	if err != nil {
		t.Fatal(err)
	}
	if r.Version() != "test-1" {
		t.Fatalf("version = %q", r.Version())
	}
	cost, known := r.Cost("my-model", 1_000_000, 1_000_000)
	if !known || cost != 3.0 {
		t.Fatalf("got %f %v", cost, known)
	}
}

func TestLoadFromBytesBare(t *testing.T) {
	data := []byte(`{"my-model":{"input_per_1m":1,"output_per_1m":2}}`)
	r, err := LoadFromBytes(data)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r.Get("my-model"); !ok {
		t.Fatal("expected bare map load")
	}
}

func TestLoadFromBytesInvalid(t *testing.T) {
	if _, err := LoadFromBytes([]byte(`{oops`)); err == nil {
		t.Fatal("expected parse error")
	}
}

func TestLoadFromFileAndReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "prices.json")
	v1 := `{"version":"v1","currency":"USD","prices":{"a":{"input_per_1m":1,"output_per_1m":1}}}`
	if err := os.WriteFile(path, []byte(v1), 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r.Get("a"); !ok {
		t.Fatal("expected model a")
	}
	v2 := `{"version":"v2","currency":"USD","prices":{"b":{"input_per_1m":5,"output_per_1m":5}}}`
	if err := os.WriteFile(path, []byte(v2), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := r.Reload(path); err != nil {
		t.Fatal(err)
	}
	if r.Version() != "v2" {
		t.Fatalf("version = %q", r.Version())
	}
	if _, ok := r.Get("b"); !ok {
		t.Fatal("expected model b after reload")
	}
	if _, ok := r.Get("a"); ok {
		t.Fatal("model a should be gone after reload")
	}
}

func TestLoadFromFileMissing(t *testing.T) {
	if _, err := LoadFromFile(filepath.Join(t.TempDir(), "nope.json")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestReloadMissingKeepsOld(t *testing.T) {
	r := NewDefault()
	if err := r.Reload("/nonexistent/prices.json"); err == nil {
		t.Fatal("expected reload error")
	}
	if _, ok := r.Get("gpt-4o"); !ok {
		t.Fatal("old prices should survive failed reload")
	}
}

func TestRepoPricesFileLoads(t *testing.T) {
	r, err := LoadFromFile("../../data/prices.json")
	if err != nil {
		t.Skipf("repo prices file not found (ok in isolation): %v", err)
	}
	for _, m := range []string{"gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "gemini-1.5-flash", "deepseek-chat"} {
		if _, ok := r.Get(m); !ok {
			t.Fatalf("repo prices missing %s", m)
		}
	}
}
