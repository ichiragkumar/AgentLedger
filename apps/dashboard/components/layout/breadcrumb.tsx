"use client";

// Breadcrumb — ledger-web-dashboard owner (spec 17 shell).
// Derives crumbs from the URL; no data fetching.

import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  overview: "Overview",
  agents: "Agents",
  cache: "Cache",
  routing: "Routing",
  budgets: "Budgets",
  policies: "Policies",
  keys: "Keys",
  topology: "Topology",
  requests: "Requests",
  settings: "Settings",
};

export default function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="border-b border-zinc-200 bg-white px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <ol className="flex flex-wrap items-center gap-1 text-zinc-500">
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const isLast = i === segments.length - 1;
          const label = LABELS[seg] ?? (segments[i - 1] === "agents" ? `Agent ${seg}` : seg);
          return (
            <li key={href} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {isLast ? (
                <span aria-current="page" className="font-medium text-zinc-900 dark:text-zinc-100">
                  {label}
                </span>
              ) : (
                <Link href={href} className="hover:underline">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
