// Pre-check hook: the enforce middleware that runs BEFORE cache/route.
//
// Chain position (spec 02 request flow): enforce → cache → route → upstream.
// In server wiring this replaces the Mirror EnforceStub:
//
//	proxy.Chain(upstream, api.PreCheck(), proxy.CacheStub, proxy.RouteStub)
//
// Per-request order inside PreCheck:
//  1. attribution (X-Agent-Id/Team/Project, X-Org-Id default "default")
//  2. policy eval (YAML engine) → deny 403, audit
//  3. loop kill (depth at pre-check) → deny 429, audit
//  4. budget Check (no write — usage lands post-response via Observe)
//     → hard stop 429 (hardstop.go shape), audit
//     → downgrade: rewrite model one tier cheaper, same request, audit
//     → allow: passthrough + diagnostic headers
//
// Downgrade never drops the call: the JSON body is rewritten in place and
// the request continues down the chain. Usage recording stays post-response
// (API.Observe) so cache hits and upstream errors don't burn budget.
package enforce

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Attribution headers consumed on the data plane (Mirror contract + org).
const (
	HeaderAgentID   = "X-Agent-Id"
	HeaderTeamID    = "X-Team-Id"
	HeaderProjectID = "X-Project-Id"
	HeaderChainID   = "X-Request-Chain-Id"
	HeaderOrgID     = "X-Org-Id"
)

// DefaultOrgID applies when no org header is sent (single-org installs).
const DefaultOrgID = "default"

// LoopKillBody is the 429 shape for runaway-chain kills.
type LoopKillBody struct {
	Error   string `json:"error"`
	ChainID string `json:"chain_id"`
	Reason  string `json:"reason"`
}

// PolicyDenyBody is the 403 shape for policy denials.
type PolicyDenyBody struct {
	Error  string `json:"error"`
	Reason string `json:"reason"`
	Rule   string `json:"rule"`
}

// AttributionFromRequest reads scope headers (data plane).
func AttributionFromRequest(r *http.Request) Attribution {
	org := strings.TrimSpace(r.Header.Get(HeaderOrgID))
	if org == "" {
		org = DefaultOrgID
	}
	return Attribution{
		OrgID:     org,
		TeamID:    strings.TrimSpace(r.Header.Get(HeaderTeamID)),
		ProjectID: strings.TrimSpace(r.Header.Get(HeaderProjectID)),
		AgentID:   strings.TrimSpace(r.Header.Get(HeaderAgentID)),
	}
}

// precheckBody is the parsed subset needed for policy/downgrade decisions.
// The raw body is always forwarded (rewritten only on downgrade).
type precheckBody struct {
	Model     string `json:"model"`
	MaxTokens *int   `json:"max_tokens,omitempty"`
	Messages  []struct {
		Content string `json:"content"`
	} `json:"messages,omitempty"`
}

// PreCheck returns the enforce middleware bound to api state.
func (a *API) PreCheck() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-AgentLedger-Enforce", "enforcing")
			attr := AttributionFromRequest(r)
			chainID := strings.TrimSpace(r.Header.Get(HeaderChainID))

			// Read + restore the body (cap 10MB, Mirror parity).
			raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
			if err != nil {
				writeAPIJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read body"})
				return
			}
			_ = r.Body.Close()
			r.Body = io.NopCloser(bytes.NewReader(raw))
			r.ContentLength = int64(len(raw))

			var pb precheckBody
			_ = json.Unmarshal(raw, &pb) // missing model → policy/budget still apply by scope
			maxTokens := 0
			if pb.MaxTokens != nil {
				maxTokens = *pb.MaxTokens
			}
			var text strings.Builder
			for _, m := range pb.Messages {
				if m.Content != "" {
					if text.Len() > 0 {
						text.WriteByte('\n')
					}
					text.WriteString(m.Content)
					if text.Len() > 32<<10 {
						break // cap PII scan input at 32KB
					}
				}
			}

			// 1. Policy eval.
			if eng := a.Policies.Engine(); eng != nil && len(eng.Rules) > 0 {
				res := eng.Eval(PolicyRequest{
					Model: pb.Model, Team: attr.TeamID, Agent: attr.AgentID,
					MaxTokens: maxTokens, HourUTC: time.Now().UTC().Hour(), Text: text.String(),
				})
				if !res.Allow {
					a.Audit.Append(attr.AgentID, AuditPolicyDeny, "",
						fmt.Sprintf("rule=%s reason=%s model=%s", res.Rule, res.Reason, pb.Model))
					w.Header().Set(DenyReasonHeader, "policy_denied reason="+res.Reason)
					writeAPIJSON(w, http.StatusForbidden, PolicyDenyBody{
						Error: "policy_denied", Reason: res.Reason, Rule: res.Rule})
					return
				}
			}

			// 2. Loop kill (depth counted here; tokens added post-response).
			if chainID != "" {
				if kill, reason := a.Loops.Record(chainID, 0); kill {
					a.Audit.Append(attr.AgentID, AuditLoopKill, "", reason)
					w.Header().Set(DenyReasonHeader, "loop_killed chain="+chainID)
					writeAPIJSON(w, StatusBudgetExceeded, LoopKillBody{
						Error: "loop_killed", ChainID: chainID, Reason: reason})
					return
				}
			}

			// 3. Budget pre-check (read-only; Observe records post-response).
			ds := a.Budgets.Check(attr)
			switch WorstAction(ds) {
			case ActionHardStop:
				blocker := BlockingDecision(ds)
				a.Audit.Append(attr.AgentID, AuditHardStop, blocker.BudgetID,
					fmt.Sprintf("util=%.1f%% reset=%s", blocker.Utilization,
						blocker.ResetAt.UTC().Format(time.RFC3339)))
				w.Header().Set("X-AgentLedger-Budget", blocker.BudgetID)
				w.Header().Set("X-AgentLedger-Utilization",
					strconv.Itoa(int(blocker.Utilization+0.5))+"%")
				WriteHardStop(w, blocker.BudgetID, blocker.Utilization, blocker.ResetAt)
				return
			case ActionDowngrade:
				if next2, changed := a.Downgrader.Downgrade(pb.Model); changed {
					rewritten := rewriteModel(raw, next2)
					r.Body = io.NopCloser(bytes.NewReader(rewritten))
					r.ContentLength = int64(len(rewritten))
					r.Header.Set(a.Downgrader.DowngradeHeader, pb.Model+"->"+next2)
					w.Header().Set(a.Downgrader.DowngradeHeader, pb.Model+"->"+next2)
					if blocker := BlockingDecision(ds); blocker != nil {
						a.Audit.Append(attr.AgentID, AuditDowngrade, blocker.BudgetID,
							fmt.Sprintf("model %s->%s util=%.1f%%", pb.Model, next2, blocker.Utilization))
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// rewriteModel swaps the top-level "model" value, preserving other fields.
// Falls back to the original bytes when the body isn't a JSON object.
func rewriteModel(raw []byte, model string) []byte {
	var obj map[string]interface{}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return raw
	}
	obj["model"] = model
	out, err := json.Marshal(obj)
	if err != nil {
		return raw
	}
	return out
}
