export default function OpenSource() {
  return (
    <section aria-labelledby="oss-heading" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">OPEN SOURCE</p>
        <h2 id="oss-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
          Open source. Self-hosted. Yours.
        </h2>
        <p className="mt-4 text-pretty leading-7 text-zinc-600 dark:text-zinc-400">
          Apache 2.0 licensed. Run it on your own infra — your prompts, completions, and spend
          data never leave your network.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="https://github.com/anomalyco/AgentLedger"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-zinc-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.15c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
            </svg>
            Star on GitHub
          </a>
          <a
            href="https://github.com/anomalyco/AgentLedger"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center rounded-md border border-zinc-200 px-6 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            View Source
          </a>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
          <a
            href="https://github.com/anomalyco/AgentLedger/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            LICENSE
          </a>{" "}
          · Apache 2.0
        </p>
      </div>
    </section>
  );
}
