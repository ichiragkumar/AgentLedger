"use client";

// Connection banner — shows when the live SSE feed drops, so the dashboard
// never serves stale data silently (spec 19 F4). Watches useRealtime status.

import { useRealtime } from "@/lib/hooks/use-realtime";

export default function ConnectionBanner() {
  const { status } = useRealtime(true);
  if (status === "open" || status === "connecting") return null;
  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      Connection lost — live updates paused. Showing last known data; retrying…
    </div>
  );
}
