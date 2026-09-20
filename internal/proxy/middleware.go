package proxy

import "net/http"

// Middleware is a standard HTTP middleware.
//
// Required chain order (spec 02, request flow):
//
//	enforce-stub → cache-stub → route-stub → upstream
//
// Each Phase-1 stub is a transparent passthrough that sets a diagnostic
// response header so operators can verify the chain. Later phases replace
// the bodies without touching the wiring in server.go:
//
//   - Phase 2 (Saver)    fills CacheStub with exact/semantic lookup.
//   - Phase 3 (Router)   fills RouteStub with classifier + tier selection.
//   - Phase 4 (Enforcer) fills EnforceStub with budget/policy pre-check.
type Middleware func(http.Handler) http.Handler

// Chain wraps h in mws so mws[0] runs first.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// EnforceStub is the Phase-4 budget/policy pre-check extension point.
// Today: passthrough. Contract: on deny, later phases return 429 with
// X-AgentLedger-Deny-Reason.
func EnforceStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-AgentLedger-Enforce", "pass-through")
		next.ServeHTTP(w, r)
	})
}

// CacheStub is the Phase-2 exact/semantic cache extension point.
// Today: always MISS passthrough. Contract: on hit, later phases return
// X-AgentLedger-Cache: HIT and skip upstream.
func CacheStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-AgentLedger-Cache", "MISS")
		next.ServeHTTP(w, r)
	})
}

// RouteStub is the Phase-3 intelligent-routing extension point.
// Today: passthrough (provider chosen by model prefix). Contract: later
// phases set X-AgentLedger-Route to the selected model.
func RouteStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-AgentLedger-Route", "model-prefix")
		next.ServeHTTP(w, r)
	})
}
