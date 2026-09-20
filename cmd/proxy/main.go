// Command proxy runs the AgentLedger Phase-1 Mirror: an OpenAI-compatible
// reverse proxy on :8787 that counts tokens, prices requests, and logs them.
//
//	POST /v1/chat/completions  -> upstream by model prefix
//	GET  /health                -> {"status":"ok"}
//	GET  /metrics               -> Prometheus exposition
//
// Env:
//
//	PORT (default 8787), PRICES_FILE (default data/prices.json),
//	DATABASE_URL (optional; stdout fallback when empty),
//	OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, DEEPSEEK_API_KEY,
//	OPENAI_BASE_URL, ANTHROPIC_BASE_URL, GOOGLE_BASE_URL, DEEPSEEK_BASE_URL,
//	VIRTUAL_KEYS (optional "vk_a=sk-a,..."), AGENTLEDGER_VERSION.
//
// Secrets contract: startup logs report only set/empty per key variable —
// NEVER values. See .env.example for the full list.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/enforce"
	"github.com/agentledger/agentledger/internal/logger"
	"github.com/agentledger/agentledger/internal/pricing"
	"github.com/agentledger/agentledger/internal/proxy"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("proxy: %v", err)
	}
}

func run() error {
	version := os.Getenv("AGENTLEDGER_VERSION")

	// Pricing registry: file wins, embedded defaults keep us bootable.
	reg := pricing.NewDefault()
	pricesFile := os.Getenv("PRICES_FILE")
	if pricesFile == "" {
		pricesFile = "data/prices.json"
	}
	if loaded, err := pricing.LoadFromFile(pricesFile); err == nil {
		reg = loaded
		log.Printf("proxy: price registry %s version=%s models=%d currency=%s",
			pricesFile, loaded.Version(), loaded.Size(), loaded.Currency())
	} else {
		log.Printf("proxy: using built-in prices (could not load %s: %v)", pricesFile, err)
	}

	p := proxy.New(proxy.Config{
		Pricing: reg,
		Auth:    auth.NewMapResolverFromEnv(),
		Vault:   newVault(),
		Log:     logger.NewFromEnv(),
		Metrics: proxy.NewMetrics(),
		Version: version,
	})

	port := normalizePort(os.Getenv("PORT"))

	// Timeouts: ReadHeaderTimeout + ReadTimeout mitigate slow-loris on the
	// ingress side. Deliberately NO WriteTimeout: SSE streams stay open for
	// minutes and WriteTimeout would kill them mid-stream.
	mux := proxy.NewMux(p)
	// Management plane: budgets/alerts/audit (enforce) + key vault.
	// Nil-safe: MountMgmt skips whatever is absent.
	proxy.MountMgmt(mux, enforce.NewAPI(), p.Vault())
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	// Startup line: versions + key presence only. NEVER log key values,
	// DSN contents, or VIRTUAL_KEYS entries.
	log.Printf("agentledger proxy %s listening on :%s middleware=enforce-stub, cache-stub, route-stub upstream=%s",
		version, port, "by-model-prefix")
	log.Printf("proxy: keys openai=%s anthropic=%s google=%s deepseek=%s db=%s redis=%s qdrant=%s",
		setOrEmpty("OPENAI_API_KEY"), setOrEmpty("ANTHROPIC_API_KEY"),
		setOrEmpty("GOOGLE_API_KEY"), setOrEmpty("DEEPSEEK_API_KEY"),
		setOrEmpty("DATABASE_URL"), setOrEmpty("REDIS_URL"), setOrEmpty("QDRANT_URL"))

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("proxy: listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(ctx)
}

// newVault builds the key vault: Postgres-backed when DATABASE_URL is set
// AND reachable, else in-memory. Presence-only logging, never secrets.
func newVault() *auth.Vault {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if pool, err := pgxpool.New(ctx, dsn); err == nil {
			if err := pool.Ping(ctx); err == nil {
				log.Printf("proxy: key vault postgres-backed")
				return auth.NewVault(pool)
			}
			pool.Close()
		}
		log.Printf("proxy: key vault in-memory (postgres unreachable)")
	}
	return auth.NewVault(nil)
}

// normalizePort keeps a bad PORT from crashing the process with a confusing
// listen error; falls back to 8787.
func normalizePort(raw string) string {
	if raw == "" {
		return "8787"
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 65535 {
		log.Printf("proxy: invalid PORT %q, using 8787", raw)
		return "8787"
	}
	return strconv.Itoa(n)
}

// setOrEmpty reports key presence without exposing values.
func setOrEmpty(env string) string {
	if os.Getenv(env) != "" {
		return "set"
	}
	return "empty"
}
