import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

// Brand primitive — owner: ledger-web-system (spec 18).
// Badge + $ formatting, ALWAYS `.mono`. Tone defaults from sign:
// negative/spend → overspend, savings (prefix-aware) → savings.

export interface CostBadgeProps {
  /** Dollar amount. Positive = spend, negative = saved (unless tone given). */
  amount: number;
  /** Explicit tone override. */
  tone?: "spend" | "savings" | "warning" | "neutral";
  /** Compact (fewer decimals) display. */
  compact?: boolean;
  className?: string;
}

const toneToVariant: Record<NonNullable<CostBadgeProps["tone"]>, BadgeVariant> = {
  spend: "overspend",
  savings: "savings",
  warning: "warning",
  neutral: "secondary",
};

export function formatUSD(amount: number, compact = false): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (compact && abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

export default function CostBadge({ amount, tone, compact = false, className }: CostBadgeProps) {
  const resolved = tone ?? (amount < 0 ? "savings" : amount === 0 ? "neutral" : "spend");
  return (
    <Badge variant={toneToVariant[resolved]} className={cn("mono", className)}>
      {formatUSD(amount, compact)}
    </Badge>
  );
}
