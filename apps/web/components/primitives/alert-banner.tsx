import { cn } from "@/lib/utils";

// Brand primitive — owner: ledger-web-system (spec 18).
// Budget-threshold alert strip. Severity → semantic token styling.

export type AlertSeverity = "info" | "warning" | "critical";

const severityStyles: Record<AlertSeverity, string> = {
  info: "border-primary/30 bg-primary/10 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  critical: "border-overspend/40 bg-overspend/10 text-foreground",
};

const severityDot: Record<AlertSeverity, string> = {
  info: "bg-primary",
  warning: "bg-warning",
  critical: "bg-overspend",
};

export interface AlertBannerProps {
  severity: AlertSeverity;
  title: string;
  children?: React.ReactNode;
  className?: string;
}

export default function AlertBanner({ severity, title, children, className }: AlertBannerProps) {
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", severityStyles[severity], className)}
    >
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", severityDot[severity])} />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children != null && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
