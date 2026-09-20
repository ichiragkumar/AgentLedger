import { getSpendSummary, getHealth } from "@/lib/api";
import CachePanel from "@/components/cache-panel";
import RoutingPanel from "@/components/routing-panel";
import { BudgetPanel } from "@/components/budget-panel";
import TopologyPanel from "@/components/topology-panel";

export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default async function Home() {
  const [summary, healthy] = await Promise.all([getSpendSummary(), getHealth()]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-6 py-10 font-sans">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AgentLedger</h1>
          <p className="text-sm text-zinc-500">TokenOps control plane — observe · cache · route · enforce</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            healthy ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          Proxy {healthy ? "healthy" : "unreachable"}
        </span>
      </header>

      <Card title="Spend">
        <p className="text-sm">
          24h: <strong>${summary.spend24h.toFixed(2)}</strong> · 7d: <strong>${summary.spend7d.toFixed(2)}</strong> · 30d:{" "}
          <strong>${summary.spend30d.toFixed(2)}</strong>
        </p>
      </Card>

      <Card title="Cache">
        <CachePanel hitRatePct={0} hits={0} misses={0} savedUSD={0} savedWeekUSD={0} cacheSize={0} threshold={0.92} topQueries={[]} />
      </Card>

      <Card title="Routing">
        <RoutingPanel distribution={[]} wouldHaveSpent={0} spent={0} qualityPerModel={[]} escalationRate={0} />
      </Card>

      <Card title="Budgets">
        <BudgetPanel teamName="all teams" budgetUSD={0} spentUSD={0} utilizationPct={0} forecastUSD={0} burndown={[]} />
      </Card>

      <Card title="Topology">
        <TopologyPanel chainId="—" steps={[]} edges={[]} />
      </Card>
    </div>
  );
}
