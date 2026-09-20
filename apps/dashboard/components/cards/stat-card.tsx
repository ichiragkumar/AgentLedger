// StatCard — ledger-web-dashboard primitive (specs 17 Overview, 18 tokens).
// Server presentational: value always monospace tabular-nums.
// NOTE(tokens): uses font-mono + tabular-nums until ledger-web-system ships `.mono`.

export interface StatCardProps {
  label: string;
  /** Pre-formatted headline value (caller formats money via .mono rules). */
  value: string;
  sub: string;
  /** Vs-previous-period delta, percent. Positive = up. */
  deltaPct?: number;
  /** When true, "up" is bad (spend) vs good (savings). Defaults to spend semantics. */
  invert?: boolean;
}

export default function StatCard({ label, value, sub, deltaPct, invert = true }: StatCardProps) {
  const up = (deltaPct ?? 0) >= 0;
  // Spend semantics: up = overspend (red). Savings semantics (invert=false): up = good (green).
  const good = invert ? !up : up;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>
      {deltaPct !== undefined && (
        <p className={`mt-1 text-xs font-medium ${good ? "text-emerald-600" : "text-red-500"}`}>
          <span aria-hidden>{up ? "▲" : "▼"}</span> {Math.abs(deltaPct).toFixed(1)}% vs prior period
        </p>
      )}
    </div>
  );
}
