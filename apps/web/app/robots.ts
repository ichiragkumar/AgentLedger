import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/metadata";

/**
 * robots.txt (F5 ship plumbing, owner: ledger-finish-proof).
 * Allow all; point crawlers at the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
