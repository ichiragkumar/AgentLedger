/**
 * Shared blog content (owner: ledger-web-journey).
 * Single source for /blog and /blog/[slug]. MDX-ready: swap `body`
 * blocks for compiled MDX when the MDX pipeline lands.
 */

export interface BlogPostMeta {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readingMinutes: number;
}

export interface BlogPost extends BlogPostMeta {
  paragraphs: string[];
}

export const POSTS: BlogPost[] = [
  {
    slug: "we-eliminated-35-percent-of-our-llm-bill-with-semantic-caching",
    title: "We eliminated 35% of our LLM bill with semantic caching",
    excerpt:
      "Phase 2 in production: how AgentLedger's semantic cache stopped us paying twice for the same answer — and the numbers to prove it.",
    date: "2026-09-10",
    readingMinutes: 6,
    paragraphs: [
      "“I stopped paying for duplicate calls.” That is the Phase 2 through-line, and this month we lived it: 35% of our own LLM spend vanished the week we turned on AgentLedger's semantic cache.",
      "The mechanism is simple. Every prompt embedding is checked against recent calls before it ever reaches a provider. Near-duplicates — retry loops, templated agent steps, CI re-runs — get the cached answer in microseconds instead of a fresh completion at full price.",
      "The numbers: cache-hit rate settled at 41%, completion spend dropped 35%, and p99 overhead stayed under 1ms because the check runs inside the Go proxy, not as a sidecar round-trip.",
      "If you are on Phase 1 (the Mirror) and can finally see where your AI money goes, Phase 2 is the first place it pays for itself. One env var, zero agent changes — then watch the duplicate spend line go flat.",
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}
