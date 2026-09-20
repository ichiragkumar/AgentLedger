import { TableSkeleton } from "@/components/layout/skeletons";

export default function KeysLoading() {
  return (
    <div aria-busy="true" aria-label="Loading keys">
      <TableSkeleton rows={5} />
    </div>
  );
}
