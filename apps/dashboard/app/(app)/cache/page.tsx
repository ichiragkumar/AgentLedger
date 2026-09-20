// Cache page — Saver ship track (spec 05 §2.5, spec 17 §Cache).
// Client component, live on use-cache (/api/cache/*) + use-realtime (SSE).
// Zero-state safe: skeletons while loading, empty states when the saver is
// not yet wired (stats.connected === false), error + retry on failure.
// Config save → PUT /api/cache/config + toast; flush → confirm dialog +
// POST /api/cache/flush + toast.
"use client";

import { useEffect, useRef, useState } from "react";
import CachePanel from "@/components/cache-panel";
import CacheHitRate from "@/components/charts/cache-hit-rate";
import StatCard from "@/components/cards/stat-card";
import { useCache, type CacheConfig, type FlushScope } from "@/lib/hooks/use-cache";
import { useRealtime } from "@/lib/hooks/use-realtime";

type Toast = { msg: string; kind: "ok" | "err" } | null;

const FLUSH_SCOPES: FlushScope[] = ["all", "agent", "team", "model"];

function fmtUSD(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Skeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="sr-only">Loading {label}</span>
      <div className="h-5 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-4 h-8 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-4 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export default function CachePage() {
  const { stats, config, configSource, saveConfig, flush, loading, saving, flushing, error, refresh } = useCache();
  const { events, status: rtStatus } = useRealtime(true);

  const [draft, setDraft] = useState<CacheConfig | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flushScope, setFlushScope] = useState<FlushScope>("all");
  const [flushValue, setFlushValue] = useState("");
  const scopeRef = useRef<HTMLSelectElement>(null);

  // Seed the config form once live config arrives.
  useEffect(() => {
    setDraft((d) => d ?? config);
  }, [config]);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Focus the confirm dialog on open (keyboard AC).
  useEffect(() => {
    if (confirmOpen) scopeRef.current?.focus();
  }, [confirmOpen]);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  const requests = events.filter((e) => e.type === "request").slice(0, 8);
  const connected = stats?.connected ?? false;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || saving) return;
    try {
      const r = await saveConfig(draft);
      setToast({
        msg: r.proxySynced
          ? `Config saved + applied (threshold ${r.config.threshold.toFixed(2)}, TTL ${r.config.ttlSeconds}s).`
          : `Config saved locally (threshold ${r.config.threshold.toFixed(2)}, TTL ${r.config.ttlSeconds}s). Proxy sync pending wiring.`,
        kind: "ok",
      });
      void refresh();
    } catch (err) {
      setToast({ msg: `Save failed: ${err instanceof Error ? err.message : "unavailable"}`, kind: "err" });
    }
  }

  async function onFlushConfirm() {
    if (flushing) return;
    try {
      const r = await flush(flushScope, flushValue.trim());
      const total = r.purged.exactRemoved + r.purged.semanticRemoved;
      setToast({
        msg: r.flushed
          ? `Flushed ${total} ${total === 1 ? "entry" : "entries"} (${flushScope}).`
          : (r.note ?? "Flush not applied — proxy route pending."),
        kind: r.flushed ? "ok" : "err",
      });
      setConfirmOpen(false);
      void refresh();
    } catch (err) {
      setToast({ msg: `Flush failed: ${err instanceof Error ? err.message : "unavailable"}`, kind: "err" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cache</h1>
          <p className="text-sm text-zinc-500">Stop paying twice — exact + semantic hit analytics.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800"
            title={connected ? "Saver stats live from the proxy" : "Saver not yet wired into the proxy chain"}
          >
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-400"}`} />
            {connected ? "Saver live" : "Saver stub"}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800"
            title={`Realtime feed: ${rtStatus}`}
          >
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${rtStatus === "open" ? "bg-emerald-500" : "bg-zinc-400"}`} />
            {rtStatus === "open" ? "Realtime" : `SSE ${rtStatus}`}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {toast && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            toast.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {toast.msg}
        </p>
      )}

      {error && !loading && !stats && (
        <div role="alert" className="rounded-xl border border-red-300 p-5 dark:border-red-900">
          <p className="text-sm font-medium">Cache analytics unavailable ({error}).</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading cache analytics">
          <Skeleton label="hit rate" />
          <Skeleton label="saved" />
          <Skeleton label="hits" />
          <Skeleton label="latency" />
        </div>
      ) : (
        stats && (
          <>
            {!connected && (
              <p className="rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800">
                Saver not yet wired into the proxy chain — showing request context with zeroed cache fields. No hit
                rates are fabricated. Wiring: <span className="font-mono">internal/cache/WIRING.md</span>.
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Hit Rate" value={`${stats.hitRatePct.toFixed(1)}%`} sub={connected ? "last 7d" : "no live data yet"} invert={false} />
              <StatCard label="Saved" value={fmtUSD(stats.savedWeekUsd)} sub="ROI headline · this week" invert={false} />
              <StatCard label="Hits" value={stats.hits.toLocaleString()} sub="last 7d" invert={false} />
              <StatCard
                label="Avg latency"
                value={stats.avgLookupMs == null ? "—" : `${stats.avgLookupMs.toFixed(1)}ms`}
                sub={stats.avgLookupMs == null ? "no live data yet" : "lookup overhead"}
                invert={false}
              />
            </div>

            <section aria-label="Exact vs semantic, 7 days" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Exact vs semantic · 7d</h2>
              <CacheHitRate series={stats.series7d} />
            </section>

            <CachePanel
              hitRatePct={stats.hitRatePct}
              hits={stats.hits}
              misses={stats.misses}
              savedUSD={stats.savedUsd}
              savedWeekUSD={stats.savedWeekUsd}
              windowLabel="last 7d"
              cacheSize={stats.cacheSize}
              avgLookupMs={stats.avgLookupMs ?? undefined}
              threshold={stats.threshold}
              topQueries={stats.topQueries}
            />
          </>
        )
      )}

      <section aria-label="Live traffic" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Live traffic</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {rtStatus === "open"
              ? "No requests in the live window yet — send traffic through the proxy to see it here."
              : `Realtime feed ${rtStatus} — live requests will appear here once connected.`}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {requests.map((e) =>
              e.type === "request" ? (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="font-mono text-xs tabular-nums text-zinc-500">#{e.id}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.model}</span>
                  <span className="truncate text-zinc-500">{e.agent || "—"}</span>
                  <span className="font-mono tabular-nums">{fmtUSD(e.costUsd)}</span>
                </li>
              ) : null
            )}
          </ul>
        )}
      </section>

      <section aria-label="Cache configuration" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Configuration</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Source: {configSource === "stored" ? "saved in Postgres" : "defaults (nothing saved yet)"}.
        </p>
        {draft && (
          <form onSubmit={onSave} className="grid max-w-lg grid-cols-1 gap-4">
            <label className="text-sm" htmlFor="cache-threshold">
              <span className="mb-1 block font-medium">
                Semantic threshold (0.80–0.99): <output htmlFor="cache-threshold" className="font-mono tabular-nums">{draft.threshold.toFixed(2)}</output>
              </span>
              <input
                id="cache-threshold"
                type="range"
                min={0.8}
                max={0.99}
                step={0.01}
                value={draft.threshold}
                onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
                aria-label="Semantic threshold"
                className="w-full"
              />
            </label>
            <label className="text-sm" htmlFor="cache-ttl">
              <span className="mb-1 block font-medium">Default TTL (seconds)</span>
              <input
                id="cache-ttl"
                type="number"
                min={60}
                max={30 * 86400}
                step={60}
                value={draft.ttlSeconds}
                onChange={(e) => setDraft({ ...draft, ttlSeconds: Number(e.target.value) })}
                aria-label="Default TTL seconds"
                className="w-40 rounded-md border border-zinc-300 px-3 py-1.5 font-mono tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.guardEnabled}
                onChange={(e) => setDraft({ ...draft, guardEnabled: e.target.checked })}
                aria-label="Unique-context guard enabled"
                className="h-4 w-4"
              />
              <span className="font-medium">Unique-context guard (skip PII-like prompts)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 dark:border-red-900"
              >
                Flush cache…
              </button>
            </div>
          </form>
        )}
      </section>

      {confirmOpen && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="flush-title" className="rounded-xl border border-red-300 p-5 dark:border-red-900">
          <h2 id="flush-title" className="text-base font-semibold">Flush cache?</h2>
          <p className="mt-1 text-sm text-zinc-500">
            This purges cached responses from the proxy saver. Scoped flushes only remove matching entries; “all”
            drops everything. This cannot be undone.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor="flush-scope">
              <span className="sr-only">Flush scope</span>
              <select
                id="flush-scope"
                ref={scopeRef}
                value={flushScope}
                onChange={(e) => setFlushScope(e.target.value as FlushScope)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {FLUSH_SCOPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {flushScope !== "all" && (
              <label className="text-sm" htmlFor="flush-value">
                <span className="sr-only">Scope value</span>
                <input
                  id="flush-value"
                  type="text"
                  value={flushValue}
                  onChange={(e) => setFlushValue(e.target.value)}
                  placeholder={flushScope === "agent" ? "agent id" : flushScope === "team" ? "team id" : "model name"}
                  className="w-48 rounded-md border border-zinc-300 px-3 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onFlushConfirm}
              disabled={flushing || (flushScope !== "all" && flushValue.trim() === "")}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {flushing ? "Flushing…" : "Confirm flush"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
