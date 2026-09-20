"use client";

// Topology page — LIVE wiring (owner: ledger-ship-topology, spec 08 + spec 17 §Topology).
//
// Decision: pure SVG via the sibling-owned TopologyPanel (no `reactflow`
// install — <1s at 20 nodes, zero deps, single render pass). Keyboard and
// mobile access come from THIS page: native <select> workflow picker +
// keyboard-navigable step list (links to agent detail).
//
// Contract: the "Coming Q4 2026" banner stays until /api/topology returns
// workflows; otherwise the mock Content Pipeline renders. Live graphs show
// a source badge (workflow_graphs vs request_logs fallback) + heuristic
// criticality note. Spec-18 tokens only — no raw hex, money gets `.mono`.

import TopologyPanel from "@/components/topology-panel";
import { useTopology, type TopologyStep } from "@/lib/hooks/use-topology";

export const dynamic = "force-dynamic";

const GITHUB_STAR_URL = "https://github.com/ichiragkumar/AgentLedger";

const MOCK_STEPS: TopologyStep[] = [
  { id: "planner", depth: 0, model: "claude-3-5-sonnet", costUsd: 0.042, quality: 0.9, failureRate: 0.02, criticality: 0.9, tier: "frontier", calls: 0, tokens: 0 },
  { id: "researcher", depth: 1, model: "claude-3-5-haiku", costUsd: 0.018, quality: 0.84, failureRate: 0.05, criticality: 0.5, tier: "standard", calls: 0, tokens: 0 },
  { id: "writer", depth: 2, model: "gemini-2.0-flash", costUsd: 0.006, quality: 0.78, failureRate: 0.08, criticality: 0.2, tier: "cheap", calls: 0, tokens: 0 },
  { id: "reviewer", depth: 3, model: "claude-3-5-sonnet", costUsd: 0.031, quality: 0.92, failureRate: 0.03, criticality: 0.85, tier: "frontier", calls: 0, tokens: 0 },
];

const MOCK_EDGES = [
  { from: "planner", to: "researcher" },
  { from: "researcher", to: "writer" },
  { from: "writer", to: "reviewer" },
];

function ComingBanner({ error }: { error: string | null }) {
  return (
    <div
      role="note"
      aria-label="Topology coming soon"
      className="rounded-xl border bg-card p-4 text-sm"
    >
      <strong>Coming Q4 2026.</strong> Live workflow attribution (Brain, spec 08) is not wired yet — below is a
      mock Content Pipeline.{" "}
      <a href={GITHUB_STAR_URL} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
        Star the repo to get notified
      </a>
      <span className="mt-1 block text-muted-foreground">
        To light this up, send <span className="mono">X-Request-Chain-Id</span> +{" "}
        <span className="mono">X-Parent-Agent-Id</span> headers through the proxy — graphs appear here automatically.
        {error ? ` (last fetch: ${error})` : ""}
      </span>
    </div>
  );
}

export default function TopologyPage() {
  const { workflows, chainId, setChainId, detail, loading, detailLoading, error, refresh, hasData } = useTopology();

  const live = hasData && detail;
  const steps = live ? detail.steps : MOCK_STEPS;
  const edges = live ? detail.edges : MOCK_EDGES;
  const activeChainId = live ? detail.chainId : "content-pipeline";

  return (
    <div className="flex flex-col gap-5">
      {!hasData && !loading ? (
        <ComingBanner error={error} />
      ) : (
        <div
          role="status"
          className="rounded-xl border bg-card p-4 text-sm"
          aria-label={loading ? "Loading workflows" : "Live workflow data"}
        >
          {loading ? (
            <span className="text-muted-foreground" aria-busy="true">Loading workflows…</span>
          ) : (
            <span>
              <strong className="text-savings">Live.</strong>{" "}
              <span className="text-muted-foreground">
                {workflows.length} workflow{workflows.length === 1 ? "" : "s"} discovered
                {detail ? ` · source: ${detail.source}` : ""} · criticality is heuristic until Brain weights land.
              </span>
            </span>
          )}
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Topology</h1>
          <p className="text-sm text-muted-foreground">See the swarm, not the request — Planner→Researcher→Writer→Reviewer.</p>
        </div>
        {hasData && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label htmlFor="topology-workflow" className="text-xs font-medium text-muted-foreground">
              Workflow
            </label>
            <select
              id="topology-workflow"
              value={chainId ?? ""}
              onChange={(e) => setChainId(e.target.value || null)}
              className="w-full rounded-lg border bg-card px-3 py-2 text-sm sm:w-64"
            >
              {workflows.map((w) => (
                <option key={w.chainId} value={w.chainId}>
                  {w.chainId} ({w.steps} steps)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Refresh
            </button>
          </div>
        )}
      </header>

      <section
        aria-label={live ? `Workflow ${activeChainId}` : "Mock workflow: Content Pipeline"}
        aria-busy={detailLoading}
        className="rounded-xl border bg-card p-5"
      >
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{live ? detail.chainId : "Content Pipeline"}</h2>
          <span className="mono text-sm tabular-nums">
            Total ${(live ? detail.expectedTotalUsd : 0.104).toFixed(3)}
          </span>
          {!live && <span className="text-sm font-medium text-savings">Optimized −30% vs uniform-frontier</span>}
          {live && detail.savingsVsUniform == null && (
            <span className="text-sm text-muted-foreground">optimizer savings pending Brain weights</span>
          )}
        </div>
        <TopologyPanel
          chainId={activeChainId}
          steps={steps}
          edges={edges}
          expectedTotalUsd={live ? detail.expectedTotalUsd : 0.104}
          savingsVsUniform={live ? undefined : 0.3}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Hover a node for model / cost / tokens / failure · every step below is a keyboard-navigable link to its agent.
        </p>
      </section>

      <nav aria-label="Workflow steps">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.id}>
              <a
                href={`/agents/${encodeURIComponent(s.id)}`}
                className="block rounded-xl border bg-card p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="block text-sm font-semibold">{s.id}</span>
                <span className="mono block truncate text-xs text-muted-foreground">{s.model}</span>
                <span className="mono mt-1 block text-xs tabular-nums">
                  ${s.costUsd.toFixed(4)} · crit {s.criticality.toFixed(2)} · {s.tier}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
