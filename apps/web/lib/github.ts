/**
 * GitHub integration helpers (owner: ledger-web-journey).
 *
 * Shared star-count helper for navbar / hero / open-source sections.
 * MUST be called from Server Components (uses `next.revalidate`).
 *
 * Integration status: LIVE against the public GitHub REST API.
 * Repo slug confirmed from git remote: ichiragkumar/AgentLedger.
 * Optional `GITHUB_TOKEN` env (backend-owned .env) raises the rate limit;
 * absence is handled gracefully via cached fallback.
 */

export const GITHUB_OWNER = "ichiragkumar";
export const GITHUB_REPO = "AgentLedger";

/** Fallback shown when the API is unreachable (matches social-proof copy). */
export const FALLBACK_STARS = 1200;

/** ISR window required by spec 16 §01/§11. */
export const STARS_REVALIDATE_SECONDS = 60;

export interface RepoStats {
  stars: number;
  forks: number;
  openIssues: number;
  url: string;
}

const FALLBACK_STATS: RepoStats = {
  stars: FALLBACK_STARS,
  forks: 0,
  openIssues: 0,
  url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
};

export async function getRepoStats(): Promise<RepoStats> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    // Optional: higher rate limit when the backend team provides a token.
    // Never required; never written here (mirror owns .env).
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
      { headers, next: { revalidate: STARS_REVALIDATE_SECONDS } },
    );
    if (!res.ok) return FALLBACK_STATS;
    const data = await res.json();
    return {
      stars:
        typeof data.stargazers_count === "number"
          ? data.stargazers_count
          : FALLBACK_STARS,
      forks: typeof data.forks_count === "number" ? data.forks_count : 0,
      openIssues:
        typeof data.open_issues_count === "number"
          ? data.open_issues_count
          : 0,
      url: data.html_url ?? FALLBACK_STATS.url,
    };
  } catch {
    return FALLBACK_STATS;
  }
}

/** Convenience accessor for the live star count (ISR 60s, cached). */
export async function getStarCount(): Promise<number> {
  return (await getRepoStats()).stars;
}

/** Compact display, e.g. 1,200 → "1.2k". */
export function formatStars(stars: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(stars);
}
