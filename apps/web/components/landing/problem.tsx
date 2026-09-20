"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CARDS = [
  {
    stat: "$4,200",
    body: "Last month's token bill, up 38%. Nobody can say why.",
  },
  {
    stat: "???",
    body: "Which agent? Which team? Which model? One invoice, zero answers.",
  },
  {
    stat: "$800",
    body: "One agent looped at 11pm on a Friday. Found on Monday.",
  },
];

export default function Problem() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="problem-heading" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">THE PROBLEM</p>
        <h2 id="problem-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
          You don&apos;t know where the money goes.
        </h2>
      </div>
      <div ref={ref} className="mt-10 grid gap-4 md:grid-cols-3">
        {CARDS.map((c, i) => (
          <article
            key={c.stat + i}
            className={cn(
              "rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition-all duration-500 dark:border-zinc-800 dark:bg-zinc-900",
              visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            )}
            style={{ transitionDelay: visible ? `${i * 150}ms` : "0ms" }}
          >
            <p className="mono font-mono text-3xl font-bold tabular-nums text-zinc-950 dark:text-white">
              {c.stat}
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{c.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
