import { TableSkeleton } from "@/components/layout/skeletons";

export default function RequestsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading requests">
      <TableSkeleton rows={8} />
    </div>
  );
}
