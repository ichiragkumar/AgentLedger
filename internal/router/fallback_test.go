package router

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestFallbackCascadesUnder2s(t *testing.T) {
	var tried []string
	c := &Chain{
		Models:            []string{"primary", "gpt-5.6-terra", "gemini-1.5-pro"},
		PerAttemptTimeout: 300 * time.Millisecond,
	}
	fails := map[string]error{
		"primary":       errors.New("timeout"),
		"gpt-5.6-terra": errors.New("500"),
	}
	start := time.Now()
	got, err := c.Execute(context.Background(), func(ctx context.Context, model string) error {
		tried = append(tried, model)
		if e, ok := fails[model]; ok {
			return e
		}
		return nil
	})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if got != "gemini-1.5-pro" {
		t.Fatalf("served by %q", got)
	}
	if len(tried) != 3 {
		t.Fatalf("tried %v", tried)
	}
	if elapsed > FallbackTriggerBudget {
		t.Fatalf("cascade took %s > 2s budget", elapsed)
	}
}

func TestFallbackHungPrimaryTriggersFast(t *testing.T) {
	// A hung primary must trigger the next model within the 2s budget even
	// though the primary never returns (per-attempt timeout cuts it off).
	c := &Chain{Models: []string{"hung", "backup"}, PerAttemptTimeout: 400 * time.Millisecond}
	start := time.Now()
	got, err := c.Execute(context.Background(), func(ctx context.Context, model string) error {
		if model == "hung" {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	})
	if err != nil || got != "backup" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	if elapsed := time.Since(start); elapsed > FallbackTriggerBudget {
		t.Fatalf("hung-primary trigger took %s > 2s", elapsed)
	}
}

func TestFallbackAllFail(t *testing.T) {
	c := DefaultChain("claude-3-5-sonnet")
	if len(c.Models) != 3 || c.Models[0] != "claude-3-5-sonnet" {
		t.Fatalf("default chain = %v", c.Models)
	}
	var fallbacks int
	c.OnFallback = func(failed, next string, err error) { fallbacks++ }
	_, err := c.Execute(context.Background(), func(ctx context.Context, model string) error {
		return errors.New("down")
	})
	if err == nil {
		t.Fatal("expected aggregate error")
	}
	if fallbacks != 2 {
		t.Fatalf("OnFallback fired %d times, want 2", fallbacks)
	}
}

func TestFallbackEmptyAndNil(t *testing.T) {
	if _, err := (&Chain{}).Execute(context.Background(), func(ctx context.Context, m string) error { return nil }); !errors.Is(err, ErrEmptyChain) {
		t.Fatalf("empty chain err = %v", err)
	}
	var nilC *Chain
	if _, err := nilC.Execute(context.Background(), func(ctx context.Context, m string) error { return nil }); !errors.Is(err, ErrEmptyChain) {
		t.Fatalf("nil chain err = %v", err)
	}
	if _, err := DefaultChain("x").Execute(context.Background(), nil); err == nil {
		t.Fatal("nil do func must error")
	}
}

func TestFallbackContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := DefaultChain("x").Execute(ctx, func(ctx context.Context, m string) error {
		return errors.New("boom")
	})
	if err == nil {
		t.Fatal("cancelled cascade must error")
	}
}

func TestFallbackFirstTryWins(t *testing.T) {
	calls := 0
	got, err := DefaultChain("primary").Execute(context.Background(), func(ctx context.Context, m string) error {
		calls++
		return nil
	})
	if err != nil || got != "primary" || calls != 1 {
		t.Fatalf("got=%q calls=%d err=%v", got, calls, err)
	}
}
