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
		_, _ = w.Write([]byte(p.Metrics().PrometheusText()))
	})

	return mux
}

func handleHealth(version string) http.HandlerFunc {
	if version == "" {
		version = "dev"
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"version": version,
			"time":    time.Now().UTC().Format(time.RFC3339),
		})
	}
}
