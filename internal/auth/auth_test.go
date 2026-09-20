package auth

import (
	"net/http"
	"testing"
)

func TestResolveKnown(t *testing.T) {
	r := NewMapResolver(map[string]string{"vk_test": "sk-upstream"})
	res, err := r.Resolve("vk_test")
	if err != nil {
		t.Fatal(err)
	}
	if res.UpstreamKey != "sk-upstream" {
		t.Fatalf("upstream = %q", res.UpstreamKey)
	}
	if res.KeyPrefix != "vk_t***" {
		t.Fatalf("prefix = %q", res.KeyPrefix)
	}
}

func TestResolveUnknownAndMissing(t *testing.T) {
	r := NewMapResolver(map[string]string{"vk_test": "sk-upstream"})
	if _, err := r.Resolve("vk_nope"); err != ErrUnknownKey {
		t.Fatalf("expected ErrUnknownKey, got %v", err)
	}
	if _, err := r.Resolve(""); err != ErrMissingKey {
		t.Fatalf("expected ErrMissingKey, got %v", err)
	}
	if _, err := r.Resolve("   "); err != ErrMissingKey {
		t.Fatalf("expected ErrMissingKey for blank, got %v", err)
	}
}

func TestVirtualKeyFromRequestPriority(t *testing.T) {
	r, _ := http.NewRequest("POST", "/", nil)
	r.Header.Set("AgentLedger-Key", "vk_first")
	r.Header.Set("Authorization", "Bearer vk_second")
	if got := VirtualKeyFromRequest(r); got != "vk_first" {
		t.Fatalf("got %q", got)
	}

	r2, _ := http.NewRequest("POST", "/", nil)
	r2.Header.Set("Authorization", "Bearer vk_second")
	if got := VirtualKeyFromRequest(r2); got != "vk_second" {
		t.Fatalf("got %q", got)
	}

	r3, _ := http.NewRequest("POST", "/", nil)
	r3.Header.Set("X-AgentLedger-Key", "vk_x")
	if got := VirtualKeyFromRequest(r3); got != "vk_x" {
		t.Fatalf("got %q", got)
	}

	// Non-vk bearer tokens are NOT virtual keys (real user tokens must not
	// be mistaken for vk_xxx).
	r4, _ := http.NewRequest("POST", "/", nil)
	r4.Header.Set("Authorization", "Bearer sk-real")
	if got := VirtualKeyFromRequest(r4); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}

	r5, _ := http.NewRequest("POST", "/", nil)
	if got := VirtualKeyFromRequest(r5); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestRedactedPrefix(t *testing.T) {
	if got := RedactedPrefix("vk_test_123"); got != "vk_t***" {
		t.Fatalf("got %q", got)
	}
	if got := RedactedPrefix("ab"); got != "***" {
		t.Fatalf("got %q", got)
	}
	// Never leak more than 4 chars.
	if got := RedactedPrefix("vk_supersecretvalue"); len(got) != 7 {
		t.Fatalf("got %q", got)
	}
}

func TestNewMapResolverFromEnv(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-env-test")
	t.Setenv("VIRTUAL_KEYS", "vk_extra=sk-extra")
	r := NewMapResolverFromEnv()
	res, err := r.Resolve("vk_test")
	if err != nil {
		t.Fatal(err)
	}
	if res.UpstreamKey != "sk-env-test" {
		t.Fatalf("upstream = %q", res.UpstreamKey)
	}
	if _, err := r.Resolve("vk_extra"); err != nil {
		t.Fatalf("extra key: %v", err)
	}
}

func TestParseExtraKeys(t *testing.T) {
	m := parseExtraKeys("vk_a=sk-a, vk_b=sk-b ,badpair, =x, y= ")
	if len(m) != 2 || m["vk_a"] != "sk-a" || m["vk_b"] != "sk-b" {
		t.Fatalf("got %+v", m)
	}
	if len(parseExtraKeys("")) != 0 {
		t.Fatal("expected empty")
	}
}
