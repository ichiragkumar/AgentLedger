import { ChartSkeleton, TableSkeleton } from "@/components/layout/skeletons";

export default function AgentDetailLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading agent detail">
      <ChartSkeleton />
      <TableSkeleton rows={3} />
    </div>
  );
}
