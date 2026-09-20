"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function Card({
  index,
  shown,
  title,
  kicker,
  body,
  badge,
  children,
}: {
  index: number;
  shown: boolean;
  title: string;
  kicker: string;
  body: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        "group rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition-all duration-500 hover:border-indigo-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500",
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
      style={{ transitionDelay: shown ? `${index * 90}ms` : "0ms" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-indigo-600 dark:text-indigo-400">{kicker}</p>
        {badge && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            {badge}
          </span>
        )}
      </div>
      <h3 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{body}</p>
      <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        {children}
      </div>
    </article>
  );
}

export default function FeaturesBento() {
  const { ref, shown } = useReveal<HTMLDivElement>();

  return (
    <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">FEATURES</p>
        <h2 id="features-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
          Observe. Optimize. Enforce.
        </h2>
      </div>

      <div ref={ref} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card index={0} shown={shown} kicker="OBSERVE" title="Every token, agent, cent" body="Full request log with cost attribution by agent, team, and model.">
          <div className="flex h-20 items-end gap-1.5 p-3" role="img" aria-label="Token volume mini chart">
            {[35, 55, 42, 70, 60, 88, 74].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-indigo-600/80 dark:bg-indigo-500/80" style={{ height: `${h}%` }} />
            ))}
          </div>
        </Card>

        <Card index={1} shown={shown} kicker="CACHE" title="Stop paying twice" body="Semantic cache serves repeats. 30–60% fewer model calls.">
          <div className="flex items-center gap-3 p-4" role="img" aria-label="Cache hit rate 47 percent">
            <div className="relative h-14 w-14 shrink-0">
              <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3.5" className="stroke-zinc-200 dark:stroke-zinc-800" />
                <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="47, 100" className="stroke-emerald-500" />
              </svg>
              <span className="mono absolute inset-0 flex items-center justify-center font-mono text-xs font-bold tabular-nums text-zinc-800 dark:text-zinc-200">47%</span>
            </div>
            <p className="mono font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">$212 saved<br />this week</p>
          </div>
        </Card>

        <Card index={2} shown={shown} kicker="ROUTE" title="Right model, right price" body="Auto-tier: cheap models first, frontier only when it matters.">
          <div className="space-y-1.5 p-4 text-xs font-medium" role="img" aria-label="Routing tiers: cheap, balanced, frontier">
            <div className="flex items-center justify-between rounded bg-emerald-500/10 px-2.5 py-1.5 text-emerald-700 dark:text-emerald-400"><span>cheap</span><span className="mono font-mono tabular-nums">71%</span></div>
            <div className="flex items-center justify-between rounded bg-amber-500/10 px-2.5 py-1.5 text-amber-700 dark:text-amber-400"><span>balanced</span><span className="mono font-mono tabular-nums">22%</span></div>
            <div className="flex items-center justify-between rounded bg-red-500/10 px-2.5 py-1.5 text-red-600 dark:text-red-400"><span>frontier</span><span className="mono font-mono tabular-nums">7%</span></div>
          </div>
        </Card>

        <Card index={3} shown={shown} kicker="ENFORCE" title="Budgets that bite" body="Alerts at 75%, downgrade at 90%, hard stop at 100%. Loop kill included.">
          <div className="p-4" role="img" aria-label="Budget burndown at 68 percent">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">team-frontend · June</span>
              <span className="mono font-mono tabular-nums text-zinc-700 dark:text-zinc-300">$680 / $1,000</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full w-[68%] rounded-full bg-amber-500" />
            </div>
          </div>
        </Card>

        <Card index={4} shown={shown} kicker="TOPOLOGY" title="See the swarm" body="Agent call graph: who calls whom, what it costs." badge="Coming · Q4 2026">
          <div className="flex items-center justify-center gap-4 p-4" role="img" aria-label="Agent graph preview">
            <span className="h-8 w-8 rounded-full bg-indigo-600" />
            <span aria-hidden="true" className="h-px w-8 bg-zinc-300 dark:bg-zinc-700" />
            <span className="h-6 w-6 rounded-full bg-emerald-500" />
            <span aria-hidden="true" className="h-px w-8 bg-zinc-300 dark:bg-zinc-700" />
            <span className="h-6 w-6 rounded-full bg-amber-500" />
          </div>
        </Card>

        <Card index={5} shown={shown} kicker="KEY VAULT" title="Keys stay on your server" body="Virtual keys per agent. Real provider keys never leave your infra.">
          <div className="flex items-center gap-2 p-4 font-mono text-xs">
            <span className="rounded bg-zinc-200 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">sk-virtual-•••9f2</span>
            <span aria-hidden="true" className="text-zinc-400">→</span>
            <span className="rounded border border-dashed border-zinc-300 px-2 py-1 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">vault</span>
          </div>
        </Card>
      </div>
    </section>
  );
}
