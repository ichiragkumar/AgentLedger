package enforce

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

const policyTestYAML = `
internal_models: ["internal-llama", "local-*"]
policies:
  - name: no frontier for marketing
    team: marketing
    deny_models: ["gpt-5.5-pro", "o1"]
    max_tokens_per_request: 4096
    deny_hours: "0-6"
    redact_pii: true
    block_pii_to_external: true
  - name: research gets everything
    team: research
    allow_models: ["*"]
  - name: support cheap only
    team: support
    allow_models:
      - gemini-2.0-flash
      - claude-3-5-haiku
  - name: night batch window
    team: batch
    deny_hours: "22-6"
  - name: wildcard frontier ban
    team: finance
    deny_models: ["gpt-5*", "o1*"]
    max_tokens_per_request: 2048
`

func loadTestEngine(t *testing.T) *Engine {
	t.Helper()
	e, err := LoadPolicyYAML([]byte(policyTestYAML))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return e
}

// 50+ rule evaluations: model access, PII redaction, token limits, time-of-day.
func TestPolicySuite50Plus(t *testing.T) {
	e := loadTestEngine(t)
	type tc struct {
		name                  string
		req                   PolicyRequest
		wantAllow             bool
		wantReason            string
		wantPII, wantRedacted bool
	}
	var cases []tc
	// --- Model access: marketing denies (8) ---
	for i, m := range []string{"gpt-5.5-pro", "GPT-5.5-PRO", "o1", "O1", "gpt-5.5-pro-2026", "o1-mini", "o1-preview", "gpt-5.5-pro-turbo"} {
		deny := i < 4 // exact (case-insensitive) denies; dated/prefixed variants pass (no wildcard on this rule)
		cases = append(cases, tc{
			name:      fmt.Sprintf("marketing model %s", m),
			req:       PolicyRequest{Model: m, Team: "marketing", HourUTC: 12},
			wantAllow: !deny, wantReason: map[bool]string{true: "", false: ReasonModelDenied}[!deny],
		})
	}
	// --- Marketing allows (6) ---
	for _, m := range []string{"gpt-4o", "gemini-2.0-flash", "claude-sonnet-4", "internal-llama", "local-mistral", "deepseek-chat"} {
		cases = append(cases, tc{name: "marketing allows " + m,
			req: PolicyRequest{Model: m, Team: "marketing", HourUTC: 12}, wantAllow: true})
	}
	// --- max_tokens (6) ---
	for _, n := range []int{0, 1, 2048, 4096} {
		cases = append(cases, tc{name: fmt.Sprintf("marketing tokens %d allow", n),
			req: PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: 12, MaxTokens: n}, wantAllow: true})
	}
	for _, n := range []int{4097, 8192} {
		cases = append(cases, tc{name: fmt.Sprintf("marketing tokens %d deny", n),
			req:       PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: 12, MaxTokens: n},
			wantAllow: false, wantReason: ReasonMaxTokens})
	}
	// --- time-of-day marketing 0-6 (8) ---
	for _, h := range []int{0, 3, 6} {
		cases = append(cases, tc{name: fmt.Sprintf("marketing hour %d deny", h),
			req:       PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: h},
			wantAllow: false, wantReason: ReasonTimeOfDay})
	}
	for _, h := range []int{7, 12, 18, 21, 23} {
		cases = append(cases, tc{name: fmt.Sprintf("marketing hour %d allow", h),
			req: PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: h}, wantAllow: true})
	}
	// --- batch wrap window 22-6 (6) ---
	for _, h := range []int{22, 23, 0, 5, 6} {
		cases = append(cases, tc{name: fmt.Sprintf("batch hour %d deny", h),
			req:       PolicyRequest{Model: "gpt-4o", Team: "batch", HourUTC: h},
			wantAllow: false, wantReason: ReasonTimeOfDay})
	}
	cases = append(cases, tc{name: "batch hour 12 allow",
		req: PolicyRequest{Model: "gpt-4o", Team: "batch", HourUTC: 12}, wantAllow: true})
	// --- support allowlist (5) ---
	for _, m := range []string{"gemini-2.0-flash", "claude-3-5-haiku"} {
		cases = append(cases, tc{name: "support allows " + m,
			req: PolicyRequest{Model: m, Team: "support", HourUTC: 12}, wantAllow: true})
	}
	for _, m := range []string{"gpt-4o", "gpt-5.5-pro", "claude-sonnet-4"} {
		cases = append(cases, tc{name: "support denies " + m,
			req:       PolicyRequest{Model: m, Team: "support", HourUTC: 12},
			wantAllow: false, wantReason: ReasonModelNotAllowed})
	}
	// --- finance wildcard + tokens (5) ---
	for _, m := range []string{"gpt-5.5-pro", "gpt-5-mini", "o1", "o1-preview"} {
		cases = append(cases, tc{name: "finance wildcard denies " + m,
			req:       PolicyRequest{Model: m, Team: "finance", HourUTC: 12},
			wantAllow: false, wantReason: ReasonModelDenied})
	}
	cases = append(cases, tc{name: "finance tokens 2049 deny",
		req:       PolicyRequest{Model: "gpt-4o", Team: "finance", HourUTC: 12, MaxTokens: 2049},
		wantAllow: false, wantReason: ReasonMaxTokens})
	// --- research open (2) ---
	for _, m := range []string{"gpt-5.5-pro", "o1"} {
		cases = append(cases, tc{name: "research allows " + m,
			req: PolicyRequest{Model: m, Team: "research", HourUTC: 3, MaxTokens: 100000}, wantAllow: true})
	}
	// --- PII: block to external, allow+redact to internal (7) ---
	piiText := "contact jane.doe@acme.com or 415-555-0132 about invoice"
	for _, m := range []string{"gpt-4o", "claude-sonnet-4"} {
		cases = append(cases, tc{name: "marketing PII blocked external " + m,
			req:       PolicyRequest{Model: m, Team: "marketing", HourUTC: 12, Text: piiText},
			wantAllow: false, wantReason: ReasonPIIToExternal, wantPII: true, wantRedacted: true})
	}
	for _, m := range []string{"internal-llama", "local-mistral-x"} {
		cases = append(cases, tc{name: "marketing PII redacted internal " + m,
			req:       PolicyRequest{Model: m, Team: "marketing", HourUTC: 12, Text: piiText},
			wantAllow: true, wantPII: true, wantRedacted: true})
	}
	cases = append(cases, tc{name: "marketing clean text passes",
		req:       PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: 12, Text: "summarize quarterly revenue trends"},
		wantAllow: true})
	cases = append(cases, tc{name: "unmatched team allows all",
		req: PolicyRequest{Model: "gpt-5.5-pro", Team: "legal", HourUTC: 12, MaxTokens: 99999}, wantAllow: true})
	cases = append(cases, tc{name: "SSN blocked",
		req:       PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: 12, Text: "ssn 123-45-6789 verify"},
		wantAllow: false, wantReason: ReasonPIIToExternal, wantPII: true, wantRedacted: true})

	if len(cases) < 50 {
		t.Fatalf("suite has %d cases, need 50+", len(cases))
	}
	t.Logf("running %d policy cases", len(cases))
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := e.Eval(c.req)
			if res.Allow != c.wantAllow || res.Reason != c.wantReason {
				t.Fatalf("allow=%v reason=%q, want allow=%v reason=%q (rule %q)",
					res.Allow, res.Reason, c.wantAllow, c.wantReason, res.Rule)
			}
			if res.PIIFound != c.wantPII {
				t.Fatalf("PIIFound=%v, want %v", res.PIIFound, c.wantPII)
			}
			if c.wantRedacted {
				if res.RedactedText == c.req.Text || strings.Contains(res.RedactedText, "@acme.com") ||
					strings.Contains(res.RedactedText, "415-555-0132") || strings.Contains(res.RedactedText, "123-45-6789") {
					t.Fatalf("PII not redacted: %q", res.RedactedText)
				}
			}
		})
	}
}

func TestPIIDetectionVectors(t *testing.T) {
	pii := []string{
		"mail me at jane.doe@acme.com",
		"call +1 (415) 555-0132",
		"ssn 123-45-6789",
		"card 4111 1111 1111 1111", // Luhn-valid test Visa
		"key sk-abcDEF1234567890xyz",
		"config api_key: hunter2value!",
	}
	for _, s := range pii {
		if !DetectPII(s) {
			t.Errorf("missed PII in %q", s)
		}
		if r := RedactPII(s); r == s {
			t.Errorf("no redaction for %q", s)
		}
	}
	clean := []string{"", "summarize revenue", "order 12345 shipped", "call me tomorrow"}
	for _, s := range clean {
		if DetectPII(s) {
			t.Errorf("false positive on %q", s)
		}
	}
	// Non-Luhn digit run must NOT flag.
	if DetectPII("order 4111 1111 1111 1112 confirmed") {
		t.Error("non-Luhn number flagged as card")
	}
	// Redaction is total: no raw PII survives.
	raw := "jane.doe@acme.com 415-555-0132 123-45-6789 4111111111111111 sk-abcDEF1234567890"
	red := RedactPII(raw)
	for _, leak := range []string{"@acme.com", "415-555-0132", "123-45-6789", "4111111111111111", "sk-abcDEF"} {
		if strings.Contains(red, leak) {
			t.Errorf("leak %q in %q", leak, red)
		}
	}
}

func TestYAMLSubsetVariants(t *testing.T) {
	// Inline lists, block lists, comments, quotes, bool synonyms.
	doc := `
# top comment
internal_models: [internal-a, "local-*"]  # trailing comment
policies:
  - name: "quoted rule"
    team: 'mkt'
    deny_models:
      - gpt-5.5-pro
      - o1
    allow_models: ["gemini-2.0-flash"]
    max_tokens_per_request: 100
    deny_hours: "9, 17-18"
    redact_pii: yes
    block_pii_to_external: on
`
	e, err := LoadPolicyYAML([]byte(doc))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(e.Rules) != 1 {
		t.Fatalf("rules = %d, want 1", len(e.Rules))
	}
	r := e.Rules[0]
	if r.Name != "quoted rule" || r.Team != "mkt" || r.MaxTokensPerReq != 100 || !r.RedactPII || !r.BlockPIIToExternal {
		t.Fatalf("rule = %+v", r)
	}
	if !r.DeniesModel("GPT-5.5-PRO") || !r.DeniesHour(9) || !r.DeniesHour(17) || !r.DeniesHour(18) || r.DeniesHour(10) {
		t.Fatal("deny sets wrong")
	}
	if !r.AllowsModel("gemini-2.0-flash") || r.AllowsModel("gpt-4o") {
		t.Fatal("allowlist wrong")
	}
	if e.IsExternal("internal-a") || e.IsExternal("local-xyz") || !e.IsExternal("gpt-4o") {
		t.Fatal("internal/external classification wrong")
	}
	// Fail-closed PII: no internal list → everything external.
	bare, err := LoadPolicyYAML([]byte("policies:\n  - name: r\n    block_pii_to_external: true\n"))
	if err != nil {
		t.Fatalf("parse bare: %v", err)
	}
	if res := bare.Eval(PolicyRequest{Model: "anything", Text: "summarize revenue"}); !res.Allow {
		t.Fatalf("clean text must pass, got %+v", res)
	}
	if res := bare.Eval(PolicyRequest{Model: "anything", Text: "a@b.com"}); res.Allow || res.Reason != ReasonPIIToExternal {
		t.Fatalf("fail-closed PII block = %+v", res)
	}
	// Bad inputs error.
	for _, doc := range []string{
		"policies:\n  - name: r\n    max_tokens_per_request: lots\n",
		"policies:\n  - name: r\n    deny_hours: \"25\"\n",
		"policies:\n  - name: r\n    deny_hours: \"x-y\"\n",
	} {
		if _, err := LoadPolicyYAML([]byte(doc)); err == nil {
			t.Errorf("expected error for %q", doc)
		}
	}
	// Nil engine allows everything (safe default for unwired installs).
	var nilEng *Engine
	if res := nilEng.Eval(PolicyRequest{Model: "x"}); !res.Allow {
		t.Fatal("nil engine must allow")
	}
}

func TestPolicyEvalUnder1ms(t *testing.T) {
	e := loadTestEngine(t)
	req := PolicyRequest{Model: "gpt-4o", Team: "marketing", HourUTC: 12, MaxTokens: 100,
		Text: "summarize jane.doe@acme.com account 415-555-0132 please"}
	// Warmup (regexp + map caches).
	for i := 0; i < 50; i++ {
		e.Eval(req)
	}
	const n = 1000
	start := time.Now()
	for i := 0; i < n; i++ {
		e.Eval(req)
	}
	avg := time.Since(start) / n
	t.Logf("avg Eval = %v over %d iters", avg, n)
	if avg >= time.Millisecond {
		t.Fatalf("avg Eval %v exceeds 1ms budget", avg)
	}
}
