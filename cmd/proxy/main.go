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
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/agentledger/agentledger/internal/auth"
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
		log.Printf("proxy: price registry %s version=%s", pricesFile, loaded.Version())
	} else {
		log.Printf("proxy: using built-in prices (could not load %s: %v)", pricesFile, err)
	}

	p := proxy.New(proxy.Config{
		Pricing: reg,
		Auth:    auth.NewMapResolverFromEnv(),
		Log:     logger.NewFromEnv(),
		Metrics: proxy.NewMetrics(),
		Version: version,
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8787"
	}
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           proxy.NewMux(p),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("agentledger proxy %s listening on :%s", version, port)
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
