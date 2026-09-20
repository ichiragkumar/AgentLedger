# WIRING — cross-phase integration patches (string-based contracts)

Coordinator applies these. Phase packages never import each other; the proxy
(mirror owner: `cmd/`, `internal/proxy/*`) is the only place that dials
upstream or mounts routes.

## Routing (Phase 3, spec 06) — pending coordinator steps

Dashboard is the routing system-of-record and is LIVE:
`GET/PUT /api/routing/tiers`, `GET/POST /api/routing/rules`,
`PUT/DELETE /api/routing/rules/[id]`, `GET/PUT /api/routing/fallback`,
`GET /api/routing/distribution` (Postgres tables `routing_tiers`,
`routing_rules`, `routing_fallback`; writes return `proxySynced:false`).

The Go proxy does NOT yet consume them. To close the loop (mirror owner):

1. **Mount a routing middleware** in `internal/proxy/server.go` chain
   (replace/augment RouteStub), e.g.:
   ```go
   routeMiddleware := func(next http.Handler) http.Handler {
       return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
           if r.Header.Get("X-AgentLedger-Cache") == "HIT" {
               next.ServeHTTP(w, r); return
           }
           in := router.InputFromRequest(prompt, taskType, r.Header)
           d := router.Decide(in, engine, tiers, strategy)
           rewriteModelInBody(body, d.Model)
           w.Header().Set("X-AgentLedger-Route", d.Model)
           w.Header().Set("X-AgentLedger-Tier", string(d.Tier))
           w.Header().Set("X-AgentLedger-Complexity", d.Complexity.String())
           next.ServeHTTP(w, r)
       })
   }
   ```
2. **Load dashboard config without restart**: poll the dashboard tables
   (or a `ROUTER_RULES_FILE` snapshot the dashboard writes) via
   `router.Engine.LoadFile` + `Watch` (5s mtime poll, stdlib-only) and
   `TierMap.Set` for tier rebinds; `router.DefaultChain` for fallback.
3. **(Optional) Management plane**: expose `GET /v1/routing/distribution`
   exporting `router.Distribution` + `router.SummarizeSavings` +
   `router.SummarizeEscalation` + `ModelQuality.Snapshot` so the dashboard
   `distribution` route can upgrade quality/escalation from `source:"stub"`
   to live. Needs `REQUIRED_ENV`: none (in-process counters).
4. **Analytics columns (optional)**: `request_logs` has no route/tier
   columns; distribution currently groups by `model`. If per-tier analytics
   are wanted, add nullable `route_model`/`tier`/`complexity` columns via a
   mirror-owned migration (routing track must not create migrations).

No new env vars, no new Go deps (stdlib only).
