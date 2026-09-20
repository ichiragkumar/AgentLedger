import * as React from "react";
import { cn } from "@/lib/utils";

// Raw shadcn — NEVER modify (re-install on upgrade). Owner: ledger-web-system.
// Extended with savings/overspend/warning semantic variants (spec 18 tokens).

const badgeVariants = {
  default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "text-foreground",
  savings: "border-transparent bg-savings text-white shadow hover:bg-savings/80",
  overspend: "border-transparent bg-overspend text-white shadow hover:bg-overspend/80",
  warning: "border-transparent bg-warning text-white shadow hover:bg-warning/80",
} as const;

export type BadgeVariant = keyof typeof badgeVariants;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
