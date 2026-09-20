// Routing rules engine (spec 06 task 3.4).
//
// YAML/JSON config maps (agent_id, task_type) → model so teams control
// routing without code changes. Rules hot-reload with no proxy restart via
// Watch (polling mtime — stdlib only; swap for fsnotify when the dep is
// approved). Eval is a lock-guarded linear scan over a small rule set with
// early exit: measured <1ms (see BenchmarkRulesEval).
//
// Config shape (JSON, or YAML subset: `rules:` list of `key: value` maps):
//
//	{"rules": [
//	  {"id":"support-faq", "agent_id":"support_bot", "task_type":"faq",
//	   "model":"gemini-2.0-flash", "tier":"simple", "priority":10}
//	]}
//
// Empty agent_id/task_type act as wildcards. Higher priority wins; ties
// break by specificity (both fields set beats one, beats none), then by
// config order (stable).
package router

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Rule is one routing override.
type Rule struct {
	ID       string `json:"id" yaml:"id"`
	AgentID  string `json:"agent_id" yaml:"agent_id"`
	TaskType string `json:"task_type" yaml:"task_type"`
	Model    string `json:"model" yaml:"model"`
	Tier     string `json:"tier" yaml:"tier"`
	Priority int    `json:"priority" yaml:"priority"`
}

// Matches reports whether the rule fires for (agent, task). Empty fields
// are wildcards; matching is case-insensitive on task_type.
func (r Rule) Matches(agentID, taskType string) bool {
	if r.AgentID != "" && r.AgentID != agentID {
		return false
	}
	if r.TaskType != "" && !strings.EqualFold(r.TaskType, taskType) {
		return false
	}
	return true
}

// specificity counts set match fields (higher = more specific).
func (r Rule) specificity() int {
	n := 0
	if r.AgentID != "" {
		n++
	}
	if r.TaskType != "" {
		n++
	}
	return n
}

// rulesFile is the on-disk shape.
type rulesFile struct {
	Rules []Rule `json:"rules"`
}

// Engine holds the compiled rule set. Use Load/LoadBytes to replace the
// set atomically; Eval never blocks writers beyond an RLock.
type Engine struct {
	mu    sync.RWMutex
	rules []Rule
	path  string
}

// NewEngine returns an empty engine (no overrides; Decide falls to classify).
func NewEngine() *Engine { return &Engine{} }

// LoadBytes parses JSON (or the YAML subset) and swaps the rule set.
func (e *Engine) LoadBytes(data []byte) error {
	rules, err := parseRules(data)
	if err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.rules = rules
	return nil
}

// LoadFile reads path (JSON, or .yaml/.yml subset) and swaps the rule set.
func (e *Engine) LoadFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("router: read rules %s: %w", path, err)
	}
	if err := e.LoadBytes(data); err != nil {
		return fmt.Errorf("router: parse rules %s: %w", path, err)
	}
	e.mu.Lock()
	e.path = path
	e.mu.Unlock()
	return nil
}

// Eval returns the winning rule for (agent, task). The complexity argument
// is reserved for future complexity-scoped rules; today it is ignored but
// kept in the signature so call sites don't churn. Eval is <1ms by design.
func (e *Engine) Eval(agentID, taskType string, _ Complexity) (Rule, bool) {
	if e == nil {
		return Rule{}, false
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	best := -1
	for i, r := range e.rules {
		if !r.Matches(agentID, taskType) {
			continue
		}
		if best == -1 || ruleWins(r, e.rules[best]) {
			best = i
		}
	}
	if best == -1 {
		return Rule{}, false
	}
	return e.rules[best], true
}

// Len returns the loaded rule count (tests, /metrics export).
func (e *Engine) Len() int {
	if e == nil {
		return 0
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	return len(e.rules)
}

// Path returns the file backing the engine ("" when loaded from bytes).
func (e *Engine) Path() string {
	if e == nil {
		return ""
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.path
}

// ruleWins reports whether a outranks b (priority, then specificity).
// Config order breaks remaining ties: callers only replace best on strict
// win, so the earliest rule wins full ties (stable).
func ruleWins(a, b Rule) bool {
	if a.Priority != b.Priority {
		return a.Priority > b.Priority
	}
	return a.specificity() > b.specificity()
}

// parseRules accepts JSON or the constrained YAML subset (same model shape).
func parseRules(data []byte) ([]Rule, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("router: empty rules config")
	}
	if trimmed[0] == '{' || trimmed[0] == '[' {
		var f rulesFile
		if err := json.Unmarshal(data, &f); err != nil {
			return nil, fmt.Errorf("router: parse rules JSON: %w", err)
		}
		return normalizeRules(f.Rules), nil
	}
	rules, err := parseRulesYAMLSubset(data)
	if err != nil {
		return nil, err
	}
	return normalizeRules(rules), nil
}

// normalizeRules drops empty-model rules and stable-sorts by priority desc
// so Eval's first-strict-win scan is deterministic.
func normalizeRules(rules []Rule) []Rule {
	kept := rules[:0]
	for _, r := range rules {
		if strings.TrimSpace(r.Model) == "" {
			continue
		}
		kept = append(kept, r)
	}
	sort.SliceStable(kept, func(i, j int) bool {
		if kept[i].Priority != kept[j].Priority {
			return kept[i].Priority > kept[j].Priority
		}
		return kept[i].specificity() > kept[j].specificity()
	})
	return kept
}

// parseRulesYAMLSubset parses the constrained YAML this engine supports:
//
//	rules:
//	  - id: support-faq
//	    agent_id: support_bot
//	    task_type: faq
//	    model: gemini-2.0-flash
//	    tier: simple
//	    priority: 10
//
// Supported: a top-level `rules:` key, `- ` list items, flat `key: value`
// scalars (strings, ints, quoted strings), `#` comments. Anything richer
// (anchors, nesting, multi-line) is rejected with an error — use JSON.
func parseRulesYAMLSubset(data []byte) ([]Rule, error) {
	var rules []Rule
	var cur *Rule
	inRules := false
	for ln, line := range strings.Split(string(data), "\n") {
		// Strip comments (naive: cut at first '#'; quoted '#' unsupported —
		// documented subset limit, use JSON for exotic values).
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || trimmed == "---" || trimmed == "..." {
			continue
		}
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			if strings.HasPrefix(trimmed, "rules:") {
				inRules = true
				continue
			}
			return nil, fmt.Errorf("router: yaml line %d: only top-level `rules:` supported, got %q", ln+1, trimmed)
		}
		if !inRules {
			return nil, fmt.Errorf("router: yaml line %d: content before `rules:`", ln+1)
		}
		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		body := strings.TrimSpace(line)
		if strings.HasPrefix(body, "- ") || body == "-" {
			rules = append(rules, Rule{})
			cur = &rules[len(rules)-1]
			body = strings.TrimSpace(strings.TrimPrefix(body, "-"))
			if body == "" {
				continue
			}
		}
		if cur == nil {
			return nil, fmt.Errorf("router: yaml line %d: mapping outside list item", ln+1)
		}
		if indent < 2 && !strings.HasPrefix(strings.TrimSpace(line), "-") {
			return nil, fmt.Errorf("router: yaml line %d: unexpected indentation (use 2 spaces)", ln+1)
		}
		key, val, ok := splitKV(body)
		if !ok {
			return nil, fmt.Errorf("router: yaml line %d: want `key: value`, got %q", ln+1, body)
		}
		val = unquote(val)
		switch key {
		case "id":
			cur.ID = val
		case "agent_id":
			cur.AgentID = val
		case "task_type":
			cur.TaskType = val
		case "model":
			cur.Model = val
		case "tier":
			cur.Tier = val
		case "priority":
			n, err := strconv.Atoi(strings.TrimSpace(val))
			if err != nil {
				return nil, fmt.Errorf("router: yaml line %d: bad priority %q", ln+1, val)
			}
			cur.Priority = n
		default:
			return nil, fmt.Errorf("router: yaml line %d: unknown key %q", ln+1, key)
		}
	}
	if !inRules {
		return nil, fmt.Errorf("router: yaml: missing top-level `rules:` key")
	}
	return rules, nil
}

func splitKV(s string) (key, val string, ok bool) {
	i := strings.Index(s, ":")
	if i < 0 {
		return "", "", false
	}
	key = strings.TrimSpace(s[:i])
	val = strings.TrimSpace(s[i+1:])
	if key == "" {
		return "", "", false
	}
	return key, val, true
}

func unquote(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// Watch hot-reloads path every interval with no restart: on mtime change the
// file is re-parsed and swapped atomically; parse errors are reported via
// onErr and the last-good set keeps serving. Returns stop(); the goroutine
// uses only stdlib polling (fsnotify upgrade path documented in spec status).
// A nil engine or empty path returns a no-op stop.
func (e *Engine) Watch(path string, interval time.Duration, onErr func(error)) (stop func()) {
	if e == nil || strings.TrimSpace(path) == "" {
		return func() {}
	}
	if interval <= 0 {
		interval = 5 * time.Second
	}
	done := make(chan struct{})
	var once sync.Once
	stopFn := func() {
		once.Do(func() { close(done) })
	}
	var last time.Time
	if fi, err := os.Stat(path); err == nil {
		last = fi.ModTime()
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				fi, err := os.Stat(path)
				if err != nil {
					if onErr != nil {
						onErr(fmt.Errorf("router: watch stat %s: %w", path, err))
					}
					continue
				}
				if !fi.ModTime().After(last) {
					continue
				}
				last = fi.ModTime()
				if err := e.LoadFile(path); err != nil && onErr != nil {
					onErr(err)
				}
			}
		}
	}()
	return stopFn
}
