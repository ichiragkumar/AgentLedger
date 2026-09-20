// Policy engine: YAML rules for model access, PII redaction, max_tokens,
// and time-of-day windows.
//
// Hot-path contract: Engine.Eval must run <1ms per request. Load-time work
// (YAML parse, regexp compile, set building, deny-hour bitmap) happens once
// in LoadPolicyYAML; Eval is map lookups + one bitmap index + regex scans
// over the request text only when a redact/block rule matches the team.
//
// Supported YAML subset (hand-rolled stdlib parser — no go.mod deps):
//
//	internal_models: ["internal-llama", "local-mistral"]  # PII-safe models
//	policies:
//	  - name: no frontier for marketing
//	    team: marketing            # "*" or omitted = all teams
//	    deny_models: ["gpt-5.5-pro", "o1"]   # or block-dash list
//	    allow_models: ["gemini-2.0-flash"]   # non-empty = allowlist
//	    max_tokens_per_request: 4096         # 0 = no limit
//	    deny_hours: "0-6,22-23"              # UTC hours denied, "" = none
//	    redact_pii: true                     # redact PII from logged text
//	    block_pii_to_external: true          # deny PII → external models
//
// Model wildcards: a trailing "*" is a prefix match ("gpt-5*").
// deny_hours entries: "H" or "H-H" (wrap supported, "22-6"); comma list.
package enforce

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// PolicyRequest is the evaluated request surface. Text is the concatenated
// prompt (used only for PII scan; empty skips the scan).
type PolicyRequest struct {
	Model     string
	Team      string
	Agent     string
	MaxTokens int // requested max_tokens (0 = unset)
	HourUTC   int // 0-23
	Text      string
}

// PolicyResult is the Eval outcome.
type PolicyResult struct {
	Allow        bool
	Reason       string // machine-readable deny code, "" when allowed
	Rule         string // rule name that decided (deny or redact)
	RedactedText string // Text with PII replaced (== Text when no PII/rules)
	PIIFound     bool
}

// Deny reason codes.
const (
	ReasonModelDenied     = "model_denied"
	ReasonModelNotAllowed = "model_not_allowed"
	ReasonMaxTokens       = "max_tokens_exceeded"
	ReasonTimeOfDay       = "time_of_day_denied"
	ReasonPIIToExternal   = "pii_to_external"
	ReasonPIILogged       = "" // redaction is not a deny
)

// PolicyRule is one compiled rule.
type PolicyRule struct {
	Name               string
	Team               string // "" or "*" = all teams
	allowExact         map[string]bool
	allowPrefix        []string
	denyExact          map[string]bool
	denyPrefix         []string
	hasAllowlist       bool
	MaxTokensPerReq    int
	denyHours          [24]bool
	hasDenyHours       bool
	RedactPII          bool
	BlockPIIToExternal bool
}

// MatchesTeam reports whether the rule applies to team.
func (r *PolicyRule) MatchesTeam(team string) bool {
	return r.Team == "" || r.Team == "*" || r.Team == team
}

// DeniesModel reports whether model is denied by this rule.
func (r *PolicyRule) DeniesModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	if r.denyExact[m] {
		return true
	}
	for _, p := range r.denyPrefix {
		if strings.HasPrefix(m, p) {
			return true
		}
	}
	return false
}

// AllowsModel reports whether model passes this rule's allowlist
// (true when the rule has no allowlist).
func (r *PolicyRule) AllowsModel(model string) bool {
	if !r.hasAllowlist {
		return true
	}
	m := strings.ToLower(strings.TrimSpace(model))
	if r.allowExact[m] {
		return true
	}
	for _, p := range r.allowPrefix {
		if strings.HasPrefix(m, p) {
			return true
		}
	}
	return false
}

// DeniesHour reports whether UTC hour h is denied by this rule.
func (r *PolicyRule) DeniesHour(h int) bool {
	if !r.hasDenyHours || h < 0 || h > 23 {
		return false
	}
	return r.denyHours[h]
}

// Engine is the compiled policy set.
type Engine struct {
	Rules           []PolicyRule
	internalExact   map[string]bool
	internalPrefix  []string
	hasInternalList bool
}

// IsExternal reports whether model may NOT receive PII (anything not on
// the internal list). With no internal list configured, every model is
// external — fail closed for PII.
func (e *Engine) IsExternal(model string) bool {
	if e == nil {
		return true
	}
	m := strings.ToLower(strings.TrimSpace(model))
	if e.internalExact[m] {
		return false
	}
	for _, p := range e.internalPrefix {
		if strings.HasPrefix(m, p) {
			return false
		}
	}
	return true
}

// --- PII detection (precompiled once, stdlib regexp) ---

var (
	reEmail = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	rePhone = regexp.MustCompile(`(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`)
	reSSN   = regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`)
	reCard  = regexp.MustCompile(`\b(?:\d[ \-.]*?){13,19}\b`)
	reKey   = regexp.MustCompile(`(?i)(sk-[A-Za-z0-9\-_]{8,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9\-_.]{8,}|xox[bpas]-[A-Za-z0-9\-_]{8,})`)
)

// DetectPII reports whether text contains PII. Card candidates must pass
// Luhn to avoid flagging order numbers.
func DetectPII(text string) bool {
	if text == "" {
		return false
	}
	if reEmail.FindString(text) != "" || reSSN.FindString(text) != "" ||
		reKey.FindString(text) != "" || rePhone.FindString(text) != "" {
		return true
	}
	for _, c := range reCard.FindAllString(text, -1) {
		if luhnOK(c) {
			return true
		}
	}
	return false
}

// RedactPII replaces PII with typed placeholders. Never sends anything
// anywhere — pure string rewrite for logs / external prompts.
func RedactPII(text string) string {
	if text == "" {
		return text
	}
	out := reEmail.ReplaceAllString(text, "[REDACTED_EMAIL]")
	out = reSSN.ReplaceAllString(out, "[REDACTED_SSN]")
	out = reKey.ReplaceAllString(out, "[REDACTED_KEY]")
	out = rePhone.ReplaceAllString(out, "[REDACTED_PHONE]")
	out = reCard.ReplaceAllStringFunc(out, func(m string) string {
		if luhnOK(m) {
			return "[REDACTED_CARD]"
		}
		return m
	})
	return out
}

func luhnOK(s string) bool {
	digits := make([]byte, 0, 19)
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			digits = append(digits, s[i]-'0')
		}
	}
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	sum := 0
	alt := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := int(digits[i])
		if alt {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		alt = !alt
	}
	return sum%10 == 0
}

// Eval runs all matching rules in order; first deny wins. PII handling
// runs after access checks: deny PII→external, else redact for the log
// path. Allowlisted teams with no matching rules allow by default.
func (e *Engine) Eval(req PolicyRequest) PolicyResult {
	res := PolicyResult{Allow: true, RedactedText: req.Text}
	if e == nil {
		return res
	}
	needRedact := false
	needBlock := false
	for i := range e.Rules {
		r := &e.Rules[i]
		if !r.MatchesTeam(req.Team) {
			continue
		}
		if r.DeniesModel(req.Model) {
			res.Allow = false
			res.Reason = ReasonModelDenied
			res.Rule = r.Name
			return res
		}
		if !r.AllowsModel(req.Model) {
			res.Allow = false
			res.Reason = ReasonModelNotAllowed
			res.Rule = r.Name
			return res
		}
		if r.MaxTokensPerReq > 0 && req.MaxTokens > r.MaxTokensPerReq {
			res.Allow = false
			res.Reason = ReasonMaxTokens
			res.Rule = r.Name
			return res
		}
		if r.DeniesHour(req.HourUTC) {
			res.Allow = false
			res.Reason = ReasonTimeOfDay
			res.Rule = r.Name
			return res
		}
		if r.RedactPII {
			needRedact = true
			if res.Rule == "" {
				res.Rule = r.Name
			}
		}
		if r.BlockPIIToExternal {
			needBlock = true
		}
	}
	if (needRedact || needBlock) && req.Text != "" && DetectPII(req.Text) {
		res.PIIFound = true
		if needBlock && e.IsExternal(req.Model) {
			res.Allow = false
			res.Reason = ReasonPIIToExternal
			res.RedactedText = RedactPII(req.Text)
			return res
		}
		res.RedactedText = RedactPII(req.Text)
	}
	return res
}

// --- Minimal YAML-subset loader (stdlib only) ---

// LoadPolicyYAML parses the documented subset into a compiled Engine.
func LoadPolicyYAML(data []byte) (*Engine, error) {
	p := &yamlParser{lines: strings.Split(string(data), "\n")}
	return p.parse()
}

// MustLoadPolicy panics on invalid YAML (for static embedded configs).
func MustLoadPolicy(data []byte) *Engine {
	e, err := LoadPolicyYAML(data)
	if err != nil {
		panic(fmt.Sprintf("enforce: bad policy YAML: %v", err))
	}
	return e
}

type rawRule struct {
	name               string
	team               string
	allowModels        []string
	denyModels         []string
	maxTokens          int
	maxTokensSet       bool
	denyHours          string
	redactPII          bool
	blockPIIToExternal bool
}

type yamlParser struct {
	lines []string
}

func indentOf(s string) int {
	n := 0
	for n < len(s) && (s[n] == ' ' || s[n] == '\t') {
		n++
	}
	return n
}

// stripComment cuts a trailing # comment (quote-aware, minimal).
func stripComment(s string) string {
	var q byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if q != 0 {
			if c == q {
				q = 0
			}
			continue
		}
		if c == '"' || c == '\'' {
			q = c
			continue
		}
		if c == '#' && (i == 0 || s[i-1] == ' ' || s[i-1] == '\t') {
			return strings.TrimRight(s[:i], " \t")
		}
	}
	return s
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// parseInlineList parses ["a", 'b', c] → [a b c].
func parseInlineList(s string) []string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "[") || !strings.HasSuffix(s, "]") {
		return nil
	}
	inner := strings.TrimSpace(s[1 : len(s)-1])
	if inner == "" {
		return nil
	}
	var out []string
	var cur strings.Builder
	var q byte
	for i := 0; i < len(inner); i++ {
		c := inner[i]
		if q != 0 {
			if c == q {
				q = 0
				continue
			}
			cur.WriteByte(c)
			continue
		}
		if c == '"' || c == '\'' {
			q = c
			continue
		}
		if c == ',' {
			if v := strings.TrimSpace(cur.String()); v != "" {
				out = append(out, v)
			}
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	if v := strings.TrimSpace(cur.String()); v != "" {
		out = append(out, v)
	}
	return out
}

func splitKeyValue(s string) (key, val string, ok bool) {
	i := strings.Index(s, ":")
	if i < 0 {
		return "", "", false
	}
	key = strings.TrimSpace(s[:i])
	val = strings.TrimSpace(s[i+1:])
	if key == "" || strings.Contains(key, " ") {
		return "", "", false
	}
	return key, val, true
}

func (p *yamlParser) parse() (*Engine, error) {
	e := &Engine{internalExact: map[string]bool{}}
	var raws []rawRule
	i := 0
	for i < len(p.lines) {
		raw := stripComment(p.lines[i])
		trimmed := strings.TrimSpace(raw)
		i++
		if trimmed == "" || strings.HasPrefix(trimmed, "---") {
			continue
		}
		key, val, ok := splitKeyValue(strings.TrimSpace(raw))
		if !ok {
			continue
		}
		switch key {
		case "internal_models":
			models, next := p.listValue(val, &i, indentOf(raw))
			i = next
			for _, m := range models {
				addPattern(e.internalExact, &e.internalPrefix, m)
			}
			e.hasInternalList = true
		case "policies":
			rules, next, err := p.policyList(&i, indentOf(raw))
			if err != nil {
				return nil, err
			}
			i = next
			raws = rules
		}
	}
	for _, rr := range raws {
		r := PolicyRule{Name: rr.name, Team: rr.team, MaxTokensPerReq: rr.maxTokens,
			RedactPII: rr.redactPII, BlockPIIToExternal: rr.blockPIIToExternal}
		r.allowExact = map[string]bool{}
		r.denyExact = map[string]bool{}
		for _, m := range rr.allowModels {
			addPattern(r.allowExact, &r.allowPrefix, m)
		}
		r.hasAllowlist = len(rr.allowModels) > 0
		for _, m := range rr.denyModels {
			addPattern(r.denyExact, &r.denyPrefix, m)
		}
		if rr.denyHours != "" {
			bm, err := parseDenyHours(rr.denyHours)
			if err != nil {
				return nil, fmt.Errorf("enforce: rule %q: %w", rr.name, err)
			}
			r.denyHours = bm
			r.hasDenyHours = true
		}
		e.Rules = append(e.Rules, r)
	}
	return e, nil
}

func addPattern(exact map[string]bool, prefix *[]string, pat string) {
	pat = strings.ToLower(strings.TrimSpace(unquote(pat)))
	if pat == "" {
		return
	}
	if strings.HasSuffix(pat, "*") {
		*prefix = append(*prefix, strings.TrimSuffix(pat, "*"))
		return
	}
	exact[pat] = true
}

// listValue resolves either an inline list or a following dash block.
func (p *yamlParser) listValue(val string, pi *int, parentIndent int) ([]string, int) {
	if strings.HasPrefix(strings.TrimSpace(val), "[") {
		return parseInlineList(val), *pi
	}
	if strings.TrimSpace(val) != "" {
		return []string{unquote(val)}, *pi
	}
	// Dash block: consume deeper-indented "- item" lines.
	var out []string
	i := *pi
	for i < len(p.lines) {
		raw := stripComment(p.lines[i])
		if strings.TrimSpace(raw) == "" {
			i++
			continue
		}
		if indentOf(raw) <= parentIndent {
			break
		}
		t := strings.TrimSpace(raw)
		if !strings.HasPrefix(t, "- ") && t != "-" {
			break
		}
		out = append(out, unquote(strings.TrimSpace(strings.TrimPrefix(t, "-"))))
		i++
	}
	return out, i
}

// policyList parses the dash list under "policies:".
func (p *yamlParser) policyList(pi *int, parentIndent int) ([]rawRule, int, error) {
	var out []rawRule
	i := *pi
	var cur *rawRule
	curIndent := -1
	flush := func() {
		if cur != nil {
			out = append(out, *cur)
			cur = nil
		}
	}
	for i < len(p.lines) {
		raw := stripComment(p.lines[i])
		if strings.TrimSpace(raw) == "" {
			i++
			continue
		}
		ind := indentOf(raw)
		if ind <= parentIndent {
			break
		}
		t := strings.TrimSpace(raw)
		if strings.HasPrefix(t, "- ") || t == "-" {
			flush()
			cur = &rawRule{}
			curIndent = ind
			rest := strings.TrimSpace(strings.TrimPrefix(t, "-"))
			i++
			if rest != "" {
				k, v, ok := splitKeyValue(rest)
				if !ok {
					return nil, i, fmt.Errorf("enforce: bad rule entry %q", rest)
				}
				if err := p.assignField(cur, k, v, &i, curIndent); err != nil {
					return nil, i, err
				}
			}
			continue
		}
		if cur == nil {
			i++
			continue
		}
		k, v, ok := splitKeyValue(t)
		if !ok {
			i++
			continue
		}
		i++
		if err := p.assignField(cur, k, v, &i, ind); err != nil {
			return nil, i, err
		}
	}
	flush()
	return out, i, nil
}

func (p *yamlParser) assignField(cur *rawRule, k, v string, pi *int, fieldIndent int) error {
	switch k {
	case "name":
		cur.name = unquote(v)
	case "team":
		cur.team = unquote(v)
	case "allow_models":
		models, next := p.listValue(v, pi, fieldIndent)
		*pi = next
		cur.allowModels = append(cur.allowModels, models...)
	case "deny_models":
		models, next := p.listValue(v, pi, fieldIndent)
		*pi = next
		cur.denyModels = append(cur.denyModels, models...)
	case "max_tokens_per_request":
		n, err := strconv.Atoi(strings.TrimSpace(unquote(v)))
		if err != nil {
			return fmt.Errorf("enforce: bad max_tokens_per_request %q", v)
		}
		cur.maxTokens, cur.maxTokensSet = n, true
	case "deny_hours":
		cur.denyHours = unquote(v)
	case "redact_pii", "redact":
		b, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("enforce: bad redact_pii %q", v)
		}
		cur.redactPII = b
	case "block_pii_to_external", "block_pii_external":
		b, err := parseBool(v)
		if err != nil {
			return fmt.Errorf("enforce: bad block_pii_to_external %q", v)
		}
		cur.blockPIIToExternal = b
	}
	return nil
}

func parseBool(s string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(unquote(s))) {
	case "true", "yes", "y", "1", "on":
		return true, nil
	case "false", "no", "n", "0", "off":
		return false, nil
	}
	return false, fmt.Errorf("not a bool")
}

// parseDenyHours compiles "0-6,22-23" / "22-6" / "3" into a 24-bitmap.
func parseDenyHours(s string) ([24]bool, error) {
	var bm [24]bool
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			b := strings.SplitN(part, "-", 2)
			lo, err1 := strconv.Atoi(strings.TrimSpace(b[0]))
			hi, err2 := strconv.Atoi(strings.TrimSpace(b[1]))
			if err1 != nil || err2 != nil || lo < 0 || lo > 23 || hi < 0 || hi > 23 {
				return bm, fmt.Errorf("bad hour range %q", part)
			}
			if lo <= hi {
				for h := lo; h <= hi; h++ {
					bm[h] = true
				}
			} else {
				for h := lo; h < 24; h++ {
					bm[h] = true
				}
				for h := 0; h <= hi; h++ {
					bm[h] = true
				}
			}
			continue
		}
		h, err := strconv.Atoi(part)
		if err != nil || h < 0 || h > 23 {
			return bm, fmt.Errorf("bad hour %q", part)
		}
		bm[h] = true
	}
	return bm, nil
}
