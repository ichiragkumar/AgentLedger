package proxy

import (
	"encoding/json"
	"net/http"
	"time"
)

// NewMux wires routes with the required middleware chain order:
//
//	enforce-stub → cache-stub → route-stub → upstream
func NewMux(p *Proxy) *http.ServeMux {
	mux := http.NewServeMux()

	upstream := http.HandlerFunc(p.ServeChatCompletions)
	chained := Chain(upstream, EnforceStub, CacheStub, RouteStub)
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
