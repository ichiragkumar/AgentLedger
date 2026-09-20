"use client";

/**
 * Numbers band — §09 (owner: ledger-web-journey).
 *
 * `$2.4M+ tracked · 340M+ tokens optimized · 62% avg reduction · 400+ agents`.
 * Count-up on scroll-in (rAF, once), compact notation, border top/bottom,
 * aria-live announces final values.
 *
 * Data: tries public `/api/stats` (backend-owned, cached) with seeded
 * fallback so the section never renders empty. Integration status:
 * PENDING backend `/api/stats` — fallback values live until it ships.
 */

import { useEffect, useRef, useState } from "react";

interface Stats {
  trackedUsd: number;
  tokensOptimized: number;
  avgReductionPct: number;
  agentsConnected: number;
}

/** Seeded fallback = spec 16 §09 values. */
const FALLBACK_STATS: Stats = {
  trackedUsd: 2_400_000,
  tokensOptimized: 340_000_000,
  avgReductionPct: 62,
  agentsConnected: 400,
};

const COUNT_UP_MS = 1200;

function useCountUp(target: number, start: boolean): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / COUNT_UP_MS, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, target]);
  return value;
}

const compact = new Intl.NumberFormat("en", { notation: "compact" });

export function Numbers() {
  const [stats, setStats] = useState<Stats>(FALLBACK_STATS);
  const [inView, setInView] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Prefer real data when the backend endpoint exists.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats", { next: undefined } as RequestInit)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || cancelled) return;
        setStats({
          trackedUsd: Number(d.trackedUsd) || FALLBACK_STATS.trackedUsd,
          tokensOptimized: Number(d.tokensOptimized) || FALLBACK_STATS.tokensOptimized,
          avgReductionPct: Number(d.avgReductionPct) || FALLBACK_STATS.avgReductionPct,
          agentsConnected: Number(d.agentsConnected) || FALLBACK_STATS.agentsConnected,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll-in trigger, once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const tracked = useCountUp(stats.trackedUsd, inView);
  const tokens = useCountUp(stats.tokensOptimized, inView);
  const reduction = useCountUp(stats.avgReductionPct, inView);
  const agents = useCountUp(stats.agentsConnected, inView);

  useEffect(() => {
    if (!inView || done) return;
    const id = setTimeout(() => setDone(true), COUNT_UP_MS + 100);
    return () => clearTimeout(id);
  }, [inView, done]);

  const items = [
    { value: `$${compact.format(tracked)}+`, label: "tracked" },
    { value: `${compact.format(tokens)}+`, label: "tokens optimized" },
    { value: `${Math.round(reduction)}%`, label: "avg reduction" },
    { value: `${Math.round(agents)}+`, label: "agents" },
  ];

  return (
    <section
      ref={ref}
      aria-labelledby="numbers-heading"
      className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <h2 id="numbers-heading" className="sr-only">
        AgentLedger in numbers
      </h2>
      <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="text-center">
            <dt className="order-2 mt-1 block text-sm text-zinc-500">{item.label}</dt>
            <dd className="order-1 text-3xl font-bold tracking-tight tabular-nums">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {/* aria-live announces final values once count-up completes */}
      <span aria-live="polite" className="sr-only">
        {done
          ? `$${compact.format(stats.trackedUsd)}+ tracked, ${compact.format(stats.tokensOptimized)}+ tokens optimized, ${stats.avgReductionPct}% average reduction, ${stats.agentsConnected}+ agents.`
          : ""}
      </span>
    </section>
  );
}

export default Numbers;
