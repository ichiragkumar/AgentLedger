import Link from "next/link";

export default function Cta() {
  return (
    <section aria-labelledby="cta-heading" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24">
      <div className="rounded-xl bg-indigo-600 px-6 py-14 text-center dark:bg-indigo-500">
        <h2 id="cta-heading" className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Stop guessing. Start seeing.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-pretty text-indigo-100">
          One env var. Five minutes. Your first savings report tonight.
        </p>
        <Link
          href="/signup"
          className="mt-7 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
        >
          Get Started Free
        </Link>
        <p className="mt-4 text-xs text-indigo-200">
          No credit card · no lock-in · open source forever
        </p>
      </div>
    </section>
  );
}
