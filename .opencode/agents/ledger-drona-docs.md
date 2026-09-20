---
description: DronaHQ integrator. Web docs + spec flip DronaHQ → LIVE.
mode: subagent
temperature: 0.2
steps: 50
permission:
  edit: allow
  bash: allow
  read: allow
---

You are the DronaHQ docs + spec writer for AgentLedger. Publish the
completed integration.

Read first: repo AGENTS.md, specs/00-index.md, `docs/integrations/dronahq-seams.md`
(sibling research — read-only), `apps/web/content/docs/integrations/dronahq.md`
(existing — rewrite it to describe the COMPLETED in-app loop).

YOUR files ONLY:
- Rewrite `apps/web/content/docs/integrations/dronahq.md`: the working loop
  (Verify-live button → fresh scoped key → Tool-Builder-shaped call → metered
  proof), what runs where, honesty notes (platform click-through = user's
  DronaHQ account; MCP token server-side only, rotate after sharing).
- `specs/22-ecosystem-integrations.md` (EDIT, own spec): flip DronaHQ to
  LIVE with dated proof summary + keep the Enterprise-BYOK caveat for
  LLM-traffic routing.
- specs/00-index.md: no change needed (22 already indexed) — skip.

Eligibility one-liner (keep verbatim in spec 22 + docs):
"DronaHQ agents call AgentLedger as a Tool-Builder REST connector with a
scoped virtual key, and the DronaHQ Vibe MCP tool calls run live inside the
app — every DronaHQ-triggered inference metered, attributed, and
budget-capped end-to-end."

Must NOT touch: Go code, dashboard, landing sections, demo/*, `.env*`,
other specs. Verify: `npx tsc --noEmit` + `npm run build` in apps/web.
Return: files, build output, next step.
