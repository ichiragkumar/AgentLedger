// Cache invalidation (spec 05 §2.7): single-key DELETE plus bulk purge by
// agent / team / model. Purges apply to BOTH layers so no stale semantic
// vector can resurrect a deleted exact entry. "No stale after TTL" is
// enforced by the stores themselves (lazy expiry on every Check).
package cache

// PurgeFilter selects entries for bulk deletion. Zero value matches nothing
// (use PurgeAll for full flush). Multiple set fields combine with AND.
type PurgeFilter struct {
	AgentID string
	TeamID  string
	Model   string
}

// Empty reports whether the filter selects nothing.
func (f PurgeFilter) Empty() bool {
	return f.AgentID == "" && f.TeamID == "" && f.Model == ""
}

// Matches reports whether e satisfies all set fields. Expiry is NOT checked
// here — stores purge only unexpired entries and sweep expired ones aside.
func (f PurgeFilter) Matches(e Entry) bool {
	if f.AgentID != "" && e.AgentID != f.AgentID {
		return false
	}
	if f.TeamID != "" && e.TeamID != f.TeamID {
		return false
	}
	if f.Model != "" && e.Model != f.Model {
		return false
	}
	return true
}

// PurgeResult counts removals per layer.
type PurgeResult struct {
	ExactRemoved    int `json:"exact_removed"`
	SemanticRemoved int `json:"semantic_removed"`
}

// Total is the combined removal count.
func (r PurgeResult) Total() int { return r.ExactRemoved + r.SemanticRemoved }

// DeleteKey removes one exact-match key from both layers (the semantic
// vector is keyed by the same exact key — see hook store path).
// Reports whether either layer held the key.
func DeleteKey(exact *MemoryStore, sem *SemanticCache, key string) bool {
	if key == "" {
		return false
	}
	removed := false
	if exact != nil && exact.Delete(key) {
		removed = true
	}
	if sem != nil && sem.Delete(key) {
		removed = true
	}
	return removed
}

// PurgeByAgent drops all entries tagged with agentID from both layers.
func PurgeByAgent(exact *MemoryStore, sem *SemanticCache, agentID string) PurgeResult {
	return Purge(exact, sem, PurgeFilter{AgentID: agentID})
}

// PurgeByTeam drops all entries tagged with teamID from both layers.
func PurgeByTeam(exact *MemoryStore, sem *SemanticCache, teamID string) PurgeResult {
	return Purge(exact, sem, PurgeFilter{TeamID: teamID})
}

// PurgeByModel drops all entries for model from both layers.
func PurgeByModel(exact *MemoryStore, sem *SemanticCache, model string) PurgeResult {
	return Purge(exact, sem, PurgeFilter{Model: model})
}

// Purge drops entries matching f (AND semantics) from both layers.
// Empty filters are no-ops returning a zero result.
func Purge(exact *MemoryStore, sem *SemanticCache, f PurgeFilter) PurgeResult {
	var r PurgeResult
	if f.Empty() {
		return r
	}
	match := func(e Entry) bool { return f.Matches(e) }
	if exact != nil {
		r.ExactRemoved = exact.purge(match)
	}
	if sem != nil {
		r.SemanticRemoved = sem.Purge(match)
	}
	return r
}

// PurgeAll flushes both layers entirely (destructive; operator-gated in the
// API layer Mirror will add: DELETE /v1/cache with no scope).
func PurgeAll(exact *MemoryStore, sem *SemanticCache) PurgeResult {
	var r PurgeResult
	if exact != nil {
		r.ExactRemoved = exact.Size()
		exact.Clear()
	}
	if sem != nil {
		r.SemanticRemoved = sem.Size()
		sem.mu.Lock()
		sem.items = make(map[string]semanticItem)
		sem.mu.Unlock()
	}
	return r
}
