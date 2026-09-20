"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "Which agents are compatible?",
    a: "Anything speaking the OpenAI API. One env var points it at the proxy — LangChain, CrewAI, raw SDKs all work.",
  },
  {
    q: "Does it slow my agents down?",
    a: "No. The Go proxy adds under 1ms at p99. Your agents won't notice it's there.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. Self-hosted by default — prompts and completions never leave your network.",
  },
  {
    q: "How is this different from Portkey or LiteLLM?",
    a: "They show the bill, we cut it. Caching plus routing plus hard budgets in one proxy.",
  },
  {
    q: "What happens when a budget is hit?",
    a: "Alert at 75%, auto-downgrade at 90%, hard stop at 100%. Runaway loops get killed first.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section aria-labelledby="faq-heading" className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
      <div className="text-center">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">FAQ</p>
        <h2 id="faq-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
          Questions, answered.
        </h2>
      </div>
      <div className="mt-8 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {FAQS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <h3>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  id={`faq-button-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/50"
                >
                  {f.q}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className={cn("shrink-0 transition-transform duration-200", isOpen && "rotate-180")}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </h3>
              <div
                id={`faq-panel-${i}`}
                role="region"
                aria-labelledby={`faq-button-${i}`}
                hidden={!isOpen}
                className="px-5 pb-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400"
              >
                {f.a}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
