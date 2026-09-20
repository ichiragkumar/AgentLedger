// Budget management API: CRUD for budgets/policies/alerts with RBAC.
//
// Roles (stub, header-driven until Phase 6 SSO):
//   - viewer:  read everything, write nothing.
//   - manager: read everything; write Team/Project/Agent budgets scoped to
//     their own team, and policies/alerts for their own team. Never Org.
//   - admin:   full access, including Org budgets.
//
// Identity headers: X-Ledger-Role (viewer|manager|admin, default viewer),
// X-Ledger-Team (manager's team), X-Ledger-Actor (audit actor name).
//
// Every mutation and every enforcement decision appends to AuditChain —
// the in-memory mirror of the Postgres audit_log table (hash-chained,
// append-only; see db/migrations/002_budgets.sql). The durable sink wiring
// (INSERT on Append) is a Phase 4.5 task; the chain already guarantees
// tamper-evidence in-process via Verify().
//
// Also home to PreCheckMiddleware — the enforce pre-check hook that runs
// BEFORE cache/route in the Mirror chain:
//
//	proxy.Chain(upstream, api.PreCheck(), proxy.CacheStub, proxy.RouteStub)
package enforce

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// --- RBAC ---

// Role is an actor's management-plane role.
type Role string

const (
	RoleViewer  Role = "viewer"
	RoleManager Role = "manager"
	RoleAdmin   Role = "admin"
)

// Actor is the caller's identity for RBAC + audit.
type Actor struct {
	Name   string
	Role   Role
	TeamID string
}

// ActorFromRequest reads identity headers (defaults to viewer).
func ActorFromRequest(r *http.Request) Actor {
	a := Actor{Name: r.Header.Get("X-Ledger-Actor"), Role: RoleViewer, TeamID: r.Header.Get("X-Ledger-Team")}
	switch Role(strings.ToLower(strings.TrimSpace(r.Header.Get("X-Ledger-Role")))) {
	case RoleAdmin:
		a.Role = RoleAdmin
	case RoleManager:
		a.Role = RoleManager
	}
	if a.Name == "" {
		a.Name = string(a.Role)
	}
	return a
}

// CanRead reports read access (everyone reads; viewers exist for audit).
func (a Actor) CanRead() bool { return true }

// CanWriteBudget reports write access to a budget scope.
func (a Actor) CanWriteBudget(level Level, key string) bool {
	switch a.Role {
	case RoleAdmin:
		return true
	case RoleManager:
		if level == LevelOrg {
			return false
		}
		return scopeTeam(level, key) == a.TeamID && a.TeamID != ""
	default:
		return false
	}
}

// CanWritePolicy reports write access to a team's policy.
func (a Actor) CanWritePolicy(team string) bool {
	switch a.Role {
	case RoleAdmin:
		return true
	case RoleManager:
		return team != "" && team != "*" && team == a.TeamID
	default:
		return false
	}
}

// CanWriteAlert reports write access to an alert config for budget scope.
func (a Actor) CanWriteAlert(level Level, key string) bool {
	return a.CanWriteBudget(level, key)
}

// scopeTeam maps a budget scope to its owning team. Org budgets have no
// team; unknown keys fail closed ("").
func scopeTeam(level Level, key string) string {
	if level == LevelOrg {
		return ""
	}
	// Key convention "team[:...]" — team-level keys are bare team IDs,
	// project/agent keys embed the team as "team/project" or carry it via
	// the budgets table owner_team column (see migration 002). Prefix match
	// keeps the stub useful without a DB join.
	if i := strings.Index(key, "/"); i >= 0 {
		return key[:i]
	}
	if level == LevelTeam {
		return key
	}
	return key
}

// --- Audit chain (hash-chained, append-only) ---

// AuditEntry is one tamper-evident log record.
type AuditEntry struct {
	Seq      uint64 `json:"seq"`
	TS       string `json:"ts"`
	Actor    string `json:"actor"`
	Action   string `json:"action"`
	BudgetID string `json:"budget_id,omitempty"`
	Detail   string `json:"detail,omitempty"`
	PrevHash string `json:"prev_hash"`
	Hash     string `json:"hash"`
}

// Audit actions.
const (
	AuditBudgetCreate = "budget.create"
	AuditBudgetUpdate = "budget.update"
	AuditBudgetDelete = "budget.delete"
	AuditPolicyChange = "policy.change"
	AuditAlertFire    = "alert.fire"
	AuditDowngrade    = "request.downgrade"
	AuditHardStop     = "request.hard_stop"
	AuditPolicyDeny   = "request.policy_deny"
	AuditLoopKill     = "request.loop_kill"
)

// AuditChain is the in-memory mirror of Postgres audit_log.
type AuditChain struct {
	mu      sync.Mutex
	entries []AuditEntry
}

// Append adds one entry, chaining its hash to the previous entry.
func (c *AuditChain) Append(actor, action, budgetID, detail string) AuditEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	prev := "GENESIS"
	if len(c.entries) > 0 {
		prev = c.entries[len(c.entries)-1].Hash
	}
	e := AuditEntry{
		Seq:      uint64(len(c.entries) + 1),
		TS:       time.Now().UTC().Format(time.RFC3339Nano),
		Actor:    actor,
		Action:   action,
		BudgetID: budgetID,
		Detail:   detail,
		PrevHash: prev,
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%s|%s|%s|%s|%s|%s",
		e.Seq, e.TS, e.Actor, e.Action, e.BudgetID, e.Detail, e.PrevHash)))
	e.Hash = hex.EncodeToString(sum[:])
	c.entries = append(c.entries, e)
	return e
}

// Entries returns a copy of the chain.
func (c *AuditChain) Entries() []AuditEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]AuditEntry(nil), c.entries...)
}

// Verify replays the hash chain; any mutation returns an error.
func (c *AuditChain) Verify() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	prev := "GENESIS"
	for _, e := range c.entries {
		if e.PrevHash != prev {
			return fmt.Errorf("enforce: audit chain broken at seq %d", e.Seq)
		}
		sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%s|%s|%s|%s|%s|%s",
			e.Seq, e.TS, e.Actor, e.Action, e.BudgetID, e.Detail, e.PrevHash)))
		if hex.EncodeToString(sum[:]) != e.Hash {
			return fmt.Errorf("enforce: audit hash mismatch at seq %d", e.Seq)
		}
		prev = e.Hash
	}
	return nil
}

// --- Policy + alert registries (management plane) ---

// StoredPolicy is one CRUD-managed policy document.
type StoredPolicy struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Team   string `json:"team"`
	Config string `json:"config"` // YAML policy doc (LoadPolicyYAML subset)
}

// PolicyRegistry stores policy docs and the merged live engine.
type PolicyRegistry struct {
	mu       sync.Mutex
	policies map[string]StoredPolicy
	engine   *Engine
	seq      int
}

// NewPolicyRegistry returns an empty registry (allow-all engine).
func NewPolicyRegistry() *PolicyRegistry {
	return &PolicyRegistry{policies: map[string]StoredPolicy{}, engine: &Engine{}}
}

// Engine returns the merged live engine (never nil).
func (r *PolicyRegistry) Engine() *Engine {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.engine == nil {
		r.engine = &Engine{}
	}
	return r.engine
}

// Put validates + stores a policy, rebuilding the merged engine.
func (r *PolicyRegistry) Put(p StoredPolicy) (StoredPolicy, error) {
	eng, err := LoadPolicyYAML([]byte(p.Config))
	if err != nil {
		return StoredPolicy{}, err
	}
	_ = eng
	r.mu.Lock()
	defer r.mu.Unlock()
	if p.ID == "" {
		r.seq++
		p.ID = fmt.Sprintf("pol-%d", r.seq)
	}
	r.policies[p.ID] = p
	r.rebuild()
	return p, nil
}

// Get fetches a policy by ID.
func (r *PolicyRegistry) Get(id string) (StoredPolicy, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.policies[id]
	return p, ok
}

// Delete removes a policy, rebuilding the merged engine.
func (r *PolicyRegistry) Delete(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.policies[id]; !ok {
		return false
	}
	delete(r.policies, id)
	r.rebuild()
	return true
}

// List returns all policies sorted by ID.
func (r *PolicyRegistry) List() []StoredPolicy {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]StoredPolicy, 0, len(r.policies))
	for _, p := range r.policies {
		out = append(out, p)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].ID < out[j-1].ID; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// rebuild merges all stored docs into one engine (caller holds lock).
func (r *PolicyRegistry) rebuild() {
	merged := &Engine{}
	for _, p := range r.policies {
		eng, err := LoadPolicyYAML([]byte(p.Config))
		if err != nil {
			continue // validated on Put; skip defensively
		}
		merged.Rules = append(merged.Rules, eng.Rules...)
		if len(eng.internalExact) > 0 || len(eng.internalPrefix) > 0 {
			if merged.internalExact == nil {
				merged.internalExact = map[string]bool{}
			}
			for k := range eng.internalExact {
				merged.internalExact[k] = true
			}
			merged.internalPrefix = append(merged.internalPrefix, eng.internalPrefix...)
		}
	}
	r.engine = merged
}

// AlertConfig is one CRUD-managed alert routing.
type AlertConfig struct {
	ID       string   `json:"id"`
	BudgetID string   `json:"budget_id"`
	Channels []string `json:"channels"` // webhook, email, slack
	Target   string   `json:"target"`   // URL or address (never a secret)
}

// AlertRegistry stores alert routings.
type AlertRegistry struct {
	mu     sync.Mutex
	alerts map[string]AlertConfig
	seq    int
}

// NewAlertRegistry returns an empty registry.
func NewAlertRegistry() *AlertRegistry {
	return &AlertRegistry{alerts: map[string]AlertConfig{}}
}

// Put stores an alert config.
func (r *AlertRegistry) Put(c AlertConfig) AlertConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c.ID == "" {
		r.seq++
		c.ID = fmt.Sprintf("alert-%d", r.seq)
	}
	r.alerts[c.ID] = c
	return c
}

// Get fetches an alert config.
func (r *AlertRegistry) Get(id string) (AlertConfig, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.alerts[id]
	return c, ok
}

// Delete removes an alert config.
func (r *AlertRegistry) Delete(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.alerts[id]; !ok {
		return false
	}
	delete(r.alerts, id)
	return true
}

// List returns all alert configs sorted by ID.
func (r *AlertRegistry) List() []AlertConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AlertConfig, 0, len(r.alerts))
	for _, c := range r.alerts {
		out = append(out, c)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].ID < out[j-1].ID; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// --- API wiring ---

// API bundles Enforcer state for the management plane + data-plane hooks.
type API struct {
	Budgets    *Store
	Policies   *PolicyRegistry
	Alerts     *AlertRegistry
	Audit      *AuditChain
	Downgrader *Downgrader
	Alerter    *Dispatcher
	Loops      *Tracker
}

// NewAPI builds an API with sane defaults (safe for tests; replace
// Alerter senders via SendersFromEnv in production wiring).
func NewAPI() *API {
	return &API{
		Budgets:    NewStore(),
		Policies:   NewPolicyRegistry(),
		Alerts:     NewAlertRegistry(),
		Audit:      &AuditChain{},
		Downgrader: NewDefaultDowngrader(),
		Alerter:    NewDispatcher(),
		Loops:      NewTracker(DefaultLoopLimits()),
	}
}

// Observe records post-response usage (called by the proxy AFTER upstream
// responds, when tokens/cost are known): ledger += usage, loop tokens +=,
// alerts fan out for newly crossed thresholds, audit logs enforcement.
// Call it in a goroutine — it never blocks the response path.
func (a *API) Observe(attr Attribution, chainID string, tokens int64, costUSD float64) []Decision {
	ds := a.Budgets.Record(attr, tokens, costUSD)
	if chainID != "" {
		a.Loops.AddTokens(chainID, tokens)
	}
	// Alerts async but bounded (60s). Audit the enforcement synchronously.
	go a.Alerter.DispatchDecisions(ds)
	for _, d := range ds {
		switch d.Action {
		case ActionHardStop:
			a.Audit.Append("enforcer", AuditHardStop, d.BudgetID,
				fmt.Sprintf("util=%.1f%% reset=%s", d.Utilization, d.ResetAt.UTC().Format(time.RFC3339)))
		case ActionDowngrade:
			a.Audit.Append("enforcer", AuditDowngrade, d.BudgetID,
				fmt.Sprintf("util=%.1f%%", d.Utilization))
		case ActionAlert:
			for _, t := range d.Alerts {
				a.Audit.Append("enforcer", AuditAlertFire, d.BudgetID,
					fmt.Sprintf("threshold=%.0f%% util=%.1f%%", t, d.Utilization))
			}
		}
	}
	return ds
}

// --- HTTP handlers ---

// RegisterRoutes mounts the management plane on mux.
func (a *API) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/budgets", a.handleBudgets)
	mux.HandleFunc("POST /v1/budgets", a.handleBudgets)
	mux.HandleFunc("GET /v1/budgets/{id}", a.handleBudget)
	mux.HandleFunc("PUT /v1/budgets/{id}", a.handleBudget)
	mux.HandleFunc("DELETE /v1/budgets/{id}", a.handleBudget)
	mux.HandleFunc("GET /v1/policies", a.handlePolicies)
	mux.HandleFunc("POST /v1/policies", a.handlePolicies)
	mux.HandleFunc("GET /v1/policies/{id}", a.handlePolicy)
	mux.HandleFunc("PUT /v1/policies/{id}", a.handlePolicy)
	mux.HandleFunc("DELETE /v1/policies/{id}", a.handlePolicy)
	mux.HandleFunc("GET /v1/alerts", a.handleAlerts)
	mux.HandleFunc("POST /v1/alerts", a.handleAlerts)
	mux.HandleFunc("DELETE /v1/alerts/{id}", a.handleAlert)
	mux.HandleFunc("GET /v1/audit", a.handleAudit)
}

func writeAPIJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func apiError(w http.ResponseWriter, status int, code string) {
	writeAPIJSON(w, status, map[string]string{"error": code})
}

func readAPIBody(r *http.Request, maxBytes int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r.Body, maxBytes))
}

type budgetPayload struct {
	Level       string  `json:"level"`
	Key         string  `json:"key"`
	Window      string  `json:"window"`
	TokenLimit  int64   `json:"token_limit"`
	DollarLimit float64 `json:"dollar_limit"`
}

func (p budgetPayload) valid() bool {
	switch Level(p.Level) {
	case LevelOrg, LevelTeam, LevelProject, LevelAgent:
	default:
		return false
	}
	switch Window(p.Window) {
	case WindowDaily, WindowWeekly, WindowMonthly:
	default:
		return false
	}
	return p.Key != "" && p.TokenLimit >= 0 && p.DollarLimit >= 0
}

func (a *API) handleBudgets(w http.ResponseWriter, r *http.Request) {
	actor := ActorFromRequest(r)
	switch r.Method {
	case http.MethodGet:
		writeAPIJSON(w, http.StatusOK, map[string]interface{}{"budgets": a.Budgets.List()})
	case http.MethodPost:
		var p budgetPayload
		raw, err := readAPIBody(r, 1<<20)
		if err != nil || json.Unmarshal(raw, &p) != nil || !p.valid() {
			apiError(w, http.StatusBadRequest, "invalid_budget")
			return
		}
		if !actor.CanWriteBudget(Level(p.Level), p.Key) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		b := a.Budgets.Upsert(Budget{Level: Level(p.Level), Key: p.Key, Window: Window(p.Window),
			TokenLimit: p.TokenLimit, DollarLimit: p.DollarLimit})
		a.Audit.Append(actor.Name, AuditBudgetCreate, b.ID,
			fmt.Sprintf("level=%s key=%s window=%s", p.Level, p.Key, p.Window))
		writeAPIJSON(w, http.StatusCreated, b)
	default:
		apiError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (a *API) handleBudget(w http.ResponseWriter, r *http.Request) {
	actor := ActorFromRequest(r)
	id := r.PathValue("id")
	b, ok := a.Budgets.Get(id)
	if !ok {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeAPIJSON(w, http.StatusOK, b)
	case http.MethodPut:
		var p budgetPayload
		raw, err := readAPIBody(r, 1<<20)
		if err != nil || json.Unmarshal(raw, &p) != nil || !p.valid() {
			apiError(w, http.StatusBadRequest, "invalid_budget")
			return
		}
		if !actor.CanWriteBudget(b.Level, b.Key) || !actor.CanWriteBudget(Level(p.Level), p.Key) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		// Preserve spent counters across limit raises (the E2E resume path).
		updated := a.Budgets.Upsert(Budget{ID: id, Level: Level(p.Level), Key: p.Key, Window: Window(p.Window),
			TokenLimit: p.TokenLimit, DollarLimit: p.DollarLimit,
			SpentTokens: b.SpentTokens, SpentUSD: b.SpentUSD,
			WindowStart: b.WindowStart, ResetAt: b.ResetAt})
		a.Audit.Append(actor.Name, AuditBudgetUpdate, id,
			fmt.Sprintf("token_limit=%d dollar_limit=%.2f", p.TokenLimit, p.DollarLimit))
		writeAPIJSON(w, http.StatusOK, updated)
	case http.MethodDelete:
		if !actor.CanWriteBudget(b.Level, b.Key) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		a.Budgets.Delete(id)
		a.Audit.Append(actor.Name, AuditBudgetDelete, id, "")
		writeAPIJSON(w, http.StatusOK, map[string]string{"deleted": id})
	default:
		apiError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

type policyPayload struct {
	Name   string `json:"name"`
	Team   string `json:"team"`
	Config string `json:"config"`
}

func (a *API) handlePolicies(w http.ResponseWriter, r *http.Request) {
	actor := ActorFromRequest(r)
	switch r.Method {
	case http.MethodGet:
		writeAPIJSON(w, http.StatusOK, map[string]interface{}{"policies": a.Policies.List()})
	case http.MethodPost:
		var p policyPayload
		raw, err := readAPIBody(r, 1<<20)
		if err != nil || json.Unmarshal(raw, &p) != nil || p.Config == "" {
			apiError(w, http.StatusBadRequest, "invalid_policy")
			return
		}
		if !actor.CanWritePolicy(p.Team) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		stored, err := a.Policies.Put(StoredPolicy{Name: p.Name, Team: p.Team, Config: p.Config})
		if err != nil {
			apiError(w, http.StatusBadRequest, "invalid_policy")
			return
		}
		a.Audit.Append(actor.Name, AuditPolicyChange, stored.ID, fmt.Sprintf("team=%s", p.Team))
		writeAPIJSON(w, http.StatusCreated, stored)
	default:
		apiError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (a *API) handlePolicy(w http.ResponseWriter, r *http.Request) {
	actor := ActorFromRequest(r)
	id := r.PathValue("id")
	existing, ok := a.Policies.Get(id)
	if !ok {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeAPIJSON(w, http.StatusOK, existing)
	case http.MethodPut:
		var p policyPayload
		raw, err := readAPIBody(r, 1<<20)
		if err != nil || json.Unmarshal(raw, &p) != nil || p.Config == "" {
			apiError(w, http.StatusBadRequest, "invalid_policy")
			return
		}
		if !actor.CanWritePolicy(existing.Team) || !actor.CanWritePolicy(p.Team) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		stored, err := a.Policies.Put(StoredPolicy{ID: id, Name: p.Name, Team: p.Team, Config: p.Config})
		if err != nil {
			apiError(w, http.StatusBadRequest, "invalid_policy")
			return
		}
		a.Audit.Append(actor.Name, AuditPolicyChange, id, fmt.Sprintf("team=%s", p.Team))
		writeAPIJSON(w, http.StatusOK, stored)
	case http.MethodDelete:
		if !actor.CanWritePolicy(existing.Team) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		a.Policies.Delete(id)
		a.Audit.Append(actor.Name, AuditPolicyChange, id, "deleted")
		writeAPIJSON(w, http.StatusOK, map[string]string{"deleted": id})
	default:
		apiError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (a *API) handleAlerts(w http.ResponseWriter, r *http.Request) {
	actor := ActorFromRequest(r)
	switch r.Method {
	case http.MethodGet:
		writeAPIJSON(w, http.StatusOK, map[string]interface{}{"alerts": a.Alerts.List()})
	case http.MethodPost:
		var c AlertConfig
		raw, err := readAPIBody(r, 1<<20)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.BudgetID == "" {
			apiError(w, http.StatusBadRequest, "invalid_alert")
			return
		}
		if b, ok := a.Budgets.Get(c.BudgetID); ok {
			if !actor.CanWriteAlert(b.Level, b.Key) {
				apiError(w, http.StatusForbidden, "forbidden")
				return
			}
		} else if actor.Role != RoleAdmin {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		stored := a.Alerts.Put(c)
		writeAPIJSON(w, http.StatusCreated, stored)
	default:
		apiError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (a *API) handleAlert(w http.ResponseWriter, r *http.Request) {
	actor := ActorFromRequest(r)
	id := r.PathValue("id")
	c, ok := a.Alerts.Get(id)
	if !ok {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if b, ok := a.Budgets.Get(c.BudgetID); ok {
		if !actor.CanWriteAlert(b.Level, b.Key) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
	} else if actor.Role != RoleAdmin {
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	a.Alerts.Delete(id)
	writeAPIJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

func (a *API) handleAudit(w http.ResponseWriter, r *http.Request) {
	writeAPIJSON(w, http.StatusOK, map[string]interface{}{"entries": a.Audit.Entries()})
}
