package cache

import (
	"testing"
	"time"
)

func testEntry(key string) Entry {
	return Entry{
		Key: key, Model: "gpt-4o", AgentID: "a1", TeamID: "t1",
		StatusCode: 200, ContentType: "application/json",
		ResponseBody: []byte(`{"ok":true}`),
		CreatedAt:    time.Now(),
	}
}

func TestMemoryStoreRoundTrip(t *testing.T) {
	s := NewMemoryStore(time.Hour)
	s.Store(testEntry("k1"))
	e, ok := s.Check("k1")
	if !ok || string(e.ResponseBody) != `{"ok":true}` {
		t.Fatalf("round trip failed: %+v %v", e, ok)
	}
	if e.Hits != 1 {
		t.Fatalf("hits: %d", e.Hits)
	}
	if _, ok := s.Check("missing"); ok {
		t.Fatal("missing key must miss")
	}
	h, m, _ := s.Counters()
	if h != 1 || m != 1 {
		t.Fatalf("counters h=%d m=%d", h, m)
	}
}

func TestMemoryStoreTTLExpiry(t *testing.T) {
	s := NewMemoryStore(20 * time.Millisecond)
	s.Store(testEntry("k1"))
	if _, ok := s.Check("k1"); !ok {
		t.Fatal("must hit before TTL")
	}
	time.Sleep(40 * time.Millisecond)
	if _, ok := s.Check("k1"); ok {
		t.Fatal("no stale responses after TTL expiry")
	}
	if s.Size() != 0 {
		t.Fatal("expired entry must not count toward size")
	}
}

func TestMemoryStoreExplicitExpiry(t *testing.T) {
	s := NewMemoryStore(time.Hour)
	e := testEntry("k1")
	e.ExpiresAt = time.Now().Add(-time.Second) // already stale
	s.Store(e)
	if _, ok := s.Check("k1"); ok {
		t.Fatal("pre-expired entry must miss")
	}
	e2 := testEntry("k2")
	e2.ExpiresAt = time.Now().Add(time.Hour)
	s.StoreWithTTL(e2, 0) // explicit expiry kept when ttl <= 0
	if _, ok := s.Check("k2"); !ok {
		t.Fatal("explicit future expiry must hit")
	}
	s.StoreWithTTL(testEntry("k3"), 50*time.Millisecond)
	time.Sleep(70 * time.Millisecond)
	if _, ok := s.Check("k3"); ok {
		t.Fatal("StoreWithTTL expiry must hold")
	}
}

func TestMemoryStoreDeleteSweepKeys(t *testing.T) {
	s := NewMemoryStore(time.Hour)
	s.Store(testEntry("b"))
	s.Store(testEntry("a"))
	if keys := s.Keys(); len(keys) != 2 || keys[0] != "a" || keys[1] != "b" {
		t.Fatalf("sorted keys: %v", keys)
	}
	if !s.Delete("a") || s.Delete("a") {
		t.Fatal("delete semantics")
	}
	e := testEntry("stale")
	e.ExpiresAt = time.Now().Add(-time.Second)
	s.Store(e)
	if n := s.Sweep(); n != 1 {
		t.Fatalf("sweep: %d", n)
	}
	s.Clear()
	if s.Size() != 0 {
		t.Fatal("clear must empty store")
	}
	s.Store(Entry{}) // empty key dropped
	if s.Size() != 0 {
		t.Fatal("empty key must be dropped")
	}
}

func TestMemoryStorePurges(t *testing.T) {
	s := NewMemoryStore(time.Hour)
	e1 := testEntry("k1")
	e1.AgentID, e1.TeamID, e1.Model = "a1", "t1", "gpt-4o"
	e2 := testEntry("k2")
	e2.AgentID, e2.TeamID, e2.Model = "a2", "t1", "claude-sonnet"
	e3 := testEntry("k3")
	e3.AgentID, e3.TeamID, e3.Model = "a2", "t2", "gpt-4o"
	s.Store(e1)
	s.Store(e2)
	s.Store(e3)
	if n := s.PurgeByAgent("a2"); n != 2 {
		t.Fatalf("purge agent: %d", n)
	}
	if s.Size() != 1 {
		t.Fatalf("size after agent purge: %d", s.Size())
	}
	s.Store(e2)
	s.Store(e3)
	if n := s.PurgeByTeam("t1"); n != 2 {
		t.Fatalf("purge team: %d", n)
	}
	s.Store(e1)
	s.Store(e2)
	s.Store(e3)
	if n := s.PurgeByModel("gpt-4o"); n != 2 {
		t.Fatalf("purge model: %d", n)
	}
}

func TestMemoryStoreDefaultTTLAndHitRate(t *testing.T) {
	s := NewMemoryStore(0) // falls back to DefaultTTL
	if s.defaultTTL != DefaultTTL {
		t.Fatal("zero TTL must fall back")
	}
	if s.HitRate() != 0 {
		t.Fatal("empty hit rate 0")
	}
	s.Store(testEntry("k"))
	s.Check("k")
	s.Check("nope")
	if s.HitRate() != 0.5 {
		t.Fatalf("hit rate: %v", s.HitRate())
	}
}
