// Loading skeletons for the authenticated shell (spec 19 perf: skeleton →
// data). Shared by app/(app)/loading.tsx and client-side refetch states.

export function StatSkeleton() {
  return (
    <div aria-hidden className="animate-pulse rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-7 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-1 h-3 w-28 rounded bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

export function ChartSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div aria-hidden className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-56 rounded bg-zinc-100 dark:bg-zinc-900" />
      {lines > 1 && <div className="mt-3 h-4 w-2/3 rounded bg-zinc-100 dark:bg-zinc-900" />}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 h-5 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </div>
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>
      <ChartSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <TableSkeleton rows={3} />
    </div>
  );
}
