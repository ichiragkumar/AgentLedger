import Link from "next/link";

/**
 * Branded 404 (F5 ship plumbing, owner: ledger-finish-proof).
 * Spec-18 tokens only. Links: home + docs.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-center">
      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        404 · page not found
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Lost track of this token?
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
        This URL isn&apos;t on the ledger. Head home to see where your AI money
        goes, or browse the docs to find what you need.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          className="rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Go home
        </Link>
        <Link
          href="/docs"
          className="rounded-[var(--radius)] border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:bg-secondary"
        >
          Read the docs
        </Link>
        <Link
          href="/pricing"
          className="rounded-[var(--radius)] px-4 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          Pricing
        </Link>
      </div>
    </main>
  );
}
