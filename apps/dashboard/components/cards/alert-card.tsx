// AlertCard — ledger-web-dashboard primitive (spec 17 Overview alerts).
// Server presentational. Live feed arrives via use-realtime SSE (backend);
// this card only renders one alert prop.
// TODO(API): subscribe via useRealtime("alerts") — max 5 + view-all (backend).

export interface AlertCardProps {
  title: string;
  message: string;
  ts: string;
  severity: "info" | "warning" | "critical";
}

const SEVERITY_STYLE: Record<AlertCardProps["severity"], string> = {
  info: "border-blue-500",
  warning: "border-amber-500",
  critical: "border-red-500",
};

export default function AlertCard({ title, message, ts, severity }: AlertCardProps) {
  return (
    <li className={`rounded-lg border border-zinc-200 border-l-4 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 ${SEVERITY_STYLE[severity]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <time className="shrink-0 font-mono text-[11px] text-zinc-500">{ts}</time>
      </div>
      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
    </li>
  );
}
