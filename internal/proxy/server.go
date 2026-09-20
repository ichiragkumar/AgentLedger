package proxy

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/agentledger/agentledger/internal/cache"
	"github.com/agentledger/agentledger/internal/enforce"
	"github.com/agentledger/agentledger/internal/router"
)

// RouterChainConfig carries the live routing layer. Nil RouterChainConfig
// (or nil ChainDeps.Router) keeps RouteStub. Engine may be nil (pure
// classify); Tiers nil falls back to router defaults.
type RouterChainConfig struct {
	Engine          *router.Engine
	Tiers           *router.TierMap
	Strategy        router.Strategy
	DowngradeHeader string // "" → DefaultDowngradeHeader
}

// ChainDeps carries the live subsystem instances the chain needs. Every
// field is optional and env-gated by the caller (cmd/proxy): nil means the
// corresponding stub stays, so fail-open is structural — an unwired layer
// cannot break the data plane.
//
//   - Enforcer != nil → api.PreCheck() replaces EnforceStub, and an
//     ObserveMiddleware is added innermost (route → observe → upstream) so
//     post-response usage lands in budgets/loops/alerts. Cache HITs never
//     reach it, so hits never burn budget.
//   - Cache != nil && Cache.Config.Enabled → hook.Middleware replaces
//     CacheStub (exact → semantic → provider, same HIT/MISS contract).
//   - Router != nil → RouteMiddleware replaces RouteStub (Decide verdict in
//     X-AgentLedger-Route/Tier/Complexity; downgrade-marked requests keep
//     their budget-chosen model).
type ChainDeps struct {
	Enforcer *enforce.API
	Cache    *cache.Hook
	Router   *RouterChainConfig
}

// NewMux wires routes with the required middleware chain order:
//
//	enforce-stub → cache-stub → route-stub → upstream
func NewMux(p *Proxy) *http.ServeMux {
	return NewMuxWithChain(p, ChainDeps{})
}

// NewMuxWithChain wires the same routes as NewMux but swaps stub bodies for
// live layers per deps (see ChainDeps). Diagnostic headers are preserved:
// live layers set the same markers with real values (HIT on exact/semantic
// hits, the downgraded model pair, the routed model/tier/complexity).
func NewMuxWithChain(p *Proxy, deps ChainDeps) *http.ServeMux {
	mux := http.NewServeMux()

	enforceMW := Middleware(EnforceStub)
	if deps.Enforcer != nil {
		enforceMW = deps.Enforcer.PreCheck()
	}
	cacheMW := Middleware(CacheStub)
	if deps.Cache != nil && deps.Cache.Config.Enabled {
		cacheMW = deps.Cache.Middleware
	}
	routeMW := Middleware(RouteStub)
	if deps.Router != nil {
		routeMW = RouteMiddleware(
			deps.Router.Engine,
			deps.Router.Tiers,
			deps.Router.Strategy,
			deps.Router.DowngradeHeader,
		)
	}

	upstream := http.HandlerFunc(p.ServeChatCompletions)
	var chained http.Handler = upstream
	if deps.Enforcer != nil {
		// Innermost: sees the final (downgraded/routed) body, only runs on
		// cache MISS traffic that reaches upstream.
		chained = ObserveMiddleware(deps.Enforcer, p.pricing)(chained)
	}
	chained = Chain(chained, enforceMW, cacheMW, routeMW)
	mux.Handle("POST /v1/chat/completions", chained)

	mux.HandleFunc("GET /health", handleHealth(p.version))
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write([]byte(p.Metrics().PrometheusText()))
	})
	// Explicit 405s (instead of Go's default 404) keep agent SDKs honest
	// about wrong-method calls against the OpenAI-compatible path.
	mux.HandleFunc("GET /v1/chat/completions", methodNotAllowed)
	mux.HandleFunc("PUT /v1/chat/completions", methodNotAllowed)
	mux.HandleFunc("DELETE /v1/chat/completions", methodNotAllowed)
	mux.HandleFunc("PATCH /v1/chat/completions", methodNotAllowed)

	return mux
}

func methodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed, use POST"})
}

func handleHealth(version string) http.HandlerFunc {
	if version == "" {
		version = "dev"
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed, use GET"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"version": version,
			"time":    time.Now().UTC().Format(time.RFC3339),
		})
	}
}
