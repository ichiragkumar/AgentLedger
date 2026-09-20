import { ChartSkeleton } from "@/components/layout/skeletons";

export default function TopologyLoading() {
  return (
    <div aria-busy="true" aria-label="Loading topology">
      <ChartSkeleton lines={2} />
    </div>
  );
}
