// Package brain is Phase 5 "The Brain" — workflow-level (topology-aware)
// optimization. THE MOAT.
//
// Mirror (Phase 1) logs every request with X-Request-Chain-Id and
// X-Parent-Agent-Id. Router (Phase 3) routes single calls. Brain sees the
// whole swarm: it rebuilds the directed agent graph per chain, scores how
// critical each step is, and assigns models to minimize TOTAL expected
// workflow cost (direct spend + retry + wasted downstream on failure).
//
// WIRING (how brain wraps router, never forks it):
//   - Input is Postgres logger rows (models.RequestLog) via SpanFromLog —
//     the same rows the Mirror proxy already writes. No new headers.
//   - Per-call routing stays in internal/router. Brain only maps a step's
//     criticality tier ("frontier"|"standard"|"cheap") through a
//     RouterSelector func(agentID, tier string) string — string model names,
//     no import of internal/router, so no import cycles, ever.
//   - Enforcer budgets are a hard cap: OptimizeWithBudget drops every plan
//     whose expected total exceeds the budget. Policy denylists are applied
//     BEFORE optimization by filtering Step.Options (blocked models never
//     enter the search space).
//
// Serving path is pure Go (exhaustive search under a combo cap, greedy +
// hill-climb above it). ML lives offline: Learner exposes the EWMA update
// interface; a Python job can fit weights and push them via SetWeights.
package brain

import (
	"sort"
	"sync"

	"github.com/agentledger/agentledger/pkg/models"
)

// Header names mirror internal/proxy attribution headers. Brain never parses
// HTTP itself; it consumes logger rows that already carried these headers.
const (
	HeaderChainID       = "X-Request-Chain-Id"
	HeaderParentAgentID = "X-Parent-Agent-Id"
)

// Span is one observed agent step inside a workflow chain. Build it from a
// Postgres request_logs row with SpanFromLog.
type Span struct {
	ChainID       string
	AgentID       string
	ParentAgentID string
	Model         string
	CostUSD       float64
	StatusCode    int
	Success       bool
}

// SpanFromLog converts a Mirror logger row into a Brain span. A row counts
// as success when the upstream status is 2xx. Rows without a ChainID cannot
// join a graph and are reported as dropped by the Builder.
func SpanFromLog(l models.RequestLog) Span {
	return Span{
		ChainID:       l.ChainID,
		AgentID:       l.AgentID,
		ParentAgentID: l.ParentAgentID,
		Model:         l.Model,
		CostUSD:       l.CostUSD,
		StatusCode:    l.StatusCode,
		Success:       l.StatusCode >= 200 && l.StatusCode < 300,
	}
}

// Node is one agent in a workflow graph.
type Node struct {
	AgentID   string
	Parents   []string
	Children  []string
	Calls     int
	Failures  int
	TotalCost float64
}

// Graph is the directed agent topology for one chain.
type Graph struct {
	ChainID string
	Nodes   map[string]*Node
	// Edges are (parent, child) pairs, deduplicated.
	Edges [][2]string
	// Roots have no known parent inside this chain.
	Roots []string
	// Orphans named a ParentAgentID that was never observed in this chain.
	// Their edge is NOT added (this is what keeps accuracy >95%: we would
	// rather drop an edge than invent a wrong one).
	Orphans []string
	// Dropped counts spans ignored for missing ChainID or AgentID.
	Dropped int
}

// hasEdge reports whether parent->child already exists.
func (g *Graph) hasEdge(parent, child string) bool {
	for _, e := range g.Edges {
		if e[0] == parent && e[1] == child {
			return true
		}
	}
	return false
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// finalize recomputes Roots after all spans are in. (Out-of-order arrival is
// handled by BuildGraph's two passes; Builder re-links orphans by rebuilding
// when the parent finally arrives — see Builder.Observe.)
func (g *Graph) finalize() {
	roots := []string{}
	for id, n := range g.Nodes {
		if n.Calls == 0 {
			continue // leftover placeholder, never observed
		}
		if len(n.Parents) == 0 {
			roots = append(roots, id)
		}
	}
	sort.Strings(roots)
	g.Roots = roots
	sort.Strings(g.Orphans)
}

// BuildGraph builds the directed graph for one chain from raw spans.
// Out-of-order spans are fine: it makes two passes so a parent observed
// after its child still links (pass 1 registers all observed agents,
// pass 2 adds edges only between observed agents).
//
// >95% parent-child accuracy plan (acceptance: specs/08):
//  1. Edge requires child.ParentAgentID == parent.AgentID within the SAME
//     chain — never fuzzy-matched, never inferred from timing.
//  2. Unknown parents become orphans (edge dropped, counted) instead of
//     guessed edges. Accuracy = linkedEdges / (linkedEdges + orphans);
//     dashboard surfaces the orphan rate so operators add the missing
//     header rather than silently accept a wrong graph.
//  3. Self-loops treated as roots. Duplicate spans dedupe edges.
//
// Validate: replay 7-agent pipeline fixtures with known topology; assert
// edge set equality (see graph_test.go).
func BuildGraph(chainID string, spans []Span) *Graph {
	g := &Graph{ChainID: chainID, Nodes: map[string]*Node{}}
	// Pass 1: register every observed agent.
	for _, s := range spans {
		if s.ChainID == "" || s.AgentID == "" {
			g.Dropped++
			continue
		}
		n, ok := g.Nodes[s.AgentID]
		if !ok {
			n = &Node{AgentID: s.AgentID}
			g.Nodes[s.AgentID] = n
		}
		n.Calls++
		n.TotalCost += s.CostUSD
		if !s.Success {
			n.Failures++
		}
	}
	// Pass 2: link edges only between mutually observed agents.
	for _, s := range spans {
		if s.ChainID == "" || s.AgentID == "" {
			continue
		}
		if s.ParentAgentID == "" || s.ParentAgentID == s.AgentID {
			continue
		}
		p, ok := g.Nodes[s.ParentAgentID]
		if !ok || p.Calls == 0 {
			if !contains(g.Orphans, s.AgentID) {
				g.Orphans = append(g.Orphans, s.AgentID)
			}
			continue
		}
		if !g.hasEdge(s.ParentAgentID, s.AgentID) {
			g.Edges = append(g.Edges, [2]string{s.ParentAgentID, s.AgentID})
			p.Children = append(p.Children, s.AgentID)
			g.Nodes[s.AgentID].Parents = append(g.Nodes[s.AgentID].Parents, s.ParentAgentID)
		}
	}
	g.finalize()
	return g
}

// Adjacency returns parent -> children lists (sorted, deterministic).
func (g *Graph) Adjacency() map[string][]string {
	out := make(map[string][]string, len(g.Nodes))
	for id, n := range g.Nodes {
		if n.Calls == 0 {
			continue
		}
		cp := append([]string{}, n.Children...)
		sort.Strings(cp)
		out[id] = cp
	}
	return out
}

// TopoOrder returns a topological ordering (Kahn's algorithm). ok=false
// when a cycle exists; the returned order is then best-effort (cycle
// members appended sorted) so callers never deadlock.
func (g *Graph) TopoOrder() (order []string, ok bool) {
	indeg := map[string]int{}
	for id, n := range g.Nodes {
		if n.Calls == 0 {
			continue
		}
		indeg[id] = len(n.Parents)
	}
	var queue []string
	for id, d := range indeg {
		if d == 0 {
			queue = append(queue, id)
		}
	}
	sort.Strings(queue)
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		order = append(order, id)
		children := append([]string{}, g.Nodes[id].Children...)
		sort.Strings(children)
		for _, c := range children {
			if _, live := indeg[c]; !live {
				continue
			}
			indeg[c]--
			if indeg[c] == 0 {
				queue = append(queue, c)
			}
		}
		sort.Strings(queue)
	}
	if len(order) != len(indeg) {
		seen := map[string]bool{}
		for _, id := range order {
			seen[id] = true
		}
		var rest []string
		for id := range indeg {
			if !seen[id] {
				rest = append(rest, id)
			}
		}
		sort.Strings(rest)
		return append(order, rest...), false
	}
	return order, true
}

// Depths returns the longest-path depth of each node from any root
// (roots = 0). Used for the chain-position criticality factor.
func (g *Graph) Depths() map[string]int {
	depths := map[string]int{}
	order, _ := g.TopoOrder()
	for _, id := range order {
		best := 0
		for _, p := range g.Nodes[id].Parents {
			if d, ok := depths[p]; ok && d+1 > best {
				best = d + 1
			}
		}
		// Only count parents that are live nodes.
		hasLive := false
		for _, p := range g.Nodes[id].Parents {
			if _, ok := depths[p]; ok {
				hasLive = true
				break
			}
		}
		if !hasLive {
			best = 0
			// unless it has parents at all — then min depth 1 chain still
			// resolves via order; keep longest-path semantics:
			maxP := -1
			for _, p := range g.Nodes[id].Parents {
				if d, ok := depths[p]; ok && d > maxP {
					maxP = d
				}
			}
			if maxP >= 0 {
				best = maxP + 1
			}
		}
		depths[id] = best
	}
	return depths
}

// Descendants returns all downstream agent IDs of id (BFS, deduplicated,
// sorted). A failing step wastes (at least) these steps' spend.
func (g *Graph) Descendants(id string) []string {
	seen := map[string]bool{id: true}
	queue := []string{id}
	var out []string
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		n, ok := g.Nodes[cur]
		if !ok {
			continue
		}
		for _, c := range n.Children {
			if !seen[c] {
				seen[c] = true
				out = append(out, c)
				queue = append(queue, c)
			}
		}
	}
	sort.Strings(out)
	return out
}

// HeaderCoverage reports the fraction of spans carrying BOTH headers needed
// for linking. Operators need this ≥0.95 for the accuracy SLO; anything
// lower means an agent is not sending attribution headers.
func HeaderCoverage(spans []Span) float64 {
	if len(spans) == 0 {
		return 0
	}
	good := 0
	for _, s := range spans {
		if s.ChainID != "" && s.AgentID != "" {
			good++
		}
	}
	return float64(good) / float64(len(spans))
}

// Builder accumulates spans across chains (serving path: called per logged
// request). It is safe for concurrent use by the proxy log path.
type Builder struct {
	mu     sync.Mutex
	chains map[string]*Graph
	spans  map[string][]Span
}

// NewBuilder returns an empty Builder.
func NewBuilder() *Builder {
	return &Builder{chains: map[string]*Graph{}, spans: map[string][]Span{}}
}

// Observe folds one span in and rebuilds that chain's graph. Rebuild is
// O(spans-in-chain) and chains are small (≤ dozens of steps); the hot
// per-request cost stays a map append + occasional rebuild.
func (b *Builder) Observe(s Span) {
	if s.ChainID == "" || s.AgentID == "" {
		b.mu.Lock()
		b.spans[""] = append(b.spans[""], s)
		b.mu.Unlock()
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.spans[s.ChainID] = append(b.spans[s.ChainID], s)
	b.chains[s.ChainID] = BuildGraph(s.ChainID, b.spans[s.ChainID])
}

// Graph returns the current graph for a chain.
func (b *Builder) Graph(chainID string) (*Graph, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	g, ok := b.chains[chainID]
	return g, ok
}

// Chains lists known chain IDs (sorted).
func (b *Builder) Chains() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]string, 0, len(b.chains))
	for id := range b.chains {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
