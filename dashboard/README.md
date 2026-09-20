# Dashboard v0.1 — pending (Next.js 15 + shadcn)

Phase 1 Mirror ships the data plane (proxy + Postgres `request_logs`).
This directory is the reserved home for the read plane.

Queries are already defined in `db/schema.sql`:
spend 24h/7d/30d, by model/agent/team, top-10 requests. Live <5s via
Postgres polling, load <2s target.

Do not block proxy work on this directory.
