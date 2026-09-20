import { getHealth, getSpendSummary, getTopRequests } from "@/lib/api";
import CachePanel from "@/components/cache-panel";
import RoutingPanel from "@/components/routing-panel";
import { BudgetPanel } from "@/components/budget-panel";
import TopologyPanel from "@/components/topology-panel";
import SpendTrend from "@/components/spend-trend";
import BreakdownTable from "@/components/breakdown-table";
import RequestLog from "@/components/request-log";
import ThemeToggle from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

export default async function Home() {
  const [summary, requests, healthy] = await Promise.all([getSpendSummary(), getTopRequests(), getHealth()]);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-6 py-10 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AgentLedger</h1>
          <p className="text-sm text-zinc-500">TokenOps control plane — observe · cache · route · enforce</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              healthy ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            Proxy {healthy ? "healthy" : "unreachable"}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Stat label="Spend · 24h" value={`$${summary.spend24h.toFixed(2)}`} sub={`${summary.requests24h} requests`} />
        <Stat label="Spend · 7d" value={`$${summary.spend7d.toFixed(2)}`} sub="trailing 7 days" />
        <Stat label="Spend · 30d" value={`$${summary.spend30d.toFixed(2)}`} sub="trailing 30 days" />
        <Stat label="Requests · 24h" value={`${summary.requests24h}`} sub="via proxy" />
      </div>

      <Card title="Spend — last 14 days">
        <SpendTrend data={summary.trend} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="By model">
          <BreakdownTable title="Model" rows={summary.byModel.map((m) => ({ key: m.model, spend: m.spend, requests: m.requests }))} emptyHint="No model spend yet." />
        </Card>
        <Card title="By agent">
          <BreakdownTable title="Agent" rows={summary.byAgent.map((a) => ({ key: a.agent, spend: a.spend, requests: a.requests }))} emptyHint="Tag requests with X-Agent-Id to attribute cost." />
        </Card>
        <Card title="By team">
          <BreakdownTable title="Team" rows={summary.byTeam.map((t) => ({ key: t.team, spend: t.spend, requests: t.requests }))} emptyHint="Tag requests with X-Team-Id to attribute cost." />
        </Card>
      </div>

      <Card title="Top 10 costliest requests">
        <RequestLog requests={requests} />
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
