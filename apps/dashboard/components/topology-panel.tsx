'use client';

// TopologyPanel — Phase 5 Brain workflow graph visualization.
//
// Pure SVG, zero layout dependencies: nodes are layered by chain depth
// (columns) and spread vertically, so a 20-node topology renders in <1s
// (single render pass, no force simulation, no canvas lib).
//
// Data comes from Postgres (workflow_graphs + request_logs aggregates);
// the parent Next.js page passes steps/edges as props. Per-step cost,
// model, quality, and failure rate render on the node + native <title>
// tooltip. Live updates = re-render on prop change (caller polls).

import React, { useMemo } from 'react';

export interface TopologyStep {
  /** Agent id (graph node key). */
  id: string;
  /** Chain depth from root (0 = planner/root). */
  depth: number;
  /** Assigned model name (string — Brain extends Router, never forks it). */
  model: string;
  /** Mean direct cost per execution, USD. */
  costUsd: number;
  /** Mean output quality 0..1 (0 = unjudged). */
  quality: number;
  /** Historical failure rate 0..1. */
  failureRate: number;
  /** Criticality score 0..1. */
  criticality: number;
  /** Routing tier derived from criticality. */
  tier: 'frontier' | 'standard' | 'cheap';
}

export interface TopologyEdge {
  from: string;
  to: string;
}

export interface TopologyPanelProps {
  chainId: string;
  steps: TopologyStep[];
  edges: TopologyEdge[];
  /** Expected total workflow cost (incl. retry), USD. */
  expectedTotalUsd?: number;
  /** Savings vs uniform-frontier baseline, 0..1. */
  savingsVsUniform?: number;
  width?: number;
  height?: number;
}

const TIER_COLOR: Record<TopologyStep['tier'], string> = {
  frontier: '#a855f7', // purple — high-stakes, best model
  standard: '#38bdf8', // blue — mid tier
  cheap: '#34d399', // green — low-stakes, cheapest
};

const NODE_W = 148;
const NODE_H = 64;
const COL_GAP = 56;
const ROW_GAP = 26;

function fmtUsd(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

export default function TopologyPanel({
  chainId,
  steps,
  edges,
  expectedTotalUsd,
  savingsVsUniform,
  width = 860,
  height = 420,
}: TopologyPanelProps) {
  const layout = useMemo(() => {
    // Layer by depth: deterministic column per depth, rows spread evenly.
    const byDepth = new Map<number, TopologyStep[]>();
    for (const s of steps) {
      const list = byDepth.get(s.depth) ?? [];
      list.push(s);
      byDepth.set(s.depth, list);
    }
    for (const list of byDepth.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number }>();
    depths.forEach((d, col) => {
      const list = byDepth.get(d)!;
      list.forEach((s, row) => {
        pos.set(s.id, {
          x: 16 + col * (NODE_W + COL_GAP),
          y: 16 + row * (NODE_H + ROW_GAP),
        });
      });
    });
    return { pos, columns: depths.length };
  }, [steps]);

  const paths = useMemo(
    () =>
      edges
        .map((e, i) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="#64748b" strokeWidth={1.5} opacity={0.8} />;
        })
        .filter(Boolean),
    [edges, layout],
  );

  return (
    <section aria-label={`Workflow topology for ${chainId}`} className="rounded-xl border p-4">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">Workflow: {chainId}</h2>
        {expectedTotalUsd !== undefined && <span className="text-xs text-muted-foreground">expected {fmtUsd(expectedTotalUsd)} incl. retry</span>}
        {savingsVsUniform !== undefined && (
          <span className="text-xs font-medium text-emerald-600">−{(savingsVsUniform * 100).toFixed(0)}% vs uniform-frontier</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {steps.length} steps · {edges.length} edges
        </span>
      </header>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Agent topology graph">
        {paths}
        {steps.map((s) => {
          const p = layout.pos.get(s.id);
          if (!p) return null;
          const color = TIER_COLOR[s.tier];
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`}>
              <title>{`${s.id} · ${s.model} · cost ${fmtUsd(s.costUsd)} · quality ${(s.quality * 100).toFixed(0)}% · fail ${(s.failureRate * 100).toFixed(1)}% · criticality ${s.criticality.toFixed(2)} (${s.tier})`}</title>
              <rect width={NODE_W} height={NODE_H} rx={10} fill="var(--card, #0f172a)" stroke={color} strokeWidth={2} />
              <rect width={6} height={NODE_H} rx={3} fill={color} />
              <text x={14} y={20} fontSize={12} fontWeight={700} fill="currentColor">
                {s.id}
              </text>
              <text x={14} y={36} fontSize={10.5} fill="#94a3b8">
                {s.model}
              </text>
              <text x={14} y={51} fontSize={10.5} fill="#94a3b8">
                {fmtUsd(s.costUsd)} · q{(s.quality * 100).toFixed(0)} · f{(s.failureRate * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
      </svg>

      <footer className="mt-2 flex gap-4 text-xs text-muted-foreground">
        {(Object.keys(TIER_COLOR) as TopologyStep['tier'][]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[t] }} />
            {t}
          </span>
        ))}
        <span className="ml-auto">pure SVG · renders {'<'}1s at 20 nodes</span>
      </footer>
    </section>
  );
}
