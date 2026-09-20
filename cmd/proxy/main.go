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
//	VIRTUAL_KEYS (optional "vk_a=sk-a,..."), AGENTLEDGER_VERSION,
//	CACHE_ENABLED (default true), ROUTER_STRATEGY (default balanced;
//	off/disabled/none/false/0 → route stub), ROUTER_RULES_FILE (optional,
//	hot-reloaded), ENFORCE_PRECHECK (default true).
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
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/cache"
	"github.com/agentledger/agentledger/internal/enforce"
	"github.com/agentledger/agentledger/internal/logger"
	"github.com/agentledger/agentledger/internal/pricing"
	"github.com/agentledger/agentledger/internal/proxy"
	"github.com/agentledger/agentledger/internal/router"
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

	// Live chain deps (finish track: stub chain → live pipeline). Every
	// layer is env-gated and defaults ON, failing open to stub behavior:
	//
	//	CACHE_ENABLED (default true; cache.FromEnv) → cache.Hook
	//	ROUTER_STRATEGY (default balanced; off/disabled/none/false/0 → stub)
	//	ENFORCE_PRECHECK (default true; false/off/no/disabled/0 → stub)
	//
	// The enforcer instance always backs the management plane; the gate only
	// controls whether PreCheck + Observe sit on the data path.
	enforcer := enforce.NewAPI()
	chain := proxy.ChainDeps{}
	var cacheHook *cache.Hook
	chainNames := map[string]string{"enforce": "enforce-stub", "cache": "cache-stub", "route": "route-stub"}
	if envBool("ENFORCE_PRECHECK", true) {
		chain.Enforcer = enforcer
		chainNames["enforce"] = "enforce-precheck"
	}
	if hook := wireCache(reg); hook != nil {
		chain.Cache = hook
		chainNames["cache"] = "cache-hook"
		cacheHook = hook
	}
	if rcfg := wireRouter(enforcer); rcfg != nil {
		chain.Router = rcfg
		chainNames["route"] = "route-" + string(rcfg.Strategy)
	}

	// Timeouts: ReadHeaderTimeout + ReadTimeout mitigate slow-loris on the
	// ingress side. Deliberately NO WriteTimeout: SSE streams stay open for
	// minutes and WriteTimeout would kill them mid-stream.
	mux := proxy.NewMuxWithChain(p, chain)
	// Management plane: budgets/alerts/audit (enforce) + key vault + cache.
	// Nil-safe: MountMgmt/MountCacheMgmt skip whatever is absent.
	proxy.MountMgmt(mux, enforcer, p.Vault())
	proxy.MountCacheMgmt(mux, cacheHook)
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
	log.Printf("agentledger proxy %s listening on :%s middleware=%s, %s, %s upstream=%s",
		version, port, chainNames["enforce"], chainNames["cache"], chainNames["route"], "by-model-prefix")
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

// wireCache builds the live cache hook (WIRING: CacheStub → Hook.Middleware).
// Returns nil when CACHE_ENABLED is off — the stub stays. The pricing
// adapter feeds hook savings (X-AgentLedger-Saved-Usd) from the live
// registry. Production backends need no code change: REDIS_URL/QDRANT_URL
// are honored inside the cache package when set.
func wireCache(reg *pricing.Registry) *cache.Hook {
	cfg := cache.FromEnv()
	if !cfg.Enabled {
		log.Printf("proxy: cache stub (CACHE_ENABLED=off)")
		return nil
	}
	hook := cache.NewHook(cfg, nil)
	hook.Cost = func(model string, in, out int) (float64, bool) {
		return reg.Cost(model, in, out)
	}
	return hook
}

// wireRouter builds the live routing layer (WIRING: RouteStub → Decide).
// Returns nil when ROUTER_STRATEGY is off/disabled/none/false/0 — the stub
// stays. Otherwise the strategy defaults to balanced. ROUTER_RULES_FILE
// (optional) loads team overrides and hot-reloads them every 5s with no
// restart; an unreadable file logs and falls back to classify-only routing
// (fail-open: last-good/empty rules keep serving).
func wireRouter(enforcer *enforce.API) *proxy.RouterChainConfig {
	raw := strings.TrimSpace(os.Getenv("ROUTER_STRATEGY"))
	switch strings.ToLower(raw) {
	case "off", "disabled", "none", "false", "0":
		log.Printf("proxy: route stub (ROUTER_STRATEGY=off)")
		return nil
	}
	strategy := router.ParseStrategy(raw)
	engine := router.NewEngine()
	if path := strings.TrimSpace(os.Getenv("ROUTER_RULES_FILE")); path != "" {
		if err := engine.LoadFile(path); err != nil {
			log.Printf("proxy: router rules %s not loaded (classify-only): %v", path, err)
		} else {
			log.Printf("proxy: router rules loaded from %s (watch 5s)", path)
			engine.Watch(path, 5*time.Second, func(err error) {
				log.Printf("proxy: router rules reload: %v", err)
			})
		}
	}
	downgradeHeader := proxy.DefaultDowngradeHeader
	if enforcer != nil && enforcer.Downgrader != nil && enforcer.Downgrader.DowngradeHeader != "" {
		downgradeHeader = enforcer.Downgrader.DowngradeHeader
	}
	return &proxy.RouterChainConfig{
		Engine:          engine,
		Tiers:           router.DefaultTierMap(),
		Strategy:        strategy,
		DowngradeHeader: downgradeHeader,
	}
}

// envBool reads a kill-switch env var. Unset/blank → def (all chain gates
// default ON); explicit falsy values (0/false/no/n/off/disabled) → false;
// anything else → true. Never fatal on malformed input.
func envBool(name string, def bool) bool {
	raw, ok := os.LookupEnv(name)
	if !ok || strings.TrimSpace(raw) == "" {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y", "on", "enabled":
		return true
	case "0", "false", "no", "n", "off", "disabled":
		return false
	default:
		return def
	}
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
