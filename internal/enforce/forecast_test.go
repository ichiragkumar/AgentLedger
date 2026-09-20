package enforce

import (
	"math"
	"testing"
	"time"
)

// Two weeks of flat $10/day history → projection ≈ remaining days × $10.
func TestLinearForecastAccuracy(t *testing.T) {
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC) // mid-month
	end := MonthEnd(now)
	var samples []Sample
	for d := start; d.Before(now); d = d.AddDate(0, 0, 1) {
		samples = append(samples, Sample{T: d.Add(12 * time.Hour), CostUSD: 10})
	}
	f := ForecastSpend(samples, start, now, end)
	spent := 14.0 * 10 // 14 full days before 9/15 (9/1..9/14)
	if math.Abs(f.SpentToDate-spent) > 0.01 {
		t.Fatalf("spent = %.2f, want %.2f", f.SpentToDate, spent)
	}
	// Remaining: half of 9/15 + 15 full days (9/16..9/30) ≈ 15.5 × 10.
	want := spent + 155
	if math.Abs(f.Projected-want)/want > 0.15 {
		t.Fatalf("projected = %.2f, want ≈%.2f (±15%%)", f.Projected, want)
	}
	if f.DailyRate <= 0 || f.LowerBound >= f.Projected || f.UpperBound <= f.Projected {
		t.Fatalf("bands off: %+v", f)
	}
	if msg := f.Message(); len(msg) == 0 {
		t.Fatal("empty forecast message")
	}
}

func TestSeasonalMethodWithWeekHistory(t *testing.T) {
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
	end := MonthEnd(now)
	var samples []Sample
	for d := start; d.Before(now); d = d.AddDate(0, 0, 1) {
		cost := 10.0
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			cost = 0 // idle weekends
		}
		samples = append(samples, Sample{T: d.Add(9 * time.Hour), CostUSD: cost})
	}
	f := ForecastSpend(samples, start, now, end)
	if f.Method != "linear+seasonal" {
		t.Fatalf("method = %q, want linear+seasonal", f.Method)
	}
	// Short history degrades to linear.
	f2 := ForecastSpend(samples[:3], start, now, end)
	if f2.Method != "linear" {
		t.Fatalf("short-history method = %q, want linear", f2.Method)
	}
	// Weekend-aware projection must beat naive flat-rate by the ~4 idle
	// weekend days left in the month (margin 10 absorbs trend wiggle).
	naive := f.SpentToDate + f.DailyRate*float64(int(end.Sub(now).Hours()/24))
	if diff := naive - f.Projected; diff < 10 || diff > 60 {
		t.Fatalf("seasonal %.2f vs naive %.2f: savings %.2f out of [10,60]", f.Projected, naive, diff)
	}
}

func TestForecastEdgeCases(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := MonthEnd(now)
	if f := ForecastSpend(nil, start, now, end); f.Projected != 0 || f.Method != "linear" {
		t.Fatalf("empty = %+v", f)
	}
	// Out-of-period + negative samples ignored ($0 days count as idle signal).
	f := ForecastSpend([]Sample{
		{T: start.AddDate(0, 0, -5), CostUSD: 999},
		{T: now.Add(time.Hour), CostUSD: 999},
		{T: start.Add(2 * time.Hour), CostUSD: 0},
		{T: start.Add(3 * time.Hour), CostUSD: -5},
		{T: start.Add(4 * time.Hour), CostUSD: 20},
	}, start, now, end)
	if f.SpentToDate != 20 {
		t.Fatalf("spent = %.2f, want 20", f.SpentToDate)
	}
	// Degenerate period → zero forecast, no NaN.
	f = ForecastSpend([]Sample{{T: now, CostUSD: 5}}, now, now, now)
	if math.IsNaN(f.Projected) {
		t.Fatal("NaN projection")
	}
	if me := MonthEnd(time.Date(2026, 12, 15, 0, 0, 0, 0, time.UTC)); !me.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("year-boundary month end = %v", me)
	}
}

func TestBurndownShape(t *testing.T) {
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	pts := Burndown([]Sample{
		{T: start.Add(2 * time.Hour), CostUSD: 30},
		{T: start.AddDate(0, 0, 1).Add(time.Hour), CostUSD: 20},
	}, 300, start, end)
	if len(pts) != 30 {
		t.Fatalf("points = %d, want 30", len(pts))
	}
	if pts[0].Date != "2026-09-01" || pts[0].ActualCum != 30 || pts[0].IdealCum != 10 {
		t.Fatalf("day1 = %+v", pts[0])
	}
	if pts[1].ActualCum != 50 || pts[2].ActualCum != 50 {
		t.Fatalf("cumulative wrong: %+v", pts[:3])
	}
	if pts[29].IdealCum != 300 {
		t.Fatalf("final ideal = %.2f, want 300", pts[29].IdealCum)
	}
	if pts := Burndown(nil, 100, end, start); pts != nil && len(pts) != 1 {
		t.Fatalf("inverted period should yield ≤1 point, got %d", len(pts))
	}
}
