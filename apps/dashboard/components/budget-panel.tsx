"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

export interface BurndownDatum {
  /** YYYY-MM-DD */
  date: string;
  /** Ideal straight-line cumulative spend */
  idealCum: number;
  /** Actual cumulative spend */
  actualCum: number;
}

export interface BudgetPanelProps {
  teamName: string;
  /** Budget cap for the period, USD */
  budgetUSD: number;
  /** Spend to date, USD */
  spentUSD: number;
  /** 0-100+ utilization percent (max of token%/dollar%) */
  utilizationPct: number;
  /** Forecasted end-of-period spend, USD */
  forecastUSD: number;
  /** "at this rate you'll spend $X by month end" headline */
  forecastMessage?: string;
  /** Per-day burndown series (real-time: re-render on poll tick) */
  burndown: BurndownDatum[];
  /** ISO timestamp the data was captured (shows staleness) */
  updatedAt?: string;
}

function statusOf(util: number): { label: string; color: string } {
  if (util >= 100) return { label: "Hard stop", color: "hsl(var(--overspend))" };
  if (util >= 90) return { label: "Downgrading", color: "hsl(var(--warning))" };
  if (util >= 75) return { label: "Warning", color: "hsl(var(--warning))" };
  if (util >= 50) return { label: "Watch", color: "hsl(var(--chart-1))" };
  return { label: "Healthy", color: "hsl(var(--savings))" };
}

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * BudgetPanel — CFO-ready burndown card (Phase 4 Enforcer).
 * Pure presentational: pass live props from the dashboard poller
 * (GET /v1/budgets + forecast). Real-time = parent re-renders on tick.
 */
export function BudgetPanel({
  teamName,
  budgetUSD,
  spentUSD,
  utilizationPct,
  forecastUSD,
  forecastMessage,
  burndown,
  updatedAt,
}: BudgetPanelProps) {
  const status = statusOf(utilizationPct);
  const over = forecastUSD > budgetUSD && budgetUSD > 0;
  const barPct = Math.min(100, Math.max(0, utilizationPct));

  return (
    <section
      aria-label={`Budget for ${teamName}`}
      className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{teamName}</h2>
          <p className="text-sm text-zinc-500">
            <span className="mono">{fmtUSD(spentUSD)} of {fmtUSD(budgetUSD)}</span> · {updatedAt ? `live as of ${updatedAt}` : "live"}
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: `color-mix(in srgb, ${status.color} 12%, transparent)`, color: status.color }}
        >
          {status.label} · {utilizationPct.toFixed(1)}%
        </span>
      </header>

      {/* Utilization bar */}
      <div
        role="progressbar"
        aria-valuenow={utilizationPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Budget utilization"
        className="mb-4 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${barPct}%`, backgroundColor: status.color }}
        />
      </div>

      {/* Burndown chart */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={burndown} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={28} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
            />
            <Tooltip formatter={(v: unknown) => fmtUSD(Number(v ?? 0))} />
            <Legend />
            <ReferenceLine
              y={budgetUSD}
              stroke="hsl(var(--overspend))"
              strokeDasharray="6 3"
              label={{ value: "budget", fontSize: 11, fill: "hsl(var(--overspend))" }}
            />
            <Line
              type="monotone"
              dataKey="idealCum"
              name="Ideal"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 4"
              dot={false}
              strokeWidth={1.5}
            />
            <Line
              type="monotone"
              dataKey="actualCum"
              name="Actual"
              stroke={status.color}
              dot={false}
              strokeWidth={2.5}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Forecast vs budget */}
      <footer className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>
          Forecast: <strong className="mono">{fmtUSD(forecastUSD)}</strong>
        </span>
        <span className={over ? "mono font-medium text-overspend" : "mono text-zinc-500"}>
          {over
            ? `over budget by ${fmtUSD(forecastUSD - budgetUSD)}`
            : `under budget by ${fmtUSD(budgetUSD - forecastUSD)}`}
        </span>
        {forecastMessage ? (
          <span className="text-zinc-500">{forecastMessage}</span>
        ) : null}
      </footer>
    </section>
  );
}

export default BudgetPanel;
