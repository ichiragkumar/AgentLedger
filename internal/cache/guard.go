// Conversation-aware guard (spec 05 §2.8): skip caching when the prompt
// carries unique user context (ids, contacts, secrets) so one user's PII
// never leaks to another user via a cache hit. Heuristic + configurable:
// DefaultGuardConfig blocks well-known unique-context shapes; operators add
// domain patterns without code changes.
package cache

import (
	"net/http"
	"regexp"
	"strings"
)

// Guard reason codes (surfaced after "guard:" in CacheReasonHeader).
const (
	GuardReasonEmptyPrompt = "empty-prompt"
	GuardReasonUUID        = "unique-id"
	GuardReasonEmail       = "contact"
	GuardReasonLongDigits  = "account-number"
	GuardReasonSecret      = "secret-like"
	GuardReasonPersonal    = "personal-context"
	GuardReasonCustom      = "custom-pattern"
)

var (
	uuidRe  = regexp.MustCompile(`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`)
	emailRe = regexp.MustCompile(`\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b`)
	// 6+ consecutive digits: account/order/phone fragments. Short numbers
	// (years, small counts, "2+2") stay cacheable.
	longDigitsRe = regexp.MustCompile(`\d{6,}`)
	secretRe     = regexp.MustCompile(`\b(sk-[A-Za-z0-9\-_]{8,}|vk_[A-Za-z0-9]+|xox[bpas]-[A-Za-z0-9\-]+|AKIA[0-9A-Z]{16}|gh[op]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+\-/=]{8,})`)
	personalRe   = regexp.MustCompile(`(?i)\b(my|user'?s|customer'?s)\s+(account|order|email|address|phone|ssn|social security|credit card|passport|license|iban|pin|password)\b`)
)

// GuardConfig tunes the unique-context heuristic.
type GuardConfig struct {
	// Enabled master-switches the guard (Config.GuardEnabled feeds this).
	Enabled bool
	// ExtraPatterns are operator regexps evaluated after built-ins.
	ExtraPatterns []*regexp.Regexp
}

// DefaultGuardConfig returns the standard heuristic (enabled, no extras).
func DefaultGuardConfig() GuardConfig { return GuardConfig{Enabled: true} }

// AddPattern compiles and appends a custom block pattern.
func (g *GuardConfig) AddPattern(expr string) error {
	re, err := regexp.Compile(expr)
	if err != nil {
		return err
	}
	g.ExtraPatterns = append(g.ExtraPatterns, re)
	return nil
}

// ShouldSkip reports whether promptText carries unique user context and must
// bypass the cache (passthrough MISS, never stored). Empty prompts skip too:
// there is nothing reusable to key on.
//
// First-person phrasing alone ("how do I reset my password", "why was my
// card charged twice") is a generic FAQ and stays cacheable — the skip fires
// only when personal phrasing travels WITH a uniqueness marker (id number,
// contact, or secret), or when a marker appears on its own.
func (g GuardConfig) ShouldSkip(promptText string) (skip bool, reason string) {
	if !g.Enabled {
		return false, ""
	}
	if strings.TrimSpace(promptText) == "" {
		return true, GuardReasonEmptyPrompt
	}
	hasMarker := uuidRe.MatchString(promptText) ||
		emailRe.MatchString(promptText) ||
		secretRe.MatchString(promptText) ||
		longDigitsRe.MatchString(promptText)
	switch {
	case uuidRe.MatchString(promptText):
		return true, GuardReasonUUID
	case emailRe.MatchString(promptText):
		return true, GuardReasonEmail
	case secretRe.MatchString(promptText):
		return true, GuardReasonSecret
	case personalRe.MatchString(promptText) && hasMarker:
		return true, GuardReasonPersonal
	case longDigitsRe.MatchString(promptText):
		return true, GuardReasonLongDigits
	}
	for _, re := range g.ExtraPatterns {
		if re != nil && re.MatchString(promptText) {
			return true, GuardReasonCustom
		}
	}
	return false, ""
}

// BypassRequested reports whether the request forces a provider round-trip
// via X-AgentLedger-No-Cache (spec 05 §2.4). Truthy values ("true", "1",
// "yes", …) bypass; explicit falsy values ("false", "0", "no", "off") and
// absent headers do not. Any other non-empty value bypasses (fail-open:
// never serve a possibly-stale hit when the caller signaled no-cache).
func BypassRequested(h http.Header) bool {
	v := strings.TrimSpace(h.Get(BypassHeader))
	if v == "" {
		return false
	}
	switch strings.ToLower(v) {
	case "0", "false", "no", "n", "off":
		return false
	default:
		return true
	}
}
