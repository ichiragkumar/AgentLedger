import { TableSkeleton } from "@/components/layout/skeletons";

export default function PoliciesLoading() {
  return (
    <div aria-busy="true" aria-label="Loading policies">
      <TableSkeleton rows={4} />
    </div>
  );
}
