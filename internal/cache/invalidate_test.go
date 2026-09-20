package cache

import (
	"testing"
	"time"
)

func seededLayers() (*MemoryStore, *SemanticCache) {
	exact := NewMemoryStore(time.Hour)
	sem := NewSemanticCache(NewHashEmbedder(32))
	mk := func(key, model, agent, team string) Entry {
		return Entry{Key: key, Model: model, AgentID: agent, TeamID: team,
			StatusCode: 200, ResponseBody: []byte("r:" + key), CreatedAt: time.Now()}
	}
	for _, e := range []Entry{
		mk("k1", "gpt-4o", "a1", "t1"),
		mk("k2", "gpt-4o", "a2", "t1"),
		mk("k3", "claude", "a2", "t2"),
	} {
		exact.Store(e)
		sem.StoreWithVector(e.Key, e, []float32{1, 0, 0, 0}, time.Hour)
	}
	return exact, sem
}

func TestDeleteKeyBothLayers(t *testing.T) {
	exact, sem := seededLayers()
	if !DeleteKey(exact, sem, "k1") {
		t.Fatal("must report removal")
	}
	if _, ok := exact.Check("k1"); ok {
		t.Fatal("exact must drop")
	}
	if sem.Delete("k1") {
		t.Fatal("semantic must already be dropped")
	}
	if DeleteKey(exact, sem, "k1") {
		t.Fatal("second delete must report false")
	}
	if DeleteKey(exact, sem, "") {
		t.Fatal("empty key must report false")
	}
	if DeleteKey(nil, nil, "k2") {
		t.Fatal("nil stores must report false")
	}
}

func TestPurgeDimensions(t *testing.T) {
	exact, sem := seededLayers()
	if r := PurgeByAgent(exact, sem, "a2"); r.Total() != 4 {
		t.Fatalf("agent purge both layers: %+v", r)
	}
	exact, sem = seededLayers()
	if r := PurgeByTeam(exact, sem, "t1"); r.ExactRemoved != 2 || r.SemanticRemoved != 2 {
		t.Fatalf("team purge: %+v", r)
	}
	exact, sem = seededLayers()
	if r := PurgeByModel(exact, sem, "gpt-4o"); r.Total() != 4 {
		t.Fatalf("model purge: %+v", r)
	}
	// Filters AND across fields.
	exact, sem = seededLayers()
	if r := Purge(exact, sem, PurgeFilter{AgentID: "a2", TeamID: "t2"}); r.ExactRemoved != 1 {
		t.Fatalf("AND filter: %+v", r)
	}
	// Empty filter is a no-op.
	exact, sem = seededLayers()
	if r := Purge(exact, sem, PurgeFilter{}); r.Total() != 0 {
		t.Fatalf("empty filter must no-op: %+v", r)
	}
	if exact.Size() != 3 {
		t.Fatal("no-op must not remove")
	}
}

func TestPurgeFilterMatches(t *testing.T) {
	e := Entry{Model: "m", AgentID: "a", TeamID: "t"}
	if !(PurgeFilter{}.Matches(e)) {
		t.Fatal("zero filter matches everything by itself (Purge guards Empty)")
	}
	if !(PurgeFilter{AgentID: "a"}.Matches(e)) || (PurgeFilter{AgentID: "x"}.Matches(e)) {
		t.Fatal("agent match")
	}
	if !(PurgeFilter{TeamID: "t"}.Matches(e)) || (PurgeFilter{TeamID: "x"}.Matches(e)) {
		t.Fatal("team match")
	}
	if !(PurgeFilter{Model: "m"}.Matches(e)) || (PurgeFilter{Model: "x"}.Matches(e)) {
		t.Fatal("model match")
	}
	f := PurgeFilter{AgentID: "a"}
	if f.Empty() {
		t.Fatal("non-empty filter")
	}
	if !(PurgeFilter{}.Empty()) {
		t.Fatal("zero filter is empty")
	}
}

func TestPurgeAll(t *testing.T) {
	exact, sem := seededLayers()
	r := PurgeAll(exact, sem)
	if r.ExactRemoved != 3 || r.SemanticRemoved != 3 {
		t.Fatalf("purge all: %+v", r)
	}
	if exact.Size() != 0 || sem.Size() != 0 {
		t.Fatal("layers must be empty")
	}
	empty := PurgeAll(nil, nil)
	if empty.Total() != 0 {
		t.Fatal("nil purge-all is zero")
	}
}
