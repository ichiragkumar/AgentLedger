import Link from "next/link";
import Typewriter from "@/components/shared/typewriter";

const TERMINAL_LINES = [
  "$ export OPENAI_BASE_URL=agentledger:8787/v1",
  "# Done. Your agents are being tracked.",
];

const PROVIDERS = ["OpenAI", "Anthropic", "Google", "DeepSeek", "Mistral"];

const PREVIEW_ROWS = [
  { agent: "support-triage", model: "gpt-4o-mini", cost: "$312.44", width: 82 },
  { agent: "code-review", model: "claude-sonnet", cost: "$198.10", width: 54 },
  { agent: "data-sync", model: "deepseek-chat", cost: "$41.07", width: 22 },
];

export default function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden pt-28 sm:pt-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-600/10 via-transparent to-transparent dark:from-indigo-500/10"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <p
            className="animate-[fadeUp_.1s_ease-out_both] rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            style={{ animationDelay: "100ms" }}
          >
            v0.1 — Open Source · Apache 2.0
          </p>
          {/* H1: 6 words (≤7 per spec 16 §02) */}
          <h1
            id="hero-heading"
            className="mt-5 animate-[fadeUp_.2s_ease-out_both] text-balance text-4xl font-bold tracking-tight text-zinc-950 sm:text-5xl dark:text-white"
            style={{ animationDelay: "200ms" }}
          >
            Your AI agents are bleeding money.
          </h1>
          <p
            className="mt-4 animate-[fadeUp_.3s_ease-out_both] text-pretty text-lg text-zinc-600 dark:text-zinc-400"
            style={{ animationDelay: "300ms" }}
          >
            One proxy. Full visibility. 40–70% less spend.
          </p>
          <div
            className="mt-7 flex animate-[fadeUp_.4s_ease-out_both] flex-col items-center gap-3 sm:flex-row"
            style={{ animationDelay: "400ms" }}
          >
            <Link
              href="/signup"
              className="inline-flex h-11 items-center rounded-md bg-indigo-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              Get Started Free
            </Link>
            <a
              href="https://github.com/anomalyco/AgentLedger"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-zinc-200 px-6 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.15c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-4 pb-4 lg:grid-cols-2">
          {/* Terminal — typewriter completes in <3s total, copy button copies real command */}
          <div
            className="animate-[fadeUp_.6s_ease-out_both] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-left shadow-xl"
            style={{ animationDelay: "600ms" }}
          >
            <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
              <span aria-hidden="true" className="h-3 w-3 rounded-full bg-zinc-700" />
              <span aria-hidden="true" className="h-3 w-3 rounded-full bg-zinc-700" />
              <span aria-hidden="true" className="h-3 w-3 rounded-full bg-zinc-700" />
              <span className="ml-2 font-mono text-xs text-zinc-500">terminal</span>
            </div>
            <div className="p-4 text-zinc-100">
              <Typewriter
                lines={TERMINAL_LINES}
                copyText="export OPENAI_BASE_URL=agentledger:8787/v1"
                startDelayMs={600}
              />
            </div>
          </div>

          {/* Mini dashboard preview — real UI markup, not a screenshot */}
          <div
            aria-label="AgentLedger dashboard preview"
            className="animate-[fadeUp_.8s_ease-out_both] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            style={{ animationDelay: "800ms" }}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                LIVE OVERVIEW
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                tracking
              </span>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Today&apos;s spend</span>
                <span className="mono font-mono text-xl font-bold tabular-nums text-zinc-950 dark:text-white">
                  $551.61
                </span>
              </div>
              {PREVIEW_ROWS.map((r) => (
                <div key={r.agent}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {r.agent} · {r.model}
                    </span>
                    <span className="mono font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                      {r.cost}
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={`${r.agent} spend ${r.cost}`}
                    className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                  >
                    <div
                      className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500"
                      style={{ width: `${r.width}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Providers as text (spec 16 §02) */}
        <div
          className="flex animate-[fadeUp_1s_ease-out_both] flex-wrap items-center justify-center gap-x-6 gap-y-2 pb-16 pt-6"
          style={{ animationDelay: "1000ms" }}
          aria-label="Supported providers"
        >
          {PROVIDERS.map((p) => (
            <span key={p} className="text-sm font-medium text-zinc-400 dark:text-zinc-500">
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
