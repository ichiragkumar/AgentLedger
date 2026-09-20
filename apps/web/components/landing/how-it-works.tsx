"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function useInView<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function SeeBars() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const bars = [
    { label: "Mon", value: 34 },
    { label: "Tue", value: 52 },
    { label: "Wed", value: 44 },
    { label: "Thu", value: 71 },
    { label: "Fri", value: 63 },
  ];
  return (
    <div ref={ref} className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Spend by day</span>
        <span className="mono font-mono text-sm font-bold tabular-nums text-zinc-950 dark:text-white">
          $486.20
        </span>
      </div>
      <div className="flex h-28 items-end gap-2" role="img" aria-label="Daily spend bar chart, Thursday highest">
        {bars.map((b) => (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-24 w-full items-end rounded bg-zinc-100 dark:bg-zinc-800">
              <div
                className="w-full rounded bg-indigo-600 transition-all duration-700 ease-out dark:bg-indigo-500"
                style={{ height: inView ? `${b.value}%` : "4%" }}
              />
            </div>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SaveChart() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="space-y-3 p-5" role="img" aria-label="Before 920 dollars, after 349 dollars per month">
      {[
        { label: "Before", cost: "$920.00", width: 100, tone: "bg-red-500" },
        { label: "After", cost: "$349.00", width: 38, tone: "bg-emerald-500" },
      ].map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">{r.label}</span>
            <span className="mono font-mono tabular-nums text-zinc-800 dark:text-zinc-200">{r.cost}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={cn("h-full rounded-full transition-all duration-700 ease-out", r.tone)}
              style={{ width: inView ? `${r.width}%` : "4%" }}
            />
          </div>
        </div>
      ))}
      <p className="mono pt-1 font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
        −62% · saves $571/mo
      </p>
    </div>
  );
}

const STEPS = ["point", "see", "save"] as const;

export default function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">HOW IT WORKS</p>
          <h2 id="how-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
            Live in three steps.
          </h2>
        </div>
        <ol className="mt-12 space-y-6">
          {/* 01 Point */}
          <li className="grid items-center gap-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-2 md:p-8">
            <div className="order-1">
              <p className="mono font-mono text-sm font-bold tabular-nums text-indigo-600 dark:text-indigo-400">01</p>
              <h3 className="mt-1 text-xl font-semibold text-zinc-950 dark:text-white">Point your agents at the proxy.</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                One environment variable. No SDK, no code changes, no redeploy.
              </p>
            </div>
            <div className="order-2 rounded-md bg-zinc-950 p-4 font-mono text-[13px] leading-6 text-zinc-100">
              <span className="text-zinc-500"># one env var, nothing else changes</span>
              <br />
              <span className="text-emerald-400">$</span> export OPENAI_BASE_URL=agentledger:8787/v1
            </div>
          </li>
          {/* 02 See */}
          <li className="grid items-center gap-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-2 md:p-8">
            <div className="order-1 md:order-2">
              <p className="mono font-mono text-sm font-bold tabular-nums text-indigo-600 dark:text-indigo-400">02</p>
              <h3 className="mt-1 text-xl font-semibold text-zinc-950 dark:text-white">See every token, agent, and cent.</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Real spend by agent, model, and team — sub-millisecond overhead.
              </p>
            </div>
            <div className="order-2 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800 md:order-1">
              <SeeBars />
            </div>
          </li>
          {/* 03 Save */}
          <li className="grid items-center gap-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-2 md:p-8">
            <div className="order-1">
              <p className="mono font-mono text-sm font-bold tabular-nums text-indigo-600 dark:text-indigo-400">03</p>
              <h3 className="mt-1 text-xl font-semibold text-zinc-950 dark:text-white">Cut spend 40–70%.</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Semantic cache plus smart routing. Same output, smaller bill.
              </p>
            </div>
            <div className="order-2 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
              <SaveChart />
            </div>
          </li>
        </ol>
        <span className="sr-only">{STEPS.join(" ")}</span>
      </div>
    </section>
  );
}
