package enforce

import (
	"testing"
	"time"
)

func TestActionForUtil(t *testing.T) {
	cases := []struct {
		util float64
		want Action
	}{
		{0, ActionAllow}, {49.9, ActionAllow},
		{50, ActionAlert}, {74.9, ActionAlert},
		{75, ActionAlert}, {89.9, ActionAlert},
		{90, ActionDowngrade}, {99.9, ActionDowngrade},
		{100, ActionHardStop}, {140, ActionHardStop},
	}
	for _, c := range cases {
		if got := ActionForUtil(c.util); got != c.want {
			t.Errorf("ActionForUtil(%v) = %v, want %v", c.util, got, c.want)
		}
	}
}

func TestAlertThresholdCrossed(t *testing.T) {
	if got := AlertThresholdCrossed(10, 80); len(got) != 2 || got[0] != 50 || got[1] != 75 {
		t.Fatalf("cross 10→80 = %v, want [50 75]", got)
	}
	if got := AlertThresholdCrossed(80, 95); len(got) != 1 || got[0] != 90 {
		t.Fatalf("cross 80→95 = %v, want [90]", got)
	}
	if got := AlertThresholdCrossed(95, 96); len(got) != 0 {
		t.Fatalf("cross 95→96 = %v, want [] (dedupe)", got)
	}
}

func fixedStore(now time.Time) *Store {
	s := NewStore()
	s.now = func() time.Time { return now }
	return s
}

func TestWindowBounds(t *testing.T) {
	now := time.Date(2026, 9, 20, 15, 4, 0, 0, time.UTC) // a Sunday
	s, r := WindowBounds(WindowDaily, now)
	if !s.Equal(time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)) || !r.Equal(s.Add(24*time.Hour)) {
		t.Fatalf("daily bounds = %v %v", s, r)
	}
	s, r = WindowBounds(WindowWeekly, now)
	if !s.Equal(time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)) || !r.Equal(s.AddDate(0, 0, 7)) {
		t.Fatalf("weekly bounds = %v %v (want Monday 9/14)", s, r)
	}
	s, r = WindowBounds(WindowMonthly, now)
	if !s.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)) || !r.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("monthly bounds = %v %v", s, r)
	}
}

func TestHierarchyEnforcedIndependently(t *testing.T) {
	now := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	s := fixedStore(now)
	// Org has a huge budget; team budget is tiny and will trip first.
	s.Upsert(Budget{ID: "org", Level: LevelOrg, Key: "acme", Window: WindowMonthly, DollarLimit: 100000})
	s.Upsert(Budget{ID: "team", Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100})
	s.Upsert(Budget{ID: "proj", Level: LevelProject, Key: "ai/copilot", Window: WindowMonthly, DollarLimit: 100000})
	s.Upsert(Budget{ID: "agent", Level: LevelAgent, Key: "ai/copilot/bot", Window: WindowMonthly, DollarLimit: 100000})

	attr := Attribution{OrgID: "acme", TeamID: "ai", ProjectID: "ai/copilot", AgentID: "ai/copilot/bot"}
	ds := s.Record(attr, 0, 90) // team at 90% → downgrade; others ~0%
	if WorstAction(ds) != ActionDowngrade {
		t.Fatalf("worst = %v, want downgrade (team binds)", WorstAction(ds))
	}
	if b := BlockingDecision(ds); b == nil || b.BudgetID != "team" {
		t.Fatalf("blocker = %+v, want team budget", b)
	}
	// Push team to 100% → hard stop even though org/proj/agent are fine.
	ds = s.Record(attr, 0, 10)
	if WorstAction(ds) != ActionHardStop {
		t.Fatalf("worst = %v, want hard_stop", WorstAction(ds))
	}
	if b := BlockingDecision(ds); b == nil || b.BudgetID != "team" || b.Action != ActionHardStop {
		t.Fatalf("blocker = %+v, want team hard_stop", b)
	}
}

func TestUtilizationBindsOnTighterDimension(t *testing.T) {
	b := Budget{TokenLimit: 1000, DollarLimit: 1000, SpentTokens: 100, SpentUSD: 900}
	if u := b.Utilization(); u != 90 {
		t.Fatalf("util = %v, want 90 (dollar binds)", u)
	}
	b = Budget{TokenLimit: 1000, SpentTokens: 500} // unlimited dollars
	if u := b.Utilization(); u != 50 {
		t.Fatalf("util = %v, want 50", u)
	}
	b = Budget{} // unlimited everything
	if u := b.Utilization(); u != 0 {
		t.Fatalf("util = %v, want 0", u)
	}
}

func TestDailyWeeklyMonthlyWindowsIndependent(t *testing.T) {
	now := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	s := fixedStore(now)
	s.Upsert(Budget{ID: "d", Level: LevelTeam, Key: "ai", Window: WindowDaily, DollarLimit: 10})
	s.Upsert(Budget{ID: "m", Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 10000})
	attr := Attribution{TeamID: "ai"}
	ds := s.Record(attr, 0, 10) // daily 100%, monthly 0.1%
	byID := map[string]Decision{}
	for _, d := range ds {
		byID[d.BudgetID] = d
	}
	if byID["d"].Action != ActionHardStop {
		t.Fatalf("daily = %v, want hard_stop", byID["d"].Action)
	}
	if byID["m"].Action != ActionAllow {
		t.Fatalf("monthly = %v, want allow", byID["m"].Action)
	}
}

func TestWindowRolloverZeroesCounters(t *testing.T) {
	day1 := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	s := fixedStore(day1)
	s.Upsert(Budget{ID: "d", Level: LevelTeam, Key: "ai", Window: WindowDaily, DollarLimit: 10})
	s.Record(Attribution{TeamID: "ai"}, 0, 10)
	// Next day: counters roll, budget allows again.
	s.now = func() time.Time { return day1.Add(24 * time.Hour) }
	ds := s.Check(Attribution{TeamID: "ai"})
	if len(ds) != 1 || ds[0].Action != ActionAllow || ds[0].Utilization != 0 {
		t.Fatalf("after roll = %+v, want fresh allow", ds)
	}
}

func TestRecordPopulatesNewlyCrossedAlerts(t *testing.T) {
	s := fixedStore(time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC))
	s.Upsert(Budget{ID: "t", Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100})
	ds := s.Record(Attribution{TeamID: "ai"}, 0, 80)
	if len(ds) != 1 || len(ds[0].Alerts) != 2 {
		t.Fatalf("alerts = %+v, want [50 75]", ds)
	}
	ds = s.Record(Attribution{TeamID: "ai"}, 0, 1) // 81% — no NEW threshold
	if len(ds[0].Alerts) != 0 {
		t.Fatalf("alerts = %+v, want [] (already fired)", ds[0].Alerts)
	}
}

func TestCRUDListDelete(t *testing.T) {
	s := fixedStore(time.Now())
	s.Upsert(Budget{ID: "b2", Level: LevelAgent, Key: "x", Window: WindowDaily, TokenLimit: 5})
	s.Upsert(Budget{ID: "b1", Level: LevelOrg, Key: "acme", Window: WindowMonthly, DollarLimit: 9})
	got, ok := s.Get("b1")
	if !ok || got.DollarLimit != 9 {
		t.Fatalf("get = %+v %v", got, ok)
	}
	if _, ok := s.Get("nope"); ok {
		t.Fatal("missing budget should not be found")
	}
	list := s.List()
	if len(list) != 2 || list[0].ID != "b2" || list[1].ID != "b1" {
		t.Fatalf("list order = %v (want agent before org)", list)
	}
	if !s.Delete("b1") || s.Delete("b1") {
		t.Fatal("delete should succeed once")
	}
}

func TestCheckIsReadOnly(t *testing.T) {
	s := fixedStore(time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC))
	s.Upsert(Budget{ID: "t", Level: LevelTeam, Key: "ai", Window: WindowMonthly, DollarLimit: 100})
	s.Check(Attribution{TeamID: "ai"})
	b, _ := s.Get("t")
	if b.SpentUSD != 0 {
		t.Fatalf("Check must not record usage, spent=%v", b.SpentUSD)
	}
	if ds := s.Check(Attribution{TeamID: "nobody"}); len(ds) != 0 {
		t.Fatalf("unmatched scope should yield no decisions, got %+v", ds)
	}
	if WorstAction(nil) != ActionAllow || BlockingDecision(nil) != nil {
		t.Fatal("empty decisions must allow with no blocker")
	}
}
