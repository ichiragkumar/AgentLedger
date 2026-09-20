"use client";

/**
 * Pricing section — §10 (owner: ledger-web-journey).
 *
 * Values EXACTLY per spec 15 (single source of truth — web + docs match):
 * Free $0 · Pro $49/mo · Enterprise Custom. Annual −20%.
 * Pro highlighted. Enterprise = Calendly/email link-out (no custom form).
 *
 * NOTE — spec 10 lists a 4-tier ladder (Pro 500K logs / Business $199 5M
 * logs). Spec 15 (declared canonical) folds that into Pro with 5M logs and
 * no $199 tier. This component follows spec 15; any value change needs
 * human approval per ownership rules.
 */

import { useState } from "react";
import { Check } from "lucide-react";

export interface PricingTier {
  name: string;
  monthly: number | null; // null = custom
  blurb: string;
  features: string[];
  cta: string;
  href: string;
  highlighted?: boolean;
  footnote?: string;
}

/** Enterprise link-outs — confirm Calendly URL at launch. */
export const ENTERPRISE_CALENDLY_URL = "https://calendly.com/agentledger/intro";
export const ENTERPRISE_EMAIL = "enterprise@agentledger.io";

export const ANNUAL_DISCOUNT = 0.2;

export const PRICING_TIERS: PricingTier[] = [
  {
    name: "Free",
    monthly: 0,
    blurb: "Open source. Self-hosted. Yours.",
    features: ["Proxy + caching", "Basic dashboard", "1 team", "500K logs", "Community support"],
    cta: "Get started",
    href: "/waitlist",
    footnote: "No credit card required",
  },
  {
    name: "Pro",
    monthly: 49,
    blurb: "For startups and small teams cutting spend.",
    features: [
      "Unlimited teams",
      "Intelligent routing",
      "Budget enforcement",
      "5M logs",
      "Email support",
    ],
    cta: "Start Pro trial",
    href: "/waitlist",
    highlighted: true,
  },
  {
    name: "Enterprise",
    monthly: null,
    blurb: "For banks, healthcare, Fortune 500.",
    features: ["SSO + SOC 2", "Self-hosted at scale", "SLA", "White-label", "Dedicated support"],
    cta: "Talk to us",
    href: ENTERPRISE_CALENDLY_URL,
  },
];

export function annualPrice(monthly: number): number {
  return Math.round(monthly * (1 - ANNUAL_DISCOUNT));
}

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section aria-labelledby="pricing-heading" className="mx-auto w-full max-w-5xl px-6 py-20">
      <p className="text-center text-sm font-medium tracking-wide text-zinc-500 uppercase">
        Pricing
      </p>
      <h2 id="pricing-heading" className="mt-2 text-center text-3xl font-semibold tracking-tight text-balance">
        We don’t show the bill. We cut it.
      </h2>

      {/* Annual/monthly toggle */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <span id="billing-label" className="text-sm text-zinc-500">
          Monthly
        </span>
        <button
          role="switch"
          aria-checked={annual}
          aria-labelledby="billing-label billing-state"
          onClick={() => setAnnual((a) => !a)}
          className={`relative h-6 w-11 rounded-full transition-colors ${annual ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
        >
          <span
            aria-hidden
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${annual ? "translate-x-5" : ""}`}
          />
        </button>
        <span id="billing-state" className="text-sm font-medium">
          Annual <span className="text-green-600 dark:text-green-400">−20%</span>
        </span>
      </div>

      {/* Cards */}
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {PRICING_TIERS.map((tier) => {
          const price =
            tier.monthly === null
              ? "Custom"
              : tier.monthly === 0
                ? "$0"
                : `$${annual ? annualPrice(tier.monthly) : tier.monthly}`;
          const suffix =
            tier.monthly === null || tier.monthly === 0
              ? tier.monthly === 0
                ? " forever"
                : ""
              : "/mo" + (annual ? ", billed annually" : "");
          return (
            <article
              key={tier.name}
              aria-label={`${tier.name} plan`}
              className={`flex flex-col rounded-2xl border p-6 ${
                tier.highlighted
                  ? "border-green-500 bg-green-50/50 shadow-lg dark:border-green-500 dark:bg-green-950/20"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              }`}
            >
              <h3 className="text-lg font-semibold">{tier.name}</h3>
              <p className="mt-1 text-sm text-zinc-500">{tier.blurb}</p>
              <p className="mt-4">
                <span className="text-4xl font-bold tracking-tight tabular-nums">{price}</span>
                {suffix && <span className="text-sm text-zinc-500">{suffix}</span>}
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <Check size={14} aria-hidden className="shrink-0 text-green-500" /> {f}
                  </li>
                ))}
              </ul>
              <a
                href={tier.href}
                {...(tier.href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className={`mt-6 rounded-full px-5 py-2.5 text-center text-sm font-medium transition-colors ${
                  tier.highlighted
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                {tier.cta}
              </a>
              {tier.footnote && (
                <p className="mt-2 text-center text-xs text-zinc-500">{tier.footnote}</p>
              )}
            </article>
          );
        })}
      </div>

      {/* Comparison table */}
      <div className="mt-10 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Plan comparison</caption>
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th scope="col" className="py-2 pr-4 font-medium text-zinc-500">Feature</th>
              <th scope="col" className="py-2 pr-4 font-medium">Free</th>
              <th scope="col" className="py-2 pr-4 font-medium">Pro</th>
              <th scope="col" className="py-2 font-medium">Enterprise</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Price", "$0", annual ? "$39/mo annual" : "$49/mo", "Custom"],
              ["Teams", "1", "Unlimited", "Unlimited"],
              ["Logged requests", "500K", "5M", "Unlimited"],
              ["Smart routing", "—", "Yes", "Yes + topology-aware"],
              ["Budget enforcement", "—", "Yes", "Yes + policies"],
              ["Support", "Community", "Email", "Dedicated engineer"],
              ["Compliance", "—", "—", "SSO + SOC 2"],
            ].map(([feature, free, pro, ent]) => (
              <tr key={feature} className="border-b border-zinc-100 dark:border-zinc-900">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-zinc-500">{feature}</th>
                <td className="py-2 pr-4">{free}</td>
                <td className="py-2 pr-4 font-medium">{pro}</td>
                <td className="py-2">{ent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Enterprise?{" "}
        <a href={ENTERPRISE_CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          Book a call
        </a>{" "}
        or email{" "}
        <a href={`mailto:${ENTERPRISE_EMAIL}`} className="underline underline-offset-2">
          {ENTERPRISE_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}

export default Pricing;
