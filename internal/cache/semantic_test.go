package cache

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCosineSimilarity(t *testing.T) {
	a := []float32{1, 0, 0}
	if CosineSimilarity(a, a) != 1 {
		t.Fatal("identical vectors must score 1")
	}
	if got := CosineSimilarity(a, []float32{0, 1, 0}); got != 0 {
		t.Fatalf("orthogonal: %v", got)
	}
	if CosineSimilarity(nil, a) != 0 || CosineSimilarity(a, nil) != 0 {
		t.Fatal("empty vectors score 0")
	}
	if CosineSimilarity(a, []float32{1, 2}) != 0 {
		t.Fatal("mismatched dims score 0")
	}
	if CosineSimilarity([]float32{0, 0}, []float32{0, 0}) != 0 {
		t.Fatal("zero vectors score 0")
	}
}

func TestPromptTextScopesModelAndRoles(t *testing.T) {
	a := PromptText("m", []Message{{Role: "system", Content: "X"}, {Role: "user", Content: "Y"}})
	b := PromptText("m", []Message{{Role: "user", Content: "X"}, {Role: "system", Content: "Y"}})
	if a == b {
		t.Fatal("role swap must change match surface")
	}
	if PromptText("m1", []Message{{Role: "u", Content: "hi"}}) == PromptText("m2", []Message{{Role: "u", Content: "hi"}}) {
		t.Fatal("model must scope match surface")
	}
}

func TestSemanticCheckAdmitAndThreshold(t *testing.T) {
	ctx := context.Background()
	sem := NewSemanticCache(NewHashEmbedder(64))
	if sem.Threshold() != DefaultSimilarityThreshold {
		t.Fatalf("default threshold: %v", sem.Threshold())
	}
	text := "how do I reset my password"
	vec, err := sem.embedder.Embed(ctx, text)
	if err != nil {
		t.Fatal(err)
	}
	e := Entry{Key: "k1", Model: "gpt-4o", ResponseBody: []byte("reset here"), CreatedAt: time.Now()}
	sem.StoreWithVector("k1", e, vec, time.Hour)

	// Identical prompt → similarity 1.0, admitted.
	got, sim, ok := sem.Check(ctx, text)
	if !ok || sim != 1.0 || !got.Semantic || string(got.ResponseBody) != "reset here" {
		t.Fatalf("identical must hit: ok=%v sim=%v %+v", ok, sim, got)
	}
	// Unrelated prompt → rejected (below threshold).
	if _, _, ok := sem.Check(ctx, "quantum chromodynamics lagrangian symmetry breaking eigenvalues"); ok {
		t.Fatal("unrelated prompt must miss")
	}
	// Threshold clamps: out-of-range ignored, in-range applied.
	sem.SetThreshold(0.10)
	if sem.Threshold() != DefaultSimilarityThreshold {
		t.Fatal("low threshold must be ignored")
	}
	sem.SetThreshold(1.5)
	if sem.Threshold() != DefaultSimilarityThreshold {
		t.Fatal("high threshold must be ignored")
	}
	sem.SetThreshold(0.99)
	if sem.Threshold() != 0.99 {
		t.Fatal("valid threshold must apply")
	}
}

func TestSemanticStoreExpiryDeleteSweepPurge(t *testing.T) {
	ctx := context.Background()
	sem := NewSemanticCache(nil) // nil → dev HashEmbedder
	if sem.embedder.Dim() != HashEmbedderDim {
		t.Fatal("nil embedder must default")
	}
	msgs := []Message{{Role: "user", Content: "refund policy question"}}
	e := Entry{Key: "k1", Model: "gpt-4o", AgentID: "a9", ResponseBody: []byte("policy"), CreatedAt: time.Now()}
	sem.Store(ctx, "gpt-4o", msgs, e, 30*time.Millisecond)
	if sem.Size() != 1 {
		t.Fatal("stored vector must count")
	}
	if _, _, ok := sem.Check(ctx, PromptText("gpt-4o", msgs)); !ok {
		t.Fatal("fresh vector must hit")
	}
	time.Sleep(50 * time.Millisecond)
	if _, _, ok := sem.Check(ctx, PromptText("gpt-4o", msgs)); ok {
		t.Fatal("expired vector must miss")
	}
	if n := sem.Sweep(); n != 1 {
		t.Fatalf("sweep: %d", n)
	}
	// Purge path with a live entry.
	sem.Store(ctx, "gpt-4o", msgs, e, time.Hour)
	if n := sem.Purge(func(en Entry) bool { return en.AgentID == "a9" }); n != 1 {
		t.Fatalf("purge: %d", n)
	}
	sem.Store(ctx, "gpt-4o", msgs, e, time.Hour)
	if !sem.Delete("k1") || sem.Delete("k1") {
		t.Fatal("delete semantics")
	}
	// Empty key / empty vector writes dropped.
	sem.StoreWithVector("", e, []float32{1}, time.Hour)
	sem.StoreWithVector("k2", e, nil, time.Hour)
	if sem.Size() != 0 {
		t.Fatal("invalid writes must drop")
	}
}

func TestQdrantStubs(t *testing.T) {
	sem := NewSemanticCache(NewHashEmbedder(8), WithQdrant("http://q:6333", "c1", "secret", nil))
	if sem.QdrantSearchURL() != "http://q:6333/collections/c1/points/search" {
		t.Fatalf("search url: %s", sem.QdrantSearchURL())
	}
	if sem.QdrantUpsertURL() != "http://q:6333/collections/c1/points/upsert" &&
		sem.QdrantUpsertURL() != "http://q:6333/collections/c1/points?wait=true" {
		t.Fatalf("upsert url: %s", sem.QdrantUpsertURL())
	}
	body, err := sem.QdrantSearchBody([]float32{0.5, 0.5}, 0)
	if err != nil || len(body) == 0 {
		t.Fatal("search body must build")
	}
	key := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	ub, err := sem.QdrantUpsertBody(key, Entry{Model: "m", AgentID: "a"}, []float32{1, 0})
	if err != nil || len(ub) == 0 {
		t.Fatal("upsert body must build")
	}
	if _, err := sem.QdrantUpsertBody("", Entry{}, []float32{1}); err == nil {
		t.Fatal("empty key must error")
	}
	// Unconfigured remote search errors without network.
	bare := NewSemanticCache(NewHashEmbedder(8))
	if _, err := bare.SearchRemote(context.Background(), []float32{1}); err != ErrQdrantNotConfigured {
		t.Fatalf("want ErrQdrantNotConfigured, got %v", err)
	}
}

func TestSearchRemoteAgainstMockQdrant(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("api-key") != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":[
			{"score":0.96,"payload":{"cache_key":"abc123"}},
			{"score":0.50,"payload":{"cache_key":"low"}},
			{"score":0.97,"payload":{}}
		]}`))
	}))
	defer srv.Close()

	sem := NewSemanticCache(NewHashEmbedder(8), WithQdrant(srv.URL, "c1", "secret", nil))
	hits, err := sem.SearchRemote(context.Background(), []float32{1, 0})
	if err != nil {
		t.Fatal(err)
	}
	// Only the above-threshold hit WITH a join key survives.
	if len(hits) != 1 || hits[0].Key != "abc123" || hits[0].Score != 0.96 {
		t.Fatalf("hits: %+v", hits)
	}
	// Upstream error surfaces.
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer bad.Close()
	semBad := NewSemanticCache(NewHashEmbedder(8), WithQdrant(bad.URL, "c1", "", nil))
	if _, err := semBad.SearchRemote(context.Background(), []float32{1}); err == nil {
		t.Fatal("5xx must error")
	}
	// Garbage JSON surfaces.
	garbage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("not json"))
	}))
	defer garbage.Close()
	semGarbage := NewSemanticCache(NewHashEmbedder(8), WithQdrant(garbage.URL, "c1", "", nil))
	if _, err := semGarbage.SearchRemote(context.Background(), []float32{1}); err == nil {
		t.Fatal("bad json must error")
	}
}

func TestHashEmbedderDeterminism(t *testing.T) {
	h := NewHashEmbedder(0)
	if h.Dim() != HashEmbedderDim {
		t.Fatal("zero dim must default")
	}
	ctx := context.Background()
	a, _ := h.Embed(ctx, "hello world")
	b, _ := h.Embed(ctx, "hello world")
	if CosineSimilarity(a, b) != 1 {
		t.Fatal("embeddings must be deterministic")
	}
	empty, _ := h.Embed(ctx, "!!! ??? ...")
	if CosineSimilarity(empty, empty) != 0 {
		t.Fatal("zero vector must score 0")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := h.Embed(cancelled, "hello world test words here"); err == nil {
		t.Fatal("cancelled ctx must error")
	}
}
