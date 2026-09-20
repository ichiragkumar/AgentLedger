import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/metadata";

/**
 * sitemap.xml (F5 ship plumbing, owner: ledger-finish-proof).
 * Static routes only — no new deps. Blog slugs resolve via /blog/[slug];
 * add per-post entries here if per-URL lastModified is ever needed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }> = [
    { path: "/", priority: 1, changeFrequency: "daily" },
    { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
    { path: "/docs", priority: 0.8, changeFrequency: "weekly" },
    { path: "/blog", priority: 0.7, changeFrequency: "weekly" },
    { path: "/changelog", priority: 0.6, changeFrequency: "weekly" },
    { path: "/waitlist", priority: 0.5, changeFrequency: "monthly" },
  ];
  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
