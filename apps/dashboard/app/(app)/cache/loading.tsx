import { ChartSkeleton } from "@/components/layout/skeletons";

export default function CacheLoading() {
  return (
    <div aria-busy="true" aria-label="Loading cache">
      <ChartSkeleton lines={2} />
    </div>
  );
}
