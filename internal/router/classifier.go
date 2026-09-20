// Package router implements Phase 3 intelligent model routing (spec 06).
//
// Pipeline position (spec 02 request flow): enforce → cache → ROUTE → upstream.
// The router runs ONLY after a cache MISS (or an explicit bypass), so cached
// traffic never pays classification cost. It plugs into Mirror's RouteStub
// middleware (internal/proxy/middleware.go) — see WIRING below — and reuses
// Mirror's attribution headers (X-Agent-Id/Team/Project/Chain/Parent).
//
// Sub-ms budget: the hot path (Classify + rules Eval + tier Select) is Go
// stdlib only, no network, no model calls. Anything that needs I/O (live
// price refresh, LLM-as-judge, batch webhook delivery) lives off the hot
// path behind interfaces with in-process stubs.
//
// WIRING (for the integrator — no proxy files are touched by this package):
//
//	routeMiddleware := func(next http.Handler) http.Handler {
//	    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
//	        if r.Header.Get("X-AgentLedger-Cache") == "HIT" { // respect cache layer
//	            next.ServeHTTP(w, r); return
//	        }
//	        in := router.InputFromRequest(prompt, taskType, r.Header)
//	        d := router.Decide(in, engine, tiers, strategy) // rules → classify → tier
//	        rewriteModelInBody(body, d.Model)               // cheapest model that qualifies
//	        w.Header().Set("X-AgentLedger-Route", d.Model)
//	        w.Header().Set("X-AgentLedger-Tier", string(d.Tier))
//	        w.Header().Set("X-AgentLedger-Complexity", d.Complexity.String())
//	        next.ServeHTTP(w, r)
//	    })
//	}
package router

import (
	"errors"
	"net/http"
	"strings"
)

// Input is the routing decision input. Prompt is the concatenated user
// content; TaskType is an optional caller hint ("faq", "summarization",
// "code", "reasoning", "research", ...); AgentID/TeamID/ProjectID are reused
// verbatim from Mirror's attribution headers (no SDK, no new headers).
type Input struct {
	Prompt    string
	TaskType  string
	AgentID   string
	TeamID    string
	ProjectID string
	// BatchEligible marks non-urgent work for the batch queue (50% discount).
	BatchEligible bool
}

// InputFromRequest builds an Input from an already-extracted prompt plus an
// optional task_type hint and the request headers. Unknown body shapes
// degrade to Prompt="" (→ moderate default) rather than failing requests.
func InputFromRequest(prompt, taskType string, h http.Header) Input {
	return Input{
		Prompt:        prompt,
		TaskType:      taskType,
		AgentID:       h.Get("X-Agent-Id"),
		TeamID:        h.Get("X-Team-Id"),
		ProjectID:     h.Get("X-Project-Id"),
		BatchEligible: IsBatchEligible(h, taskType),
	}
}

// ErrMLNotConfigured is returned by the ML v2 stub until an endpoint is set.
var ErrMLNotConfigured = errors.New("router: ML classifier endpoint not configured (set ROUTER_ML_ENDPOINT for v2)")

// Classifier is the v2 seam: rules-based v1 ships now, an ML model plugs in
// later without touching the pipeline. Classify returns the complexity plus
// a 0..1 confidence.
type Classifier interface {
	Classify(in Input) (Complexity, float64)
}

// RulesClassifier is the shippable v1. It delegates to ClassifyPrompt.
type RulesClassifier struct{}

// Classify implements Classifier.
func (RulesClassifier) Classify(in Input) (Complexity, float64) {
	return ClassifyPrompt(in.Prompt, in.TaskType)
}

// MLClassifierStub is the v2 placeholder. With an empty Endpoint, Classify
// returns (Moderate, 0) and callers can check ErrMLNotConfigured via
// Configured(); once an endpoint is set it delegates to Fallback (default:
// rules v1) so callers never break before the trained model lands.
type MLClassifierStub struct {
	// Endpoint is the future v2 model server URL (ROUTER_ML_ENDPOINT).
	Endpoint string
	// Fallback is used while the endpoint is set but the model is untrained.
	Fallback Classifier
}

// Configured reports whether the v2 endpoint is set.
func (m MLClassifierStub) Configured() bool { return strings.TrimSpace(m.Endpoint) != "" }

// Classify implements Classifier.
func (m MLClassifierStub) Classify(in Input) (Complexity, float64) {
	if !m.Configured() {
		return ComplexityModerate, 0
	}
	fb := m.Fallback
	if fb == nil {
		fb = RulesClassifier{}
	}
	return fb.Classify(in)
}

// Complexity is the task bucket. Ordered so strategies can shift up/down.
type Complexity int

const (
	ComplexitySimple Complexity = iota
	ComplexityModerate
	ComplexityComplex
	ComplexityFrontier
)

// String renders the bucket name used in headers and analytics.
func (c Complexity) String() string {
	switch c {
	case ComplexitySimple:
		return "simple"
	case ComplexityModerate:
		return "moderate"
	case ComplexityComplex:
		return "complex"
	case ComplexityFrontier:
		return "frontier"
	default:
		return "moderate"
	}
}

// ParseComplexity maps a string to a bucket; unknown → moderate + false.
func ParseComplexity(s string) (Complexity, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "simple":
		return ComplexitySimple, true
	case "moderate":
		return ComplexityModerate, true
	case "complex":
		return ComplexityComplex, true
	case "frontier":
		return ComplexityFrontier, true
	default:
		return ComplexityModerate, false
	}
}

// Word-count thresholds (v1 token proxy: EstimateTokens ≈ words × 1.33).
// Tuned so prompt length alone lands in the right band; keyword and
// task-type signals only nudge within ±1 band.
const (
	wordsSimpleMax   = 50   // ≤50 words: short Q&A, extraction, formatting
	wordsModerateMax = 200  // ≤200 words: summaries, explanations, drafts
	wordsComplexMax  = 600  // ≤600 words: code, analysis, multi-step plans
	wordsFrontierMin = 1200 // ≥1200 words: long-context frontier work, floor complex
)

var (
	frontierKeywords = []string{
		"prove", "theorem", "formal proof", "formal verification",
		"np-hard", "frontier", "novel architecture", "novel algorithm",
		"multi-agent consensus", "distributed consensus", "research-grade",
		"cryptographic proof", "correctness proof", "impossibility",
	}
	complexKeywords = []string{
		"implement", "refactor", "debug", "algorithm", "tradeoff", "trade-off",
		"architecture", "optimize", "root cause", "step-by-step", "step by step",
		"analyze", "evaluate", "design", "migrate", "race condition",
		"derive", "counterexample",
	}
	moderateKeywords = []string{
		"summarize", "summary", "explain", "draft", "translate", "compare",
		"outline", "paraphrase", "write a", "pros and cons", "elaborate",
	}
	simpleKeywords = []string{
		"yes or no", "true or false", "classify", "sentiment", "spam",
		"extract the", "format as", "uppercase", "lowercase", "faq",
		"what is the date", "spellcheck", "translate this word",
	}
	multiStepMarkers = []string{
		"step 1", "step 2", "first,", "then,", "finally,",
		"1.", "2.", "3.",
	}
)

// EstimateTokens approximates token count without a tokenizer
// (≈ words × 4/3). Hot path safe: single pass, no allocation beyond fields.
func EstimateTokens(text string) int {
	words := countWords(text)
	return words + words/3 // words × 1.33
}

func countWords(text string) int {
	n := 0
	inWord := false
	for _, r := range text {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			inWord = false
			continue
		}
		if !inWord {
			inWord = true
			n++
		}
	}
	return n
}

func countHits(lower string, kws []string) int {
	n := 0
	for _, k := range kws {
		if strings.Contains(lower, k) {
			n++
		}
	}
	return n
}

// taskBias nudges the score from an explicit caller task_type hint.
func taskBias(taskType string) float64 {
	switch strings.ToLower(strings.TrimSpace(taskType)) {
	case "faq", "classification", "extraction", "formatting", "moderation", "simple":
		return -0.5
	case "summarization", "explanation", "translation", "drafting", "moderate":
		return 0
	case "code", "reasoning", "analysis", "planning", "complex":
		return 0.2
	case "research", "frontier", "theorem", "proof":
		return 0.5
	default:
		return 0
	}
}

// isHardTaskType reports whether the caller explicitly flagged frontier-grade
// work. Used only for the short-prompt floor in ClassifyPrompt.
func isHardTaskType(taskType string) bool {
	switch strings.ToLower(strings.TrimSpace(taskType)) {
	case "research", "frontier", "theorem", "proof":
		return true
	default:
		return false
	}
}

// ClassifyPrompt is the rules-based v1 classifier. It returns the complexity
// bucket plus a 0..1 confidence derived from score margin. Rules:
//
//  1. Length band sets the base (word/token thresholds above).
//  2. task_type hint nudges ±0.5 band at most.
//  3. Keyword hits nudge within a ±0.5 cap (frontier hits weigh more).
//  4. Code fences and multi-step markers nudge up; simple-phrase hits nudge down.
//  5. Hard overrides: ≥2 frontier keywords + long prompt → frontier;
//     very long prompts (≥1200 words) floor at complex.
//
// Empty prompts default to moderate (safe middle, never the most expensive).
func ClassifyPrompt(prompt, taskType string) (Complexity, float64) {
	words := countWords(prompt)
	if words == 0 {
		return ComplexityModerate, 0.5 // empty: safe middle, never most expensive
	}
	lower := strings.ToLower(prompt)

	var base float64
	switch {
	case words <= wordsSimpleMax:
		base = 0
	case words <= wordsModerateMax:
		base = 1
	case words <= wordsComplexMax:
		base = 2
	default:
		base = 3
	}

	frontierHits := countHits(lower, frontierKeywords)
	complexHits := countHits(lower, complexKeywords)
	moderateHits := countHits(lower, moderateKeywords)
	simpleHits := countHits(lower, simpleKeywords)

	// Frontier hits weigh more and cap higher: a single strong signal
	// ("prove", "formal verification") moves the needle half a band.
	kwFrontier := float64(frontierHits) * 0.5
	if kwFrontier > 1.0 {
		kwFrontier = 1.0
	}
	kwOther := float64(complexHits)*0.2 + float64(moderateHits)*0.1 -
		float64(simpleHits)*0.25
	if kwOther > 0.4 {
		kwOther = 0.4
	}
	if kwOther < -0.5 {
		kwOther = -0.5
	}
	kw := kwFrontier + kwOther

	structural := 0.0
	if strings.Contains(prompt, "```") {
		structural += 0.15
	}
	if countHits(lower, multiStepMarkers) >= 2 {
		structural += 0.15
	}

	score := base + taskBias(taskType) + kw + structural

	level := ComplexitySimple
	switch {
	case score < 0.75:
		level = ComplexitySimple
	case score < 1.75:
		level = ComplexityModerate
	case score < 3.0:
		level = ComplexityComplex
	default:
		level = ComplexityFrontier
	}

	// Hard overrides for unambiguous signals.
	if frontierHits >= 2 && words > 300 {
		level = ComplexityFrontier
	}
	// Explicit hard-task hint + frontier signal floors at complex: callers
	// passing task_type proof/theorem/research/frontier route correctly
	// even on short prompts (length bias is a documented v1 limit otherwise).
	if isHardTaskType(taskType) && frontierHits >= 1 && level < ComplexityComplex {
		level = ComplexityComplex
	}
	if words >= wordsFrontierMin && level < ComplexityComplex {
		level = ComplexityComplex
	}
	if words >= wordsFrontierMin && frontierHits >= 1 {
		level = ComplexityFrontier
	}

	// Confidence = normalized distance from the nearest band edge.
	conf := confidence(score, level)
	return level, conf
}

// Classify is shorthand for ClassifyPrompt (hot-path call sites).
func Classify(prompt, taskType string) (Complexity, float64) {
	return ClassifyPrompt(prompt, taskType)
}

func confidence(score float64, level Complexity) float64 {
	edges := []float64{0.75, 1.75, 3.0}
	var dist float64
	switch level {
	case ComplexitySimple:
		dist = edges[0] - score
	case ComplexityModerate:
		dist = minDist(score, edges[0], edges[1])
	case ComplexityComplex:
		dist = minDist(score, edges[1], edges[2])
	default:
		dist = score - edges[2]
	}
	if dist < 0 {
		dist = 0
	}
	c := 0.55 + dist*0.45
	if c > 0.99 {
		c = 0.99
	}
	return c
}

func minDist(score float64, edges ...float64) float64 {
	best := 1.0
	for _, e := range edges {
		d := score - e
		if d < 0 {
			d = -d
		}
		if d < best {
			best = d
		}
	}
	return best
}
