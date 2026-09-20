import Link from "next/link";

/**
 * Branded 404 (F5 ship plumbing, owner: ledger-finish-proof).
 * Spec-18 tokens only. Links: /overview + docs.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-center">
      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        404 · page not found
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
        This ledger page doesn&apos;t exist
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        The route you asked for isn&apos;t metering anything. Head back to your
        overview, or check the docs to find the right view.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/overview"
          className="rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Back to overview
        </Link>
        <a
          href="https://agentledger.io/docs"
          className="rounded-[var(--radius)] border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:bg-secondary"
        >
          Read the docs
        </a>
      </div>
    </main>
  );
}
