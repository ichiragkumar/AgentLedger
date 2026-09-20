# AgentLedger — parallel-execution context

This file defines how multiple builder agents work in this repo WITHOUT conflicts.
All agents (human-invoked or via Task tool) must follow it.

## File ownership (exclusive — never touch another owner's files)

| Owner | Owns | Must NOT touch |
|---|---|---|
| ledger-mirror | `cmd/`, `internal/proxy/*`, `internal/pricing/*`, `internal/logger/*`, `internal/auth/*`, `db/schema.sql`, `db/migrations/001_*`, `dashboard/app/*`, `dashboard/lib/*`, `dashboard/package.json`, `dashboard/*.config.*`, `.env.example`, `.env`, `specs/04-*` | phase packages, other panels, other specs |
| ledger-saver | `internal/cache/*` (new), `dashboard/components/cache-panel.tsx`, `specs/05-*` | proxy core, `go.mod`, `.env*`, other specs |
| ledger-router | `internal/router/*` (new), `internal/pricing/feed.go` (new only), `dashboard/components/routing-panel.tsx`, `specs/06-*` | proxy core, `registry.go`, `.env*`, other specs |
| ledger-enforcer | `internal/enforce/*` (new), `db/migrations/002_*` (new only), `dashboard/components/budget-panel.tsx`, `specs/07-*` | proxy core, `schema.sql`, `.env*`, other specs |
| ledger-brain | `internal/brain/*` (new), `db/migrations/003_*` (new only), `dashboard/components/topology-panel.tsx`, `specs/08-*` | proxy core, other migrations, `.env*`, other specs |

### Frontend ownership (specs 15–18; monorepo migration is coordinator-run — nobody restructures until it lands)

| Owner | Owns | Must NOT touch |
|---|---|---|
| ledger-web-landing | `apps/web` landing sections + live demo, `components/landing/*`, `components/shared/*`, `specs/16-*` (sections only) | dashboard, packages, pricing values, journey/numbers/pricing-page |
| ledger-web-dashboard | `apps/dashboard` pages + shell, `components/layout|charts|tables|cards/*`, current `dashboard/components/*` (additive) | fetchers, Route Handlers, auth, packages, Go |
| ledger-web-system | tokens/globals.css, `components/ui|primitives|blocks/*`, `packages/ui|types|config`, `lib/fonts.ts`, `specs/18-*` | page content, handlers, pricing values |
| ledger-web-backend | `app/api/*`, `lib/api.ts`, `lib/hooks/*`, `lib/stores/*`, auth/middleware/onboarding APIs | page content, components, packages, Go, `.env` files |
| ledger-web-journey | journey timeline, numbers, pricing page sync, docs/blog/changelog/waitlist, GitHub/stats integrations | landing sibling sections, pricing values, dashboard, Go |

Pre-monorepo: current `dashboard/` is ledger-mirror's home (shell, lib, config) + dashboard panels per phase owners above. Web agents build under `apps/` only after migration; until then they plan, do NOT create `apps/` unilaterally.

Shared-but-append-only: `specs/00-index.md`, `specs/11-*`, `specs/13-*` (coordinator edits only).

## Hard rules
- No agent edits `go.mod`/`go.sum` — list needed deps in the return message instead.
- No agent writes `.env` (mirror owns it) — return REQUIRED_ENV lists instead.
- Cross-phase integration = string-based contracts + `WIRING.md` patches, never imports that create cycles (enforce/brain must not import router).
- New code = new files. Additive changes to shared files only by the owner.

## Verification contract (every agent, every turn)
1. `gofmt -l` clean on touched dirs (Go agents).
2. `go vet` + `go test` green for owned packages (target >80% coverage on new code).
3. Frontend: `npx tsc --noEmit` clean in touched app (+ `npm run build` for landing before shipping).
4. Return: files created/modified, test/typecheck output, REQUIRED_ENV additions, wiring notes.

## Iterative planning
After completing any task block, the agent MUST report the immediate next step
and plan before starting new work — no silent chaining into out-of-scope phases.
