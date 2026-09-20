import { getSpendSummary, getHealth } from "../lib/api";
import CachePanel from "../components/cache-panel";
import RoutingPanel from "../components/routing-panel";
import { BudgetPanel } from "../components/budget-panel";
import TopologyPanel from "../components/topology-panel";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [summary, healthy] = await Promise.all([getSpendSummary(), getHealth()]);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>AgentLedger — TokenOps overview</h1>
      <p>Proxy: {healthy ? "healthy" : "unreachable (start with docker compose up)"}</p>
      <section>
        <h2>Spend</h2>
        <p>24h: ${summary.spend24h.toFixed(2)} · 7d: ${summary.spend7d.toFixed(2)} · 30d: ${summary.spend30d.toFixed(2)}</p>
      </section>
      <section>
        <h2>Cache</h2>
        <CachePanel hitRatePct={0} hits={0} misses={0} savedUSD={0} savedWeekUSD={0} cacheSize={0} threshold={0.92} topQueries={[]} />
      </section>
      <section>
        <h2>Routing</h2>
        <RoutingPanel distribution={[]} wouldHaveSpent={0} spent={0} qualityPerModel={[]} escalationRate={0} />
      </section>
      <section>
        <h2>Budgets</h2>
        <BudgetPanel teamName="all teams" budgetUSD={0} spentUSD={0} utilizationPct={0} forecastUSD={0} burndown={[]} />
      </section>
      <section>
        <h2>Topology</h2>
        <TopologyPanel chainId="—" steps={[]} edges={[]} />
      </section>
    </main>
  );
}
