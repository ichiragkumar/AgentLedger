import { queryOrNull } from "@/lib/db";
import { proxyFetch } from "../../_lib/proxy-mgmt";

export const dynamic = "force-dynamic";

// GET /api/cache/stats — Saver analytics (spec 05 §2.5).
//
// Shape is stable whether or not the saver is live:
//   - Proxy wired (Mirror applied WIRING.md) → GET /v1/cache/stats wins,
//     {source:"live", connected:true} with hook-level hit % / $ saved.
//   - Otherwise → Postgres 7d request context + zeroed cache fields,
//     {source:"stub", connected:false}. Pages render empty states, never
//     fabricated hit rates (same honesty rule as /api/stats).
// Never 500s: every data source is fail-open via queryOrNull/proxyFetch.

export type CacheSeriesPoint = { day: string; exact: number; semantic: number };
export type CacheTopQuery = { query: string; hits: number; savedUSD: number };

export type CacheStatsBody = {
  hitRatePct: number;
  hits: number;
  misses: number;
  savedUsd: number;
  savedWeekUsd: number;
  cacheSize: number;
  avgLookupMs: number | null;
  threshold: number;
  series7d: CacheSeriesPoint[];
  topQueries: CacheTopQuery[];
  requests7d: number;
  spend7d: number;
  source: "live" | "stub";
  connected: boolean;
  updatedAt: string;
};

type LiveStats = {
  hit_rate?: number;
  exact_hits?: number;
  semantic_hits?: number;
  misses?: number;
  saved_usd?: number;
  size?: number;
  avg_lookup_ms?: number;
  threshold?: number;
};

type TotalsRow = { requests: string | null; spend: string | null };

const num = (v: string | number | null | undefined) => Number(v ?? 0);

export async function GET() {
  // 1) Live saver stats (best-effort; 404/connection-refused until Mirror
  //    mounts GET /v1/cache/stats — see internal/cache/WIRING.md).
  const live = await proxyFetch<LiveStats>("/v1/cache/stats", undefined, 1500);
  if (live.ok && live.data) {
    const d = live.data;
    const hits = num(d.exact_hits) + num(d.semantic_hits);
    const total = hits + num(d.misses);
    const body: CacheStatsBody = {
      hitRatePct: total > 0 ? (hits / total) * 100 : num(d.hit_rate) * 100,
      hits,
      misses: num(d.misses),
      savedUsd: num(d.saved_usd),
      savedWeekUsd: num(d.saved_usd),
      cacheSize: num(d.size),
      avgLookupMs: d.avg_lookup_ms ?? null,
      threshold: num(d.threshold) || 0.92,
      series7d: [],
      topQueries: [],
      requests7d: total,
      spend7d: 0,
      source: "live",
      connected: true,
      updatedAt: new Date().toISOString(),
    };
    return Response.json(body);
  }

  // 2) Zero-state fallback: Postgres 7d context, cache fields zeroed.
  const rows = await queryOrNull<TotalsRow>(
    `SELECT count(*) AS requests, sum(cost_usd) AS spend
     FROM request_logs WHERE ts > now() - interval '7 days'`
  );
  const body: CacheStatsBody = {
    hitRatePct: 0,
    hits: 0,
    misses: 0,
    savedUsd: 0,
    savedWeekUsd: 0,
    cacheSize: 0,
    avgLookupMs: null,
    threshold: 0.92,
    series7d: [],
    topQueries: [],
    requests7d: num(rows?.[0]?.requests),
    spend7d: num(rows?.[0]?.spend),
    source: "stub",
    connected: false,
    updatedAt: new Date().toISOString(),
  };
  return Response.json(body);
}
