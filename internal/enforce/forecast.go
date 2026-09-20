// Cost forecasting: linear + seasonal projection.
//
// Message shape: "at this rate you'll spend $X by month end".
// Method: aggregate samples into UTC-day buckets, fit least-squares trend
// on daily burn, then scale the day-of-week seasonal index (weekday vs
// weekend behavior) over remaining days. With <7 days of history the
// seasonal index degrades to the plain linear trend (documented in Method).
//
// Accuracy target: within 15% over a 2-week backtest vs actual.
package enforce

import (
	"fmt"
	"sort"
	"time"
)

// Sample is one spend observation (aggregate freely: per-request or hourly).
type Sample struct {
	T       time.Time
	CostUSD float64
}

// Forecast is a projection to periodEnd.
type Forecast struct {
	SpentToDate float64 // observed spend in period so far
	Projected   float64 // spent + projected remainder
	DailyRate   float64 // trend daily burn at `now`
	Method      string  // "linear+seasonal" or "linear"
	LowerBound  float64 // projected ±20% planning band
	UpperBound  float64
}

// Message renders the headline ("you'll spend $X by month end").
func (f Forecast) Message() string {
	return fmt.Sprintf("at this rate you'll spend $%.2f by month end", f.Projected)
}

// MonthEnd returns 00:00 UTC on the 1st of next month.
func MonthEnd(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0)
}

// ForecastSpend projects spend from samples in [periodStart, periodEnd).
// Samples outside the period are ignored. Empty history → zero forecast.
func ForecastSpend(samples []Sample, periodStart, now, periodEnd time.Time) Forecast {
	periodStart = periodStart.UTC()
	now = now.UTC()
	periodEnd = periodEnd.UTC()
	f := Forecast{Method: "linear"}
	if !now.After(periodStart) || !periodEnd.After(now) {
		return f
	}
	// Bucket into UTC days.
	type dayKey string
	daily := map[dayKey]float64{}
	dowSum := map[time.Weekday]float64{}
	dowCount := map[time.Weekday]int{}
	for _, s := range samples {
		t := s.T.UTC()
		if t.Before(periodStart) || !t.Before(now) || s.CostUSD < 0 {
			continue // out-of-period and negative (corrupt) samples ignored; $0 days are real signal
		}
		k := dayKey(t.Format("2006-01-02"))
		daily[k] += s.CostUSD
		dowSum[t.Weekday()] += s.CostUSD
		dowCount[t.Weekday()]++
	}
	for _, v := range daily {
		f.SpentToDate += v
	}
	if len(daily) == 0 {
		return f
	}
	// Least-squares trend over sorted days: y = a + b*x.
	keys := make([]string, 0, len(daily))
	for k := range daily {
		keys = append(keys, string(k))
	}
	sort.Strings(keys)
	n := float64(len(keys))
	var sx, sy, sxx, sxy float64
	for i, k := range keys {
		x, y := float64(i), daily[dayKey(k)]
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
	}
	den := n*sxx - sx*sx
	slope := 0.0
	mean := sy / n
	if den != 0 {
		slope = (n*sxy - sx*sy) / den
	}
	intercept := mean - slope*(sx/n)
	f.DailyRate = intercept + slope*(n-1)
	if f.DailyRate < 0 {
		f.DailyRate = mean // never project negative burn
		if f.DailyRate < 0 {
			f.DailyRate = 0
		}
	}
	// Seasonal index: per-weekday mean / overall daily mean.
	useSeasonal := len(daily) >= 7 && mean > 0
	var idx map[time.Weekday]float64
	if useSeasonal {
		idx = map[time.Weekday]float64{}
		for d := time.Sunday; d <= time.Saturday; d++ {
			if dowCount[d] == 0 {
				idx[d] = 1
				continue
			}
			idx[d] = (dowSum[d] / float64(dowCount[d])) / mean
		}
		f.Method = "linear+seasonal"
	}
	// Project remaining days: walk calendar days from tomorrow to periodEnd.
	// x continues the trend index (elapsedDays = today's index + 1 base).
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	elapsedDays := int(today.Sub(periodStart).Hours()/24) + 1
	if elapsedDays < 1 {
		elapsedDays = 1
	}
	proj := 0.0
	for d := today.AddDate(0, 0, 1); d.Before(periodEnd); d = d.AddDate(0, 0, 1) {
		dayIdx := float64(elapsedDays + int(d.Sub(today).Hours()/24))
		trend := intercept + slope*dayIdx
		if trend < 0 {
			trend = 0
		}
		if useSeasonal {
			trend *= idx[d.Weekday()]
		}
		proj += trend
	}
	// Add today's remaining burn (prorate by unfinished fraction of day).
	dayFrac := 1 - float64(now.Hour()*3600+now.Minute()*60+now.Second())/86400
	todayRate := f.DailyRate
	if useSeasonal {
		todayRate *= idx[now.Weekday()]
	}
	proj += todayRate * dayFrac
	f.Projected = f.SpentToDate + proj
	f.LowerBound = f.Projected * 0.8
	f.UpperBound = f.Projected * 1.2
	return f
}

// BurndownPoint is one dashboard row: ideal vs actual cumulative spend.
type BurndownPoint struct {
	Date      string  // YYYY-MM-DD
	IdealCum  float64 // budget * elapsed/total
	ActualCum float64
}

// Burndown builds per-day cumulative actuals vs the ideal straight line
// for budget over [periodStart, periodEnd).
func Burndown(samples []Sample, budgetUSD float64, periodStart, periodEnd time.Time) []BurndownPoint {
	periodStart = periodStart.UTC()
	periodEnd = periodEnd.UTC()
	totalDays := int(periodEnd.Sub(periodStart).Hours() / 24)
	if totalDays < 1 {
		totalDays = 1
	}
	daily := map[string]float64{}
	for _, s := range samples {
		t := s.T.UTC()
		if t.Before(periodStart) || !t.Before(periodEnd) {
			continue
		}
		daily[t.Format("2006-01-02")] += s.CostUSD
	}
	out := make([]BurndownPoint, 0, totalDays)
	cum := 0.0
	for i := 0; i < totalDays; i++ {
		d := periodStart.AddDate(0, 0, i)
		cum += daily[d.Format("2006-01-02")]
		out = append(out, BurndownPoint{
			Date:      d.Format("2006-01-02"),
			IdealCum:  budgetUSD * float64(i+1) / float64(totalDays),
			ActualCum: cum,
		})
	}
	return out
}
