import { ChartSkeleton } from "@/components/layout/skeletons";

export default function RoutingLoading() {
  return (
    <div aria-busy="true" aria-label="Loading routing">
      <ChartSkeleton lines={2} />
    </div>
  );
}
