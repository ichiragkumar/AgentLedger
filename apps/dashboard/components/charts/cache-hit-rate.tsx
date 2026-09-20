"use client";

// CacheHitRate — ledger-web-dashboard chart (spec 17 Cache: exact-vs-semantic 7d).
// TODO(API): series from GET /api/cache/stats (backend); window from filter.store.

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface CacheHitRatePoint {
  day: string;
  exact: number;
  semantic: number;
}

export default function CacheHitRate({ series }: { series: CacheHitRatePoint[] }) {
  if (series.length === 0) {
    return <p className="text-sm text-zinc-500">No cache traffic in window yet.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
          <Tooltip formatter={(v: unknown) => `${Number(v ?? 0).toFixed(1)}%`} />
          <Legend />
          <Line type="monotone" dataKey="exact" name="Exact hit %" stroke="hsl(var(--chart-1))" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="semantic" name="Semantic hit %" stroke="hsl(var(--chart-5))" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
