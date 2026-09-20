import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = () =>
  pageMetadata({
    title: "Changelog",
    description: "AgentLedger changelog — every ship, from the Mirror to the Brain.",
    path: "/changelog",
  });

const ENTRIES = [
  {
    version: "v0.1.0",
    date: "2026-09-20",
    title: "The Mirror is live",
    notes: [
      "One-env-var Go proxy attributing every token dollar by agent, team, and model.",
      "Live cost dashboard: spend trends, per-agent breakdown, request log.",
      "Apache-2.0 open source — self-host with Docker Compose.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← AgentLedger
      </a>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Changelog</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Every ship, from “I can finally see…” onward.
      </p>
      <ol className="mt-8 space-y-8">
        {ENTRIES.map((e) => (
          <li key={e.version} className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 font-mono text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                {e.version}
              </span>
              <h2 className="text-xl font-semibold">{e.title}</h2>
              <time className="ml-auto text-xs text-zinc-500">{e.date}</time>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-6 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
              {e.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}
