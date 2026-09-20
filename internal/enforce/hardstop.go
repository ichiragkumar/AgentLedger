// Hard stop: at 100% utilization reject with HTTP 429 + clear JSON.
//
// Exact body contract (spec 07 acceptance):
//
//	{"error":"budget_exceeded","budget_id":"...","utilization":"100%","reset_at":"..."}
//
// reset_at is RFC3339 UTC. A Retry-After header (seconds until reset) and
// X-AgentLedger-Deny-Reason are set for operator visibility.
package enforce

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// StatusBudgetExceeded is the HTTP status for hard stops.
const StatusBudgetExceeded = http.StatusTooManyRequests // 429

// ErrBudgetExceeded is the error code in the 429 body.
const ErrBudgetExceeded = "budget_exceeded"

// DenyReasonHeader marks enforcement denials for log correlation.
const DenyReasonHeader = "X-AgentLedger-Deny-Reason"

// HardStopBody is the exact 429 JSON shape.
type HardStopBody struct {
	Error       string `json:"error"`
	BudgetID    string `json:"budget_id"`
	Utilization string `json:"utilization"`
	ResetAt     string `json:"reset_at"`
}

// NewHardStopBody builds the 429 payload. utilPct is floored at 100%
// display ("100%") even when overspent (e.g. 104.2% → "100%")? No —
// overshoot is informative, so values >100 round to whole percent
// ("104%"). At exactly the boundary it renders "100%".
func NewHardStopBody(budgetID string, utilPct float64, resetAt time.Time) HardStopBody {
	return HardStopBody{
		Error:       ErrBudgetExceeded,
		BudgetID:    budgetID,
		Utilization: strconv.Itoa(int(utilPct+0.5)) + "%",
		ResetAt:     resetAt.UTC().Format(time.RFC3339),
	}
}

// WriteHardStop writes the 429 hard-stop response. Never fails open:
// header write order is status-last so a partial write still carries 429.
func WriteHardStop(w http.ResponseWriter, budgetID string, utilPct float64, resetAt time.Time) {
	body := NewHardStopBody(budgetID, utilPct, resetAt)
	raw, _ := json.Marshal(body)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(DenyReasonHeader, fmt.Sprintf("budget_exceeded budget=%s util=%s", budgetID, body.Utilization))
	if secs := int(time.Until(resetAt).Seconds()); secs > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(secs))
	}
	w.WriteHeader(StatusBudgetExceeded)
	_, _ = w.Write(raw)
}

// IsHardStop reports whether utilPct trips the hard stop.
func IsHardStop(utilPct float64) bool { return utilPct >= ThresholdHardStop }
