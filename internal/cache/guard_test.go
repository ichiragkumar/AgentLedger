package cache

import (
	"net/http"
	"testing"
)

func TestGuardSkipsUniqueContext(t *testing.T) {
	g := DefaultGuardConfig()
	for prompt, want := range map[string]string{
		"my order 550e8400-e29b-41d4-a716-446655440000 status": GuardReasonUUID,
		"contact me at jane@example.com please":                GuardReasonEmail,
		"order number 48291044":                                GuardReasonLongDigits,
		"key is sk-abcdefghijklmnopqrst leaked":                GuardReasonSecret,
		"my account 482910 balance":                            GuardReasonPersonal,
		"my credit card ending 441244 was charged":             GuardReasonPersonal,
	} {
		skip, reason := g.ShouldSkip(prompt)
		if !skip || reason != want {
			t.Fatalf("prompt %q: skip=%v reason=%q want %q", prompt, skip, reason, want)
		}
	}
	if skip, _ := g.ShouldSkip(""); !skip {
		t.Fatal("empty must skip")
	}
}

func TestGuardAllowsCacheable(t *testing.T) {
	g := DefaultGuardConfig()
	for _, p := range []string{
		"how do I reset my password",
		"why was my credit card charged twice",
		"what is 2+2? explain in 2024 style",
		"summarize: the quick brown fox",
		"write a haiku about caching (5 lines max, 3 attempts)",
	} {
		if skip, reason := g.ShouldSkip(p); skip {
			t.Fatalf("cacheable prompt skipped: %q (%s)", p, reason)
		}
	}
	off := GuardConfig{Enabled: false}
	if skip, _ := off.ShouldSkip("jane@example.com 550e8400-e29b-41d4-a716-446655440000"); skip {
		t.Fatal("disabled guard must never skip")
	}
}

func TestGuardCustomPattern(t *testing.T) {
	g := DefaultGuardConfig()
	if err := g.AddPattern(`order#[A-Z]{3}-\d+`); err != nil {
		t.Fatal(err)
	}
	if skip, reason := g.ShouldSkip("status of order#ABC-123"); !skip || reason != GuardReasonCustom {
		t.Fatalf("custom pattern: %v %q", skip, reason)
	}
	if err := g.AddPattern(`([invalid`); err == nil {
		t.Fatal("bad regexp must error")
	}
}

func TestBypassRequested(t *testing.T) {
	truthy := []string{"true", "True", "TRUE", "1", "yes", "YES", "on", "anything-else"}
	for _, v := range truthy {
		h := http.Header{}
		h.Set(BypassHeader, v)
		if !BypassRequested(h) {
			t.Fatalf("%q must bypass", v)
		}
	}
	falsy := []string{"", "false", "False", "0", "no", "off", "n"}
	for _, v := range falsy {
		h := http.Header{}
		if v != "" {
			h.Set(BypassHeader, v)
		}
		if BypassRequested(h) {
			t.Fatalf("%q must not bypass", v)
		}
	}
}
