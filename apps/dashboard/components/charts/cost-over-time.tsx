"use client";

// CostOverTime — ledger-web-dashboard chart (spec 17 Overview).
// Area spend chart fed by lib/api SpendSummary["trend"] shape.
// TODO(API): stacked-by-model series once backend ships per-model timeseries
// (use-overview); range comes from filter.store.

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface CostOverTimePoint {
  day: string;
  spend: number;
  requests: number;
}

export default function CostOverTime({ data }: { data: CostOverTimePoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No traffic in range — point an agent at the proxy to see spend.</p>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
          <Tooltip formatter={(v: unknown) => `$${Number(v ?? 0).toFixed(2)}`} />
          <Area type="monotone" dataKey="spend" name="Spend (USD)" stroke="hsl(var(--savings))" fill="hsl(var(--savings))" fillOpacity={0.25} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
