import { TableSkeleton } from "@/components/layout/skeletons";

export default function AgentsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading agents">
      <TableSkeleton rows={8} />
    </div>
  );
}
