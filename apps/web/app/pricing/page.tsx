import { Pricing } from "@/components/landing/pricing";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = () =>
  pageMetadata({
    title: "Pricing",
    description:
      "Free $0 for open source, Pro $49/mo with 20% off annual, Enterprise custom. We don't show the bill — we cut it.",
    path: "/pricing",
  });

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← AgentLedger
      </a>
      <Pricing />
      <section aria-label="Pricing FAQ" className="mx-auto max-w-3xl pb-16">
        <h2 className="text-xl font-semibold">Questions, answered briefly</h2>
        <dl className="mt-4 space-y-4 text-sm leading-6">
          <div>
            <dt className="font-medium">Do I need a credit card for Free?</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">
              No. Free is Apache-2.0 open source — self-host it and keep your data.
            </dd>
          </div>
          <div>
            <dt className="font-medium">What counts as a logged request?</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">
              One proxied completion (cache hits included). Pro covers 5M/month; Enterprise is unlimited.
            </dd>
          </div>
          <div>
            <dt className="font-medium">What happens when I hit my budget?</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">
              75% alert, 90% automatic downgrade, 100% stop. The budget enforces itself.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
