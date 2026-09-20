"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { day: string; spend: number; requests: number };

export default function SpendTrend({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No traffic yet — point an agent at the proxy to see spend per day.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
          <Tooltip formatter={(v: unknown) => `$${Number(v ?? 0).toFixed(2)}`} labelFormatter={(d) => `Day ${d}`} />
          <Area type="monotone" dataKey="spend" name="Spend (USD)" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
