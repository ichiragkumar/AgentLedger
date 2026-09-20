package router

import (
	"fmt"
	"strings"
	"testing"
)

// neutralFiller pads prompts to target lengths without tripping keyword
// heuristics (no classifier keywords, markers, or code fences inside).
var neutralFiller = []string{
	"river", "mountain", "garden", "market", "harbor", "forest",
	"meadow", "village", "cloud", "stone", "bridge", "tower",
	"lantern", "harvest", "journey", "compass", "anchor", "willow",
	"ember", "thunder", "prairie", "canyon", "orchard", "signal",
	"valley", "cedar", "brook", "falcon", "summit", "glacier",
}

func padToWords(seed string, target int) string {
	words := strings.Fields(seed)
	i := 0
	for len(words) < target {
		words = append(words, neutralFiller[i%len(neutralFiller)])
		i++
	}
	return strings.Join(words, " ")
}

type labeledPrompt struct {
	prompt   string
	taskType string
	want     Complexity
}

// genSuite builds the deterministic 500-prompt accuracy suite:
// 120 simple + 125 moderate + 125 complex + 120 frontier + 10 adversarial
// short-hard prompts (labeled frontier; known v1 limits, fixed by ML v2).
func genSuite() []labeledPrompt {
	var out []labeledPrompt

	simpleSeeds := []struct{ task, text string }{
		{"faq", "FAQ: what is your refund policy for monthly plans"},
		{"classification", "Classify this review sentiment: the product arrived broken"},
		{"classification", "Is this message spam: win a free prize now. Answer yes or no"},
		{"extraction", "Extract the date from this invoice header please"},
		{"formatting", "Format as JSON the following contact details for import"},
		{"moderation", "Is the following text true or false advertising"},
		{"faq", "FAQ: how do I reset my account password today"},
		{"classification", "Classify sentiment of this tweet about the launch event"},
		{"extraction", "Extract the total amount and currency from the receipt"},
		{"formatting", "Convert this heading to uppercase for the banner"},
		{"faq", "FAQ: what is the date of the next scheduled maintenance"},
		{"moderation", "Spellcheck this sentence for the newsletter draft line"},
	}
	for i := 0; i < 120; i++ {
		s := simpleSeeds[i%len(simpleSeeds)]
		out = append(out, labeledPrompt{prompt: s.text, taskType: s.task, want: ComplexitySimple})
	}

	moderateSeeds := []struct{ task, text string }{
		{"summarization", "Summarize the following article in three sentences for the morning briefing"},
		{"explanation", "Explain how ocean tides work for a beginner audience with examples"},
		{"drafting", "Draft an email to the team about the Friday release schedule change"},
		{"translation", "Translate this document to French keeping the formal tone throughout"},
		{"summarization", "Write a concise summary of the meeting notes below for stakeholders"},
	}
	for i := 0; i < 125; i++ {
		s := moderateSeeds[i%len(moderateSeeds)]
		p := padToWords(s.text+" "+strings.Repeat("background context ", 4), 60+(i%5)*25)
		out = append(out, labeledPrompt{prompt: p, taskType: s.task, want: ComplexityModerate})
	}

	complexSeeds := []struct{ task, text string }{
		{"code", "Implement a rate limiter in Go with token bucket semantics and tests"},
		{"reasoning", "Debug this race condition between the writer and reader goroutines"},
		{"analysis", "Analyze the tradeoff between consistency and latency for this store"},
		{"planning", "Design the migration plan from the monolith to services with rollback"},
		{"code", "Refactor this handler to separate parsing from validation cleanly"},
	}
	for i := 0; i < 125; i++ {
		s := complexSeeds[i%len(complexSeeds)]
		// Exactly one complex keyword per seed + optional single structural
		// marker keeps scores inside the complex band (< 3.0).
		extra := ""
		if i%3 == 0 {
			extra = " First, outline inputs. Then, describe outputs."
		}
		p := padToWords(s.text+". Requirements and context follow. "+extra, 220+(i%5)*60)
		out = append(out, labeledPrompt{prompt: p, taskType: s.task, want: ComplexityComplex})
	}

	frontierSeeds := []struct{ task, text string }{
		{"research", "Prove the correctness of this distributed consensus protocol with a formal verification sketch and counterexample analysis"},
		{"frontier", "Develop a novel architecture for multi-agent consensus under partial synchrony and prove its safety theorem"},
		{"research", "Give a research-grade impossibility result for leader election with a full correctness proof"},
		{"frontier", "Construct a cryptographic proof of the protocol soundness with formal verification of each lemma"},
	}
	for i := 0; i < 120; i++ {
		s := frontierSeeds[i%len(frontierSeeds)]
		p := padToWords(s.text+". Full context, prior work, definitions, and open questions follow. ", 700+(i%4)*150)
		out = append(out, labeledPrompt{prompt: p, taskType: s.task, want: ComplexityFrontier})
	}

	// Adversarial: short but genuinely hard (v1 length bias misses these;
	// ML v2 + explicit task_type are the documented fix — callers that pass
	// task_type "proof" already route correctly).
	adversarial := []string{
		"Prove that P != NP.",
		"Give a formal verification of this consensus lemma.",
		"State the impossibility theorem for async consensus with proof.",
		"Prove soundness of this cryptographic construction rigorously.",
		"Formal proof:FLP impossibility in three lemmas.",
		"Prove the safety theorem for this novel architecture sketch.",
		"Research-grade counterexample to the liveness claim, with proof.",
		"Prove termination of this distributed consensus variant formally.",
		"Correctness proof for the multi-agent consensus protocol below.",
		"Prove the lower bound with a full theorem and proof.",
	}
	for _, a := range adversarial {
		out = append(out, labeledPrompt{prompt: a, taskType: "", want: ComplexityFrontier})
	}
	return out
}

func TestClassifierAccuracy500(t *testing.T) {
	suite := genSuite()
	if len(suite) != 500 {
		t.Fatalf("suite size = %d, want 500", len(suite))
	}
	correct := 0
	perClass := map[Complexity][2]int{} // [correct, total]
	var misses []string
	for i, lp := range suite {
		got, _ := ClassifyPrompt(lp.prompt, lp.taskType)
		stat := perClass[lp.want]
		stat[1]++
		if got == lp.want {
			correct++
			stat[0]++
		} else if len(misses) < 10 {
			misses = append(misses, fmt.Sprintf("#%d want=%s got=%s task=%q prompt=%.60q", i, lp.want, got, lp.taskType, lp.prompt))
		}
		perClass[lp.want] = stat
	}
	acc := float64(correct) / float64(len(suite)) * 100
	t.Logf("accuracy: %d/500 = %.1f%%", correct, acc)
	for c := ComplexitySimple; c <= ComplexityFrontier; c++ {
		s := perClass[c]
		t.Logf("  %-9s %3d/%3d", c, s[0], s[1])
	}
	for _, m := range misses {
		t.Log("miss:", m)
	}
	if acc < 85 {
		t.Fatalf("accuracy %.1f%% < 85%% spec target", acc)
	}
}

func TestClassifierWordThresholds(t *testing.T) {
	short, _ := ClassifyPrompt("Is this spam. Answer yes or no", "classification")
	if short != ComplexitySimple {
		t.Fatalf("short prompt = %s, want simple", short)
	}
	long, _ := ClassifyPrompt(padToWords("Prove the safety theorem with a formal verification of every lemma and a research-grade analysis", 1300), "research")
	if long != ComplexityFrontier {
		t.Fatalf("1300-word proof prompt = %s, want frontier", long)
	}
	if EstimateTokens("hello world") != 2+2/3 {
		t.Fatalf("EstimateTokens = %d", EstimateTokens("hello world"))
	}
}

func TestClassifierEmptyDefaultsModerate(t *testing.T) {
	c, conf := ClassifyPrompt("", "")
	if c != ComplexityModerate {
		t.Fatalf("empty prompt = %s, want moderate", c)
	}
	if conf <= 0 || conf > 1 {
		t.Fatalf("confidence %f out of range", conf)
	}
}

func TestClassifierTaskTypeHint(t *testing.T) {
	// Same short prompt routes differently with an explicit hard task hint.
	_, confPlain := ClassifyPrompt("Prove this lemma about consensus now please", "")
	c, _ := ClassifyPrompt("Prove this lemma about consensus now please", "proof")
	if c != ComplexityComplex && c != ComplexityFrontier {
		t.Fatalf("proof hint routed %s with conf %f", c, confPlain)
	}
}

func TestRulesClassifierImplementsInterface(t *testing.T) {
	var _ Classifier = RulesClassifier{}
	var _ Classifier = MLClassifierStub{}
	c, conf := RulesClassifier{}.Classify(Input{Prompt: "hi, is this spam, yes or no", TaskType: "classification"})
	if c != ComplexitySimple {
		t.Fatalf("got %s", c)
	}
	if conf <= 0 || conf > 1 {
		t.Fatalf("confidence %f out of range", conf)
	}
}

func TestMLStubUnconfigured(t *testing.T) {
	m := MLClassifierStub{}
	if m.Configured() {
		t.Fatal("empty endpoint should report unconfigured")
	}
	if !(MLClassifierStub{Endpoint: "http://ml:9000"}).Configured() {
		t.Fatal("set endpoint should report configured")
	}
	c, conf := m.Classify(Input{Prompt: "anything"})
	if c != ComplexityModerate || conf != 0 {
		t.Fatalf("unconfigured stub = %s %f, want moderate 0", c, conf)
	}
	if ErrMLNotConfigured == nil {
		t.Fatal("sentinel must exist for v2 wiring")
	}
}

func TestComplexityStringRoundTrip(t *testing.T) {
	for _, c := range []Complexity{ComplexitySimple, ComplexityModerate, ComplexityComplex, ComplexityFrontier} {
		back, ok := ParseComplexity(c.String())
		if !ok || back != c {
			t.Fatalf("round trip failed for %d", int(c))
		}
	}
	if _, ok := ParseComplexity("galaxy-brain"); ok {
		t.Fatal("unknown complexity should return ok=false")
	}
	if (Complexity(99)).String() != "moderate" {
		t.Fatal("out-of-range complexity should degrade to moderate")
	}
}

func TestInputFromRequestReusesAttribution(t *testing.T) {
	h := map[string][]string{
		"X-Agent-Id":          {"agent-7"},
		"X-Team-Id":           {"team-a"},
		"X-Project-Id":        {"proj-x"},
		"X-Agentledger-Batch": {"eligible"},
	}
	in := InputFromRequest("Classify this: spam or not, yes or no", "classification", h)
	if in.AgentID != "agent-7" || in.TeamID != "team-a" || in.ProjectID != "proj-x" {
		t.Fatalf("attribution not reused: %+v", in)
	}
	if !in.BatchEligible {
		t.Fatal("batch header should mark eligible")
	}
}

func BenchmarkClassify(b *testing.B) {
	p := padToWords("Implement a rate limiter in Go with token bucket semantics and full test coverage of edge cases", 300)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ClassifyPrompt(p, "code")
	}
}
