// Budget hierarchy: Org → Team → Project → Agent.
//
// Each level carries independent monthly/weekly/daily token + dollar limits.
// A request is checked against every applicable level; the most restrictive
// decision wins. A zero limit means "unlimited" for that dimension.
//
// Utilization is the max of token% and dollar% (whichever burns faster
// governs). All hot-path work is map lookups + float ops (<1µs typical).
package enforce

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Level is a scope in the budget hierarchy, ordered outermost → innermost.
type Level string

const (
	LevelOrg     Level = "org"
	LevelTeam    Level = "team"
	LevelProject Level = "project"
	LevelAgent   Level = "agent"
)

// Levels lists the hierarchy outermost-first.
var Levels = []Level{LevelOrg, LevelTeam, LevelProject, LevelAgent}

// Window is the reset cadence for a budget.
type Window string

const (
	WindowDaily   Window = "daily"
	WindowWeekly  Window = "weekly"
	WindowMonthly Window = "monthly"
)

// Budget is one limit node. Spent counters reset when now >= ResetAt;
// Store.Record rolls windows forward automatically.
type Budget struct {
	ID          string
	Level       Level
	Key         string // scope key: org id / team id / project id / agent id
	Window      Window
	TokenLimit  int64   // 0 = unlimited
	DollarLimit float64 // 0 = unlimited
	// Counters for the current window.
	SpentTokens int64
	SpentUSD    float64
	WindowStart time.Time
	ResetAt     time.Time
}

// Attribution identifies the request's scope keys at all four levels.
type Attribution struct {
	OrgID     string
	TeamID    string
	ProjectID string
	AgentID   string
}

// Decision is the enforcement outcome for one budget level.
type Decision struct {
	BudgetID    string
	Level       Level
	Utilization float64 // percent, max(token%, dollar%)
	Action      Action
	ResetAt     time.Time
	// Alerts lists newly crossed soft thresholds (50/75/90).
	Alerts []float64
}

// WindowBounds returns the [start, resetAt) for window containing now.
// Daily resets at UTC midnight, weekly on Monday 00:00 UTC, monthly on the
// 1st 00:00 UTC.
func WindowBounds(w Window, now time.Time) (start, resetAt time.Time) {
	now = now.UTC()
	switch w {
	case WindowDaily:
		start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		resetAt = start.Add(24 * time.Hour)
	case WindowWeekly:
		// Monday 00:00 UTC.
		wd := int(now.Weekday())
		if wd == 0 {
			wd = 7 // Sunday → 7
		}
		midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		start = midnight.AddDate(0, 0, -(wd - 1))
		resetAt = start.AddDate(0, 0, 7)
	default: // WindowMonthly
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		resetAt = start.AddDate(0, 1, 0)
	}
	return start, resetAt
}

// TokenUtil returns token utilization percent (0 when unlimited).
func (b *Budget) TokenUtil() float64 {
	if b.TokenLimit <= 0 {
		return 0
	}
	return float64(b.SpentTokens) / float64(b.TokenLimit) * 100
}

// DollarUtil returns dollar utilization percent (0 when unlimited).
func (b *Budget) DollarUtil() float64 {
	if b.DollarLimit <= 0 {
		return 0
	}
	return b.SpentUSD / b.DollarLimit * 100
}

// Utilization returns max(token%, dollar%) — the binding constraint.
func (b *Budget) Utilization() float64 {
	t, d := b.TokenUtil(), b.DollarUtil()
	if d > t {
		return d
	}
	return t
}

// roll advances the window while now is past ResetAt, zeroing counters.
// Budgets created without bounds are initialized to the current window.
func (b *Budget) roll(now time.Time) {
	if b.ResetAt.IsZero() {
		b.WindowStart, b.ResetAt = WindowBounds(b.Window, now)
		return
	}
	for !now.Before(b.ResetAt) {
		b.WindowStart, b.ResetAt = WindowBounds(b.Window, b.ResetAt)
		b.SpentTokens, b.SpentUSD = 0, 0
	}
}

// Store is a concurrency-safe budget registry + usage ledger.
type Store struct {
	mu      sync.Mutex
	budgets map[string]*Budget // id → budget
	// index maps level|key|window → id for hierarchy lookup.
	index map[string]string
	now   func() time.Time // overridable in tests
}

// NewStore returns an empty budget store.
func NewStore() *Store {
	return &Store{
		budgets: map[string]*Budget{},
		index:   map[string]string{},
		now:     time.Now,
	}
}

func indexKey(level Level, key string, w Window) string {
	return string(level) + "\x00" + key + "\x00" + string(w)
}

// Upsert creates or replaces a budget. Window bounds are initialized to the
// current window when ResetAt is zero.
func (s *Store) Upsert(b Budget) *Budget {
	s.mu.Lock()
	defer s.mu.Unlock()
	if b.ID == "" {
		b.ID = fmt.Sprintf("%s:%s:%s", b.Level, b.Key, b.Window)
	}
	cp := b
	cp.roll(s.now().UTC())
	s.budgets[cp.ID] = &cp
	s.index[indexKey(cp.Level, cp.Key, cp.Window)] = cp.ID
	out := cp
	return &out
}

// Get returns a budget by ID (copy, ok=false when missing).
func (s *Store) Get(id string) (Budget, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.budgets[id]
	if !ok {
		return Budget{}, false
	}
	return *b, true
}

// Delete removes a budget by ID.
func (s *Store) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.budgets[id]
	if !ok {
		return false
	}
	delete(s.index, indexKey(b.Level, b.Key, b.Window))
	delete(s.budgets, id)
	return true
}

// List returns all budgets sorted by (level, key, window) for stable output.
func (s *Store) List() []Budget {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Budget, 0, len(s.budgets))
	for _, b := range s.budgets {
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Level != out[j].Level {
			return out[i].Level < out[j].Level
		}
		if out[i].Key != out[j].Key {
			return out[i].Key < out[j].Key
		}
		return out[i].Window < out[j].Window
	})
	return out
}

// lookup returns the budget for level/key/window (caller holds lock).
func (s *Store) lookup(level Level, key string, w Window) *Budget {
	if key == "" {
		return nil
	}
	id, ok := s.index[indexKey(level, key, w)]
	if !ok {
		return nil
	}
	return s.budgets[id]
}

// matching returns applicable budgets outermost → innermost across ALL
// windows (daily/weekly/monthly are enforced independently).
func (s *Store) matching(a Attribution) []*Budget {
	keys := map[Level]string{
		LevelOrg:     a.OrgID,
		LevelTeam:    a.TeamID,
		LevelProject: a.ProjectID,
		LevelAgent:   a.AgentID,
	}
	var out []*Budget
	for _, lvl := range Levels {
		for _, w := range []Window{WindowDaily, WindowWeekly, WindowMonthly} {
			if b := s.lookup(lvl, keys[lvl], w); b != nil {
				out = append(out, b)
			}
		}
	}
	return out
}

// Check evaluates attribution against every applicable budget without
// recording usage. Returns one decision per matching budget; empty means
// no budgets apply (allow).
func (s *Store) Check(a Attribution) []Decision {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	var out []Decision
	for _, b := range s.matching(a) {
		b.roll(now)
		util := b.Utilization()
		out = append(out, Decision{
			BudgetID:    b.ID,
			Level:       b.Level,
			Utilization: util,
			Action:      ActionForUtil(util),
			ResetAt:     b.ResetAt,
		})
	}
	return out
}

// Record adds tokens/cost to every applicable budget and returns the
// post-write decisions with newly crossed alert thresholds populated.
// Levels are enforced independently — callers must honor the most
// restrictive action (see WorstAction).
func (s *Store) Record(a Attribution, tokens int64, costUSD float64) []Decision {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	var out []Decision
	for _, b := range s.matching(a) {
		b.roll(now)
		prev := b.Utilization()
		b.SpentTokens += tokens
		b.SpentUSD += costUSD
		util := b.Utilization()
		out = append(out, Decision{
			BudgetID:    b.ID,
			Level:       b.Level,
			Utilization: util,
			Action:      ActionForUtil(util),
			ResetAt:     b.ResetAt,
			Alerts:      AlertThresholdCrossed(prev, util),
		})
	}
	return out
}

// WorstAction returns the most restrictive action in decisions
// (hard_stop > downgrade > alert > allow). Empty → allow.
func WorstAction(ds []Decision) Action {
	worst := ActionAllow
	rank := map[Action]int{
		ActionAllow: 0, ActionAlert: 1, ActionDowngrade: 2, ActionHardStop: 3,
	}
	for _, d := range ds {
		if rank[d.Action] > rank[worst] {
			worst = d.Action
		}
	}
	return worst
}

// BlockingDecision returns the decision carrying the worst action
// (outermost level wins ties) — used for the 429 budget_id.
func BlockingDecision(ds []Decision) *Decision {
	if len(ds) == 0 {
		return nil
	}
	rank := map[Action]int{
		ActionAllow: 0, ActionAlert: 1, ActionDowngrade: 2, ActionHardStop: 3,
	}
	levelRank := map[Level]int{
		LevelOrg: 0, LevelTeam: 1, LevelProject: 2, LevelAgent: 3,
	}
	best := ds[0]
	for _, d := range ds[1:] {
		if rank[d.Action] > rank[best.Action] ||
			(rank[d.Action] == rank[best.Action] && levelRank[d.Level] < levelRank[best.Level]) {
			best = d
		}
	}
	return &best
}
