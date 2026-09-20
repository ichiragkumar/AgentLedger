# Saver → Mirror Wiring (Phase 2 → Phase 1)

Owner: **Mirror sibling** (owns `internal/proxy/middleware.go` + `server.go`).
Saver ships the hook — Mirror applies this patch. Nothing else changes:
proxy contracts, logging, and headers are untouched.

## Exact 5-line patch (`internal/proxy/server.go`)

```diff
 import (
 	"encoding/json"
 	"net/http"
 	"time"
+
+	"github.com/agentledger/agentledger/internal/cache"
 )
 ...
 	upstream := http.HandlerFunc(p.ServeChatCompletions)
-	chained := Chain(upstream, EnforceStub, CacheStub, RouteStub)
+	hook := cache.NewHook(cache.FromEnv(), nil)
+	chained := Chain(upstream, EnforceStub, hook.Middleware, RouteStub)
```

Diff stat: 5 changed lines (2 added import block lines, 1 removed, 2 added
wiring lines). Chain order is preserved (`enforce → cache → route`); only
the cache slot's body changes from `CacheStub` (always MISS) to
`Hook.Middleware` (exact → semantic → provider).

## Pricing adapter (1 line, in Mirror's wiring site)

Hook savings (`X-AgentLedger-Saved-Usd`, dashboard `$ saved`) need real
costs. Adapt the existing registry where the Proxy is built:

```go
hook.Cost = func(model string, in, out int) (float64, bool) {
	return registry.Cost(model, in, out) // *pricing.Registry — already in Proxy
}
```

## What Mirror gets for free

- `X-AgentLedger-Cache: HIT|MISS` — same values as `CacheStub` today.
- Additive only: `X-AgentLedger-Cache-Layer` (exact|semantic),
  `X-AgentLedger-Cache-Key`, `X-AgentLedger-Cache-Reason`,
  `X-AgentLedger-Saved-Usd`, `X-AgentLedger-Cache-Similarity`.
- Attribution headers still forwarded verbatim; virtual-key auth untouched.
- Savings stats reuse the Postgres request log — no new tables required
  (hook `Stats` feeds `/metrics`; dashboard aggregates Postgres as today).

## Follow-up routes (Mirror owns `server.go`; Saver provides the calls)

```go
// DELETE /v1/cache/{key}            → cache.DeleteKey(hook.Exact, hook.Semantic, key)
// DELETE /v1/cache?agent=X          → cache.PurgeByAgent(hook.Exact, hook.Semantic, agent)
// DELETE /v1/cache?team=X           → cache.PurgeByTeam(...)
// DELETE /v1/cache?model=X          → cache.PurgeByModel(...)
```

## Production backends (no code change in proxy path)

- `REDIS_URL` set → swap `hook.Exact` for the Redis adapter implementing
  `cache.Cache` (`Check`/`Store`, same TTL semantics). Until then the
  in-memory store ships (single-replica semantics, documented).
- `QDRANT_URL` set → point `WithQdrant(...)` at the collection; vectors are
  built by `QdrantUpsertBody`, searched by `SearchRemote`, joined back to
  exact keys. Until then the in-memory cosine index ships.
- Embedding sidecar: `all-MiniLM-L6-v2` (384-dim) implementing
  `cache.Embedder`; `HashEmbedder` is dev-only and must never benchmark.
