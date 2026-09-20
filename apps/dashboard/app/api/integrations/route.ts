// Integrations registry — static copy in one place (spec 17).
// The integrations page renders cards from this GET; per-platform key
// provisioning POSTs the live /api/keys route with a scoped name.
// GET enriches each entry with live state (keys, metered calls + spend)
// so setup checklists reflect reality, not wishes. Zero-state safe.

import { queryOrNull } from "@/lib/db";

export const dynamic = "force-dynamic";

export type IntegrationStatus = "live" | "beta" | "coming-soon";

export type Integration = {
  id: string;
  name: string;
  status: IntegrationStatus;
  docsPath: string;
  keyScope: string;
  tagline: string;
  steps: string[];
  live?: IntegrationLive;
};

const REGISTRY: Integration[] = [
  {
    id: "dronahq",
    name: "DronaHQ",
    status: "live",
    docsPath: "/docs/integrations/dronahq",
    keyScope: "dronahq",
    tagline: "Low-code front-ends over your AgentLedger metered calls.",
    steps: [
      "Create a scoped virtual key below (agent scope pre-filled).",
      "Add it as a DronaHQ environment secret (never in client JS).",
      "Point DronaHQ API actions at your AgentLedger proxy URL.",
    ],
  },
  {
    id: "anakin",
    name: "Anakin",
    status: "beta",
    docsPath: "/docs/integrations/anakin",
    keyScope: "anakin",
    tagline: "No-code AI app builder with per-app spend attribution.",
    steps: [
      "Create a scoped virtual key below (agent scope pre-filled).",
      "Paste it into the Anakin connector auth field.",
      "Tag requests per app so spend splits by agent scope.",
    ],
  },
  {
    id: "nasiko",
    name: "Nasiko",
    status: "beta",
    docsPath: "/docs/integrations/nasiko",
    keyScope: "nasiko",
    tagline: "Agent workflow studio — scoped keys per published flow.",
    steps: [
      "Create a scoped virtual key below (agent scope pre-filled).",
      "Set OPENAI_API_BASE to your AgentLedger proxy URL in the Nasiko agent env.",
      "Run the flow — spend lands here attributed to the nasiko scope.",
    ],
  },
];

export type IntegrationLive = { keys: number; calls: number; spend: number };

// GET /api/integrations — registry + live state, never 500s.
export async function GET() {
  const live = await queryOrNull<{ scope: string; keys: string; calls: string; spend: string }>(
    `SELECT k.agent_scope AS scope, count(DISTINCT k.id) AS keys,
            count(l.id) AS calls, coalesce(sum(l.cost_usd), 0) AS spend
     FROM (SELECT DISTINCT agent_scope, id FROM virtual_keys WHERE revoked_at IS NULL) k
     FULL OUTER JOIN request_logs l
       ON l.agent_id = k.agent_scope AND l.team_id = 'ecosystem'
     WHERE k.agent_scope IN ('dronahq', 'anakin', 'nasiko')
        OR (l.agent_id IN ('dronahq', 'anakin', 'nasiko') AND l.team_id = 'ecosystem')
     GROUP BY 1`
  );
  const byScope = new Map((live ?? []).map((r) => [r.scope, r]));
  return Response.json({
    integrations: REGISTRY.map((r) => {
      const s = byScope.get(r.keyScope);
      const stats: IntegrationLive = {
        keys: Number(s?.keys ?? 0),
        calls: Number(s?.calls ?? 0),
        spend: Number(s?.spend ?? 0),
      };
      return { ...r, live: stats };
    }),
  });
}
