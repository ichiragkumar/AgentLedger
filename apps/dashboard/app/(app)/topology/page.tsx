// Topology page — ledger-web-dashboard owner (spec 17 §Topology, Phase 5).
// Visible now with MOCK graph + "Coming Q4 2026" banner + star CTA.
// Reuses TopologyPanel (pure SVG). Live data: spec 08 brain API (backend).
// NOTE: React Flow replaces the SVG once the `reactflow` dep is approved
// (dashboard cannot add deps — listed in return message instead).

import TopologyPanel from "@/components/topology-panel";

export const dynamic = "force-dynamic";

export default async function TopologyPage() {
  return (
    <div className="flex flex-col gap-5">
      <div role="note" className="rounded-xl border border-indigo-300 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950">
        <strong>Coming Q4 2026.</strong> Live workflow attribution (Brain, spec 08) is not wired yet — below is a mock
        Content Pipeline.{" "}
        <a href="#" title="Star CTA wires to GitHub API integration (ledger-web-journey)" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Star the repo to get notified
        </a>
      </div>

      <header>
        <h1 className="text-2xl font-bold tracking-tight">Topology</h1>
        <p className="text-sm text-zinc-500">See the swarm, not the request — Planner→Researcher→Writer→Reviewer.</p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Content Pipeline</h2>
          <span className="font-mono text-sm tabular-nums">Total $0.104</span>
          <span className="text-sm font-medium text-emerald-600">Optimized −30% vs uniform-frontier</span>
        </div>
        <TopologyPanel
          chainId="content-pipeline"
          steps={[
            { id: "planner", depth: 0, model: "claude-3-5-sonnet", costUsd: 0.042, quality: 0.9, failureRate: 0.02, criticality: 0.9, tier: "frontier" },
            { id: "researcher", depth: 1, model: "claude-3-5-haiku", costUsd: 0.018, quality: 0.84, failureRate: 0.05, criticality: 0.5, tier: "standard" },
            { id: "writer", depth: 2, model: "gemini-2.0-flash", costUsd: 0.006, quality: 0.78, failureRate: 0.08, criticality: 0.2, tier: "cheap" },
            { id: "reviewer", depth: 3, model: "claude-3-5-sonnet", costUsd: 0.031, quality: 0.92, failureRate: 0.03, criticality: 0.85, tier: "frontier" },
          ]}
          edges={[
            { from: "planner", to: "researcher" },
            { from: "researcher", to: "writer" },
            { from: "writer", to: "reviewer" },
          ]}
          expectedTotalUsd={0.104}
          savingsVsUniform={0.3}
        />
        <p className="mt-2 text-xs text-zinc-500">Hover a node for model / cost / tokens / failure · click-through to step requests lands with the brain API.</p>
      </section>
    </div>
  );
}
