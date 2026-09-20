import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

// Brand primitive — owner: ledger-web-system (spec 18).
// Card + cost coloring. Value ALWAYS `.mono` (tabular money numerals).

export interface StatCardProps {
  label: string;
  /** Pre-formatted headline value (format money with formatUSD from @agentledger/ui). */
  value: string;
  sub: string;
  /** Vs-previous-period delta, percent. Positive = up. */
  deltaPct?: number;
  /** When true, "up" is bad (spend). False = "up" is good (savings). */
  invert?: boolean;
  className?: string;
}

export default function StatCard({ label, value, sub, deltaPct, invert = true, className }: StatCardProps) {
  const up = (deltaPct ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <Card className={className}>
      <CardContent className="p-4 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mono mt-1 text-2xl font-bold">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        {deltaPct !== undefined && (
          <p className={cn("mt-1 text-xs font-medium", good ? "text-savings" : "text-overspend")}>
            <span aria-hidden>{up ? "▲" : "▼"}</span> {Math.abs(deltaPct).toFixed(1)}% vs prior period
          </p>
        )}
      </CardContent>
    </Card>
  );
}
