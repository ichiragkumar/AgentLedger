"use client";

// SpendByAgent — ledger-web-dashboard chart (spec 17 Overview: top-5 bars).
// Row shape matches lib/api SpendSummary["byAgent"] element.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SpendByAgentRow {
  agent: string;
  spend: number;
  requests: number;
}

export default function SpendByAgent({ rows }: { rows: SpendByAgentRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No agent spend yet — tag requests with X-Agent-Id.</p>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
          <YAxis type="category" dataKey="agent" width={110} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: unknown) => `$${Number(v ?? 0).toFixed(2)}`} />
          <Bar dataKey="spend" name="Spend (USD)" fill="hsl(var(--savings))" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
