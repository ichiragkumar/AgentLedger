import { TableSkeleton } from "@/components/layout/skeletons";

export default function BudgetsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading budgets">
      <TableSkeleton rows={6} />
    </div>
  );
}
