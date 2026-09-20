"use client";

/**
 * Product Journey timeline — §08 (owner: ledger-web-journey).
 *
 * Horizontal dot timeline (LIVE filled green / BETA half blue / future
 * empty gray). Click → AnimatePresence card. Auto-cycles every 5s until
 * first interaction. Arrow-key nav. Mobile: horizontal dot scroll +
 * stacked cards. "Coming" phases show dates, never TBD.
 *
 * Copy: taglines per spec 15 table, through-line quotes per spec 11.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type PhaseStatus = "live" | "beta" | "building" | "planned";

export interface JourneyPhase {
  index: string;
  name: string;
  status: PhaseStatus;
  statusLabel: string;
  tagline: string;
  dateLabel: string;
  ships: string;
  checklist: string[];
  /** Through-line voice-of-customer quote (spec 11). */
  voice: string;
}

export const JOURNEY_PHASES: JourneyPhase[] = [
  {
    index: "01",
    name: "The Mirror",
    status: "live",
    statusLabel: "Live",
    tagline: "See every dollar",
    dateLabel: "Shipped · Week 2",
    ships: "Drop-in Go proxy + live cost dashboard. Every token, agent, and cent attributed.",
    checklist: ["One-env-var proxy", "Per-agent / team / model spend", "Ship → Show HN"],
    voice: "I can finally see where my AI money goes",
  },
  {
    index: "02",
    name: "The Saver",
    status: "live",
    statusLabel: "Live",
    tagline: "Stop paying twice",
    dateLabel: "Shipped · Week 5",
    ships: "Semantic + exact caching inside the proxy. Near-duplicate calls never reach the provider.",
    checklist: ["Semantic cache", "30–60% fewer calls", "Ship → Blog + Show HN"],
    voice: "I stopped paying for duplicate calls",
  },
  {
    index: "03",
    name: "The Router",
    status: "beta",
    statusLabel: "Beta",
    tagline: "Right model, right price",
    dateLabel: "Beta · Week 9",
    ships: "Tier-aware routing: cheap models by default, frontier only when quality demands it.",
    checklist: ["Quality-gated routing", "60% bill cut, no quality drop", "Ship → Product Hunt"],
    voice: "I cut my bill in half without touching my agents",
  },
  {
    index: "04",
    name: "The Enforcer",
    status: "building",
    statusLabel: "Building",
    tagline: "Never blow budget again",
    dateLabel: "Building · Week 13",
    ships: "Hard budgets with teeth: 75% alert, 90% downgrade, 100% stop — plus runaway-loop kill.",
    checklist: ["Budget policies", "Loop detection + kill", "Ship → Enterprise pilots"],
    voice: "I set a budget and it actually enforced itself",
  },
  {
    index: "05",
    name: "The Brain",
    status: "planned",
    statusLabel: "Coming Q4 2026",
    tagline: "See the swarm, not the request",
    dateLabel: "Coming · Q4 2026",
    ships: "Workflow-aware intelligence: topology graphs, ROI attribution, agents that learn your patterns.",
    checklist: ["Agent topology graph", "ROI signals", "Ship → Case study"],
    voice: "AgentLedger knows my workflow better than I do",
  },
  {
    index: "06",
    name: "The Business",
    status: "planned",
    statusLabel: "Coming 2027",
    tagline: "Enterprise ready",
    dateLabel: "Coming · 2027",
    ships: "SSO, SOC 2, self-hosted scale, SLA — plus hosted cloud for teams that want zero ops.",
    checklist: ["SSO + SOC 2", "Hosted cloud launch", "Ship → Cloud GA"],
    voice: "Procurement said yes in a week",
  },
];

const AUTO_CYCLE_MS = 5000;

function dotClass(status: PhaseStatus, active: boolean): string {
  const ring = active ? " ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500" : "";
  switch (status) {
    case "live":
      return `bg-green-500 border-green-500${ring}`;
    case "beta":
      // Half-blue BETA: blue over gray via gradient.
      return `border-blue-500 bg-gradient-to-r from-blue-500 from-50% to-zinc-300 to-50% dark:to-zinc-700${ring}`;
    case "building":
      return `border-yellow-500 bg-yellow-500/40${ring}`;
    case "planned":
      return `border-zinc-400 bg-transparent dark:border-zinc-600${ring}`;
  }
}

export function ProductJourney() {
  const [active, setActive] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const phase = JOURNEY_PHASES[active];

  // Auto-cycle 5s until first interaction (spec 16 §08).
  useEffect(() => {
    if (interacted) return;
    const id = setInterval(() => {
      setActive((a) => (a + 1) % JOURNEY_PHASES.length);
    }, AUTO_CYCLE_MS);
    return () => clearInterval(id);
  }, [interacted]);

  const select = useCallback((i: number) => {
    setInteracted(true);
    setActive((i + JOURNEY_PHASES.length) % JOURNEY_PHASES.length);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        select(active + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        select(active - 1);
      }
    },
    [active, select],
  );

  return (
    <section aria-labelledby="product-journey-heading" className="mx-auto w-full max-w-5xl px-6 py-20">
      <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
        Product journey
      </p>
      <h2 id="product-journey-heading" className="mt-2 text-3xl font-semibold tracking-tight text-balance">
        From “I can finally see…” to “…knows my workflow better than I do”
      </h2>

      {/* Timeline dots */}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Product phases"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="mt-8 flex items-center gap-3 overflow-x-auto pb-2 focus:outline-none sm:gap-4"
      >
        {JOURNEY_PHASES.map((p, i) => (
          <button
            key={p.index}
            role="tab"
            aria-selected={i === active}
            aria-label={`${p.index} ${p.name} — ${p.statusLabel}`}
            onClick={() => select(i)}
            className="group flex shrink-0 flex-col items-center gap-2 rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <span
              className={`h-4 w-4 rounded-full border-2 transition-transform group-hover:scale-110 ${dotClass(p.status, i === active)}`}
            />
            <span className="text-xs font-medium text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
              {p.index}
            </span>
          </button>
        ))}
        {/* Connector line sits behind dots on desktop */}
        <span aria-hidden className="mx-2 hidden h-px flex-1 bg-zinc-200 sm:block dark:bg-zinc-800" />
      </div>

      {/* Card */}
      <div className="mt-6 min-h-[280px]">
        <AnimatePresence mode="wait">
          <motion.article
            key={phase.index}
            role="tabpanel"
            aria-label={`${phase.name} details`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-zinc-400">{phase.index}</span>
              <h3 className="text-xl font-semibold">{phase.name}</h3>
              <span className="rounded-full border border-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                {phase.statusLabel}
              </span>
              <span className="ml-auto text-xs text-zinc-500">{phase.dateLabel}</span>
            </div>
            <p className="mt-2 text-lg text-zinc-900 dark:text-zinc-100">{phase.tagline}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {phase.ships}
            </p>
            <ul className="mt-4 space-y-1.5">
              {phase.checklist.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <span aria-hidden className="text-green-500">✓</span> {item}
                </li>
              ))}
            </ul>
            <blockquote className="mt-4 border-l-2 border-zinc-200 pl-3 text-sm text-zinc-500 italic dark:border-zinc-700">
              “{phase.voice}”
            </blockquote>
          </motion.article>
        </AnimatePresence>
      </div>

      {/* Arrows */}
      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => select(active - 1)}
          aria-label="Previous phase"
          className="rounded-full border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ← Prev
        </button>
        <span aria-hidden className="text-xs text-zinc-400">
          {active + 1} / {JOURNEY_PHASES.length}
        </span>
        <button
          onClick={() => select(active + 1)}
          aria-label="Next phase"
          className="rounded-full border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Next →
        </button>
      </div>
    </section>
  );
}

export default ProductJourney;
