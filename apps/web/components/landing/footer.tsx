import Link from "next/link";
import Logo from "@/components/shared/logo";
import ThemeToggle from "@/components/shared/theme-toggle";

const COLS: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
      { label: "Waitlist", href: "/waitlist" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Blog", href: "/blog" },
      { label: "GitHub", href: "https://github.com/anomalyco/AgentLedger", external: true },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Open Source", href: "/#open-source" },
      { label: "Contact", href: "mailto:hello@agentledger.dev", external: true },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.2fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              TokenOps control plane. We don&apos;t show the bill, we cut it.
            </p>
            <div className="mt-4">
              <ThemeToggle />
            </div>
          </div>
          {COLS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{col.title}</p>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a
                        href={l.href}
                        target={l.href.startsWith("http") ? "_blank" : undefined}
                        rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        href={l.href}
                        className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-zinc-200 pt-6 text-xs text-zinc-500 sm:flex-row dark:border-zinc-800 dark:text-zinc-500">
          <p>© 2026 AgentLedger · Apache 2.0</p>
          <p className="flex gap-4">
            <Link href="/docs/privacy" className="hover:text-zinc-800 dark:hover:text-zinc-300">Privacy</Link>
            <Link href="/docs/terms" className="hover:text-zinc-800 dark:hover:text-zinc-300">Terms</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
