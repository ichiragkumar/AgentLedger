import { ChartSkeleton } from "@/components/layout/skeletons";

export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <ChartSkeleton />
    </div>
  );
}
