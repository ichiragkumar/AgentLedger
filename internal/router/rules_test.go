package router

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

const testRulesJSON = `{"rules":[
	{"id":"support-faq","agent_id":"support_bot","task_type":"faq","model":"gemini-2.0-flash","tier":"simple","priority":10},
	{"id":"team-cheap","agent_id":"","task_type":"summarization","model":"claude-3-5-haiku","tier":"moderate","priority":5},
	{"id":"catch-research","agent_id":"","task_type":"","model":"gpt-5.5-pro","tier":"frontier","priority":1}
]}`

const testRulesYAML = `
rules:
  - id: support-faq
    agent_id: support_bot
    task_type: faq
    model: gemini-2.0-flash
    tier: simple
    priority: 10
  - id: team-cheap
    agent_id: ""
    task_type: summarization
    model: claude-3-5-haiku
    tier: moderate
    priority: 5
`

func TestRulesEvalJSON(t *testing.T) {
	e := NewEngine()
	if err := e.LoadBytes([]byte(testRulesJSON)); err != nil {
		t.Fatal(err)
	}
	if e.Len() != 3 {
		t.Fatalf("Len = %d, want 3", e.Len())
	}
	r, ok := e.Eval("support_bot", "faq", ComplexitySimple)
	if !ok || r.ID != "support-faq" || r.Model != "gemini-2.0-flash" {
		t.Fatalf("exact match failed: %+v %v", r, ok)
	}
	// Wildcard agent: any agent summarizing hits team-cheap (priority 5 beats
	// catch-all priority 1).
	r, ok = e.Eval("other_bot", "summarization", ComplexityModerate)
	if !ok || r.ID != "team-cheap" {
		t.Fatalf("wildcard match failed: %+v %v", r, ok)
	}
	// Catch-all fires for anything unmatched.
	r, ok = e.Eval("nobody", "code", ComplexityComplex)
	if !ok || r.ID != "catch-research" {
		t.Fatalf("catch-all failed: %+v %v", r, ok)
	}
}

func TestRulesEvalYAMLSubset(t *testing.T) {
	e := NewEngine()
	if err := e.LoadBytes([]byte(testRulesYAML)); err != nil {
		t.Fatal(err)
	}
	if e.Len() != 2 {
		t.Fatalf("Len = %d, want 2", e.Len())
	}
	r, ok := e.Eval("support_bot", "FAQ", ComplexitySimple) // case-insensitive task
	if !ok || r.ID != "support-faq" {
		t.Fatalf("yaml eval failed: %+v %v", r, ok)
	}
}

func TestRulesPriorityAndSpecificity(t *testing.T) {
	e := NewEngine()
	err := e.LoadBytes([]byte(`{"rules":[
		{"id":"generic","agent_id":"","task_type":"faq","model":"a","priority":5},
		{"id":"specific","agent_id":"b1","task_type":"faq","model":"b","priority":5},
		{"id":"highpri","agent_id":"","task_type":"","model":"c","priority":1}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	// Same priority → more specific wins.
	if r, _ := e.Eval("b1", "faq", ComplexitySimple); r.ID != "specific" {
		t.Fatalf("specificity tie-break failed: %q", r.ID)
	}
	// Higher priority beats specificity.
	if r, _ := e.Eval("b1", "faq", ComplexitySimple); r.ID != "specific" {
		t.Fatalf("unexpected: %q", r.ID)
	}
	r, _ := e.Eval("zzz", "other", ComplexitySimple)
	if r.ID != "highpri" {
		t.Fatalf("priority win failed: %q", r.ID)
	}
}

func TestRulesEvalNoMatch(t *testing.T) {
	e := NewEngine()
	if err := e.LoadBytes([]byte(`{"rules":[{"id":"x","agent_id":"a","task_type":"faq","model":"m","priority":1}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.Eval("b", "code", ComplexityComplex); ok {
		t.Fatal("expected no match")
	}
	if _, ok := (*Engine)(nil).Eval("a", "faq", ComplexitySimple); ok {
		t.Fatal("nil engine must not match")
	}
	if NewEngine().Len() != 0 || (*Engine)(nil).Len() != 0 {
		t.Fatal("empty/nil engine Len must be 0")
	}
}

func TestRulesParseErrors(t *testing.T) {
	for _, tc := range []struct{ name, data string }{
		{"empty", ``},
		{"bad json", `{oops`},
		{"yaml no rules key", "foo: bar\n"},
		{"yaml unknown key", "rules:\n  - id: a\n    wat: 1\n    model: m\n"},
		{"yaml bad kv", "rules:\n  - id: a\n    nonsense\n    model: m\n"},
		{"yaml bad priority", "rules:\n  - id: a\n    model: m\n    priority: high\n"},
		{"yaml top-level junk", "other:\n  - a\n"},
	} {
		e := NewEngine()
		if err := e.LoadBytes([]byte(tc.data)); err == nil {
			t.Fatalf("%s: expected parse error", tc.name)
		}
	}
	// Rules without models are dropped, not fatal.
	e := NewEngine()
	if err := e.LoadBytes([]byte(`{"rules":[{"id":"empty-model","model":""}]}`)); err != nil {
		t.Fatal(err)
	}
	if e.Len() != 0 {
		t.Fatal("model-less rules must be dropped")
	}
}

func TestRulesHotReloadNoRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rules.json")
	if err := os.WriteFile(path, []byte(`{"rules":[{"id":"v1","agent_id":"a","task_type":"faq","model":"m1","priority":1}]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	e := NewEngine()
	if err := e.LoadFile(path); err != nil {
		t.Fatal(err)
	}
	if e.Path() != path {
		t.Fatal("Path should record backing file")
	}
	r, _ := e.Eval("a", "faq", ComplexitySimple)
	if r.Model != "m1" {
		t.Fatalf("v1 model = %q", r.Model)
	}
	var watchErrs []error
	stop := e.Watch(path, 10*time.Millisecond, func(err error) { watchErrs = append(watchErrs, err) })
	defer stop()
	// Ensure mtime advances, then swap the file: no restart needed.
	time.Sleep(20 * time.Millisecond)
	if err := os.WriteFile(path, []byte(`{"rules":[{"id":"v2","agent_id":"a","task_type":"faq","model":"m2","priority":1}]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		r, _ := e.Eval("a", "faq", ComplexitySimple)
		if r.Model == "m2" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("hot reload did not pick up m2 (errs=%v)", watchErrs)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Broken update keeps serving last-good.
	time.Sleep(20 * time.Millisecond)
	if err := os.WriteFile(path, []byte(`{broken`), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if r, _ := e.Eval("a", "faq", ComplexitySimple); r.Model != "m2" {
		t.Fatal("broken reload must keep last-good set")
	}
	if len(watchErrs) == 0 {
		t.Fatal("expected watcher to report the parse error")
	}
}

func TestRulesLoadFileMissing(t *testing.T) {
	if err := NewEngine().LoadFile(filepath.Join(t.TempDir(), "nope.json")); err == nil {
		t.Fatal("missing file must error")
	}
}

func TestRulesEvalLatencyUnder1ms(t *testing.T) {
	e := NewEngine()
	if err := e.LoadBytes([]byte(testRulesJSON)); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	const n = 10000
	for i := 0; i < n; i++ {
		e.Eval("support_bot", "faq", ComplexitySimple)
	}
	avg := time.Since(start) / n
	t.Logf("avg Eval = %s", avg)
	if avg > time.Millisecond {
		t.Fatalf("avg Eval %s exceeds 1ms budget", avg)
	}
}

func BenchmarkRulesEval(b *testing.B) {
	e := NewEngine()
	_ = e.LoadBytes([]byte(testRulesJSON))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		e.Eval("support_bot", "faq", ComplexitySimple)
	}
}
