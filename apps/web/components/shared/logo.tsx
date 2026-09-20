import { cn } from "@/lib/utils";

export default function Logo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="5"
          className="fill-indigo-600 dark:fill-indigo-500"
        />
        <path
          d="M7 14.5c1.2-3.6 3.4-5.8 7-6.5M10 16.2c.9-2.4 2.5-4 5-4.7"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="17.4" cy="7.6" r="1.6" fill="white" />
      </svg>
      {!compact && (
        <span className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          AgentLedger
        </span>
      )}
    </span>
  );
}
