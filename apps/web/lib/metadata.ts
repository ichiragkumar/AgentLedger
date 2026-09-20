/**
 * Shared metadata / OG defaults (owner: ledger-web-journey).
 * Per-page usage: `export const generateMetadata = () => pageMetadata({...})`.
 * Root layout stays sibling-owned — never set global metadata here.
 */

import type { Metadata } from "next";

export const SITE_NAME = "AgentLedger";
export const SITE_TAGLINE = "TokenOps control plane for AI agents";
/** Canonical URL placeholder — confirm custom domain at launch. */
export const SITE_URL = "https://agentledger.io";
export const SITE_DESCRIPTION =
  "One proxy. Full visibility. 40–70% less spend. AgentLedger is the open-source TokenOps control plane — observe every token dollar, cache semantically, route intelligently, enforce hard budgets.";
export const OG_IMAGE = "/og.png";

export const defaultMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

interface PageMetadataOpts {
  title: string;
  description?: string;
  path?: string;
}

export function pageMetadata({
  title,
  description = SITE_DESCRIPTION,
  path = "/",
}: PageMetadataOpts): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    ...defaultMetadata,
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      ...defaultMetadata.openGraph,
      title: `${title} · ${SITE_NAME}`,
      description,
      url,
    },
    twitter: {
      ...defaultMetadata.twitter,
      title: `${title} · ${SITE_NAME}`,
      description,
    },
  };
}
