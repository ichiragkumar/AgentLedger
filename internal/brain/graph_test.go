package brain

import (
	"testing"

	"github.com/agentledger/agentledger/pkg/models"
)

// sevenAgentPipeline is the spec-08 user story: planner → researcher →
// writer → reviewer → formatter → qa → publisher (linear chain).
func sevenAgentSpans(chain string) []Span {
	agents := []string{"planner", "researcher", "writer", "reviewer", "formatter", "qa", "publisher"}
	var spans []Span
	parent := ""
	for _, a := range agents {
		spans = append(spans, Span{ChainID: chain, AgentID: a, ParentAgentID: parent, CostUSD: 0.01, StatusCode: 200, Success: true})
		parent = a
	}
	return spans
}

func TestSpanFromLog(t *testing.T) {
	l := models.RequestLog{ChainID: "c1", AgentID: "planner", ParentAgentID: "", Model: "gpt-4o", CostUSD: 0.02, StatusCode: 200}
	s := SpanFromLog(l)
	if s.ChainID != "c1" || s.AgentID != "planner" || !s.Success {
		t.Fatalf("bad span: %+v", s)
	}
	l.StatusCode = 500
	if SpanFromLog(l).Success {
		t.Fatal("500 must be failure")
	}
	l.StatusCode = 429
	if SpanFromLog(l).Success {
		t.Fatal("429 must be failure")
	}
}

func TestBuildGraphLinear(t *testing.T) {
	g := BuildGraph("c1", sevenAgentSpans("c1"))
	if len(g.Nodes) != 7 {
		t.Fatalf("want 7 nodes, got %d", len(g.Nodes))
	}
	if len(g.Edges) != 6 {
		t.Fatalf("want 6 edges, got %d: %v", len(g.Edges), g.Edges)
	}
	if len(g.Roots) != 1 || g.Roots[0] != "planner" {
		t.Fatalf("want root [planner], got %v", g.Roots)
	}
	if len(g.Orphans) != 0 {
		t.Fatalf("want no orphans, got %v", g.Orphans)
	}
	adj := g.Adjacency()
	if len(adj["planner"]) != 1 || adj["planner"][0] != "researcher" {
		t.Fatalf("bad adjacency: %v", adj)
	}
	if len(adj["publisher"]) != 0 {
		t.Fatalf("publisher must be leaf: %v", adj)
	}
}

func TestBuildGraphOutOfOrder(t *testing.T) {
	// Child arrives before parent — edge must still link.
	spans := []Span{
		{ChainID: "c", AgentID: "writer", ParentAgentID: "researcher", Success: true},
		{ChainID: "c", AgentID: "researcher", ParentAgentID: "planner", Success: true},
		{ChainID: "c", AgentID: "planner", Success: true},
	}
	g := BuildGraph("c", spans)
	if len(g.Edges) != 2 {
		t.Fatalf("out-of-order must still link 2 edges, got %v orphans=%v", g.Edges, g.Orphans)
	}
	if len(g.Orphans) != 0 {
		t.Fatalf("no orphans expected, got %v", g.Orphans)
	}
}

func TestBuildGraphDiamond(t *testing.T) {
	// planner → {researcher, analyst} → writer (branch + merge).
	spans := []Span{
		{ChainID: "c", AgentID: "planner", Success: true},
		{ChainID: "c", AgentID: "researcher", ParentAgentID: "planner", Success: true},
		{ChainID: "c", AgentID: "analyst", ParentAgentID: "planner", Success: true},
		{ChainID: "c", AgentID: "writer", ParentAgentID: "researcher", Success: true},
		{ChainID: "c", AgentID: "writer", ParentAgentID: "analyst", Success: true},
	}
	g := BuildGraph("c", spans)
	if len(g.Edges) != 4 {
		t.Fatalf("diamond needs 4 edges, got %v", g.Edges)
	}
	w := g.Nodes["writer"]
	if len(w.Parents) != 2 {
		t.Fatalf("writer needs 2 parents, got %v", w.Parents)
	}
	desc := g.Descendants("planner")
	if len(desc) != 3 {
		t.Fatalf("planner descendants = 3, got %v", desc)
	}
}

func TestBuildGraphOrphanAndDropped(t *testing.T) {
	spans := []Span{
		{ChainID: "c", AgentID: "ghost-child", ParentAgentID: "never-seen", Success: true},
		{ChainID: "", AgentID: "no-chain", Success: true},        // dropped: no chain
		{ChainID: "c", AgentID: "", Success: true},               // dropped: no agent
		{ChainID: "c", AgentID: "loopy", ParentAgentID: "loopy"}, // self-loop → root
		{ChainID: "c", AgentID: "ok", ParentAgentID: "", Success: false},
	}
	g := BuildGraph("c", spans)
	if g.Dropped != 2 {
		t.Fatalf("want 2 dropped, got %d", g.Dropped)
	}
	if len(g.Orphans) != 1 || g.Orphans[0] != "ghost-child" {
		t.Fatalf("want orphan [ghost-child], got %v", g.Orphans)
	}
	if len(g.Edges) != 0 {
		t.Fatalf("orphan edge must NOT be invented: %v", g.Edges)
	}
	found := false
	for _, r := range g.Roots {
		if r == "loopy" {
			found = true
		}
	}
	if !found {
		t.Fatalf("self-loop must be root, roots=%v", g.Roots)
	}
	if g.Nodes["ok"].Failures != 1 {
		t.Fatal("failures must be counted")
	}
}

func TestBuildGraphDedupe(t *testing.T) {
	spans := sevenAgentSpans("c1")
	spans = append(spans, sevenAgentSpans("c1")...) // 10 retries of every step
	g := BuildGraph("c1", spans)
	if len(g.Edges) != 6 {
		t.Fatalf("retries must not duplicate edges: %v", g.Edges)
	}
	if g.Nodes["writer"].Calls != 2 {
		t.Fatalf("writer calls should be 2, got %d", g.Nodes["writer"].Calls)
	}
}

func TestTopoOrderAndDepths(t *testing.T) {
	g := BuildGraph("c1", sevenAgentSpans("c1"))
	order, ok := g.TopoOrder()
	if !ok {
		t.Fatal("linear chain must be acyclic")
	}
	if len(order) != 7 || order[0] != "planner" || order[6] != "publisher" {
		t.Fatalf("bad topo order: %v", order)
	}
	d := g.Depths()
	if d["planner"] != 0 || d["publisher"] != 6 || d["writer"] != 2 {
		t.Fatalf("bad depths: %v", d)
	}
}

func TestTopoOrderCycle(t *testing.T) {
	g := BuildGraph("c", []Span{
		{ChainID: "c", AgentID: "a", ParentAgentID: "b", Success: true},
		{ChainID: "c", AgentID: "b", ParentAgentID: "a", Success: true},
	})
	_, ok := g.TopoOrder()
	if ok {
		t.Fatal("2-cycle must report ok=false")
	}
}

func TestHeaderCoverage(t *testing.T) {
	if HeaderCoverage(nil) != 0 {
		t.Fatal("empty spans → 0")
	}
	spans := []Span{
		{ChainID: "c", AgentID: "a"},
		{ChainID: "", AgentID: "b"},
		{ChainID: "c", AgentID: ""},
		{ChainID: "c", AgentID: "d"},
	}
	if got := HeaderCoverage(spans); got != 0.5 {
		t.Fatalf("want 0.5, got %v", got)
	}
	full := sevenAgentSpans("c")
	if got := HeaderCoverage(full); got != 1.0 {
		t.Fatalf("full headers → 1.0, got %v", got)
	}
}

func TestBuilder(t *testing.T) {
	b := NewBuilder()
	for _, s := range sevenAgentSpans("chain-9") {
		b.Observe(s)
	}
	b.Observe(Span{}) // missing headers: must not crash
	g, ok := b.Graph("chain-9")
	if !ok {
		t.Fatal("chain-9 must exist")
	}
	if len(g.Edges) != 6 {
		t.Fatalf("want 6 edges, got %d", len(g.Edges))
	}
	chains := b.Chains()
	if len(chains) != 1 || chains[0] != "chain-9" {
		t.Fatalf("bad chains: %v", chains)
	}
	if _, ok := b.Graph("missing"); ok {
		t.Fatal("unknown chain must be absent")
	}
	// Incremental observe: late parent links the earlier orphan.
	b2 := NewBuilder()
	b2.Observe(Span{ChainID: "x", AgentID: "child", ParentAgentID: "mom", Success: true})
	if g2, _ := b2.Graph("x"); len(g2.Edges) != 0 {
		t.Fatal("orphan edge must wait for parent")
	}
	b2.Observe(Span{ChainID: "x", AgentID: "mom", Success: true})
	if g2, _ := b2.Graph("x"); len(g2.Edges) != 1 {
		t.Fatalf("late parent must link, edges=%v orphans=%v", g2.Edges, g2.Orphans)
	}
}
