"use client";

// ModelDistribution — ledger-web-dashboard chart (spec 17 Overview donut).
// Row shape matches lib/api SpendSummary["byModel"] element.
// Slice filter: button list drives highlight (accessible); direct slice-click
// wires to the same setter once filter.store lands (backend).
// TODO(store): selected model -> global filter.store (ledger-web-backend).

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface ModelDistributionRow {
  model: string;
  spend: number;
  requests: number;
}

const SLICE_COLORS = ["#22c55e", "#38bdf8", "#a78bfa", "#f59e0b", "#ef4444", "#94a3b8"];

export default function ModelDistribution({ rows }: { rows: ModelDistributionRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No model spend yet.</p>;
  }
  const total = rows.reduce((s, r) => s + r.spend, 0);
  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip formatter={(v: unknown) => `$${Number(v ?? 0).toFixed(2)}`} />
            <Pie data={rows} dataKey="spend" nameKey="model" innerRadius={55} outerRadius={85} paddingAngle={2} strokeWidth={2}>
              {rows.map((r, i) => (
                <Cell
                  key={r.model}
                  fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                  opacity={selected === null || selected === r.model ? 1 : 0.3}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Filter by model">
        {rows.map((r, i) => {
          const active = selected === r.model;
          return (
            <li key={r.model}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(active ? null : r.model)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${active ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-300 dark:border-zinc-700"}`}
              >
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                {r.model} · {total > 0 ? ((r.spend / total) * 100).toFixed(0) : "0"}%
              </button>
            </li>
          );
        })}
      </ul>
      {selected && <p className="mt-1 text-xs text-zinc-500">Filtering: {selected} (mock — global filter lands with filter.store).</p>}
    </div>
  );
}
