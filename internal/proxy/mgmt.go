package proxy

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agentledger/agentledger/internal/auth"
	"github.com/agentledger/agentledger/internal/cache"
	"github.com/agentledger/agentledger/internal/enforce"
)

// Management plane: budgets/alerts/audit (enforce.API) + virtual-key vault.
// Mounted by NewMux when configured; nil-safe (nothing mounted when absent).
//
// Auth: open on localhost by default. If MGMT_TOKEN is set, every /v1
// management route requires `Authorization: Bearer <token>` (dashboard sends
// it server-side from PROXY_MGMT_TOKEN). Data-plane /v1/chat/completions is
// unaffected (virtual keys there).

// MountMgmt registers enforce routes plus the key vault.
func MountMgmt(mux *http.ServeMux, enforcer *enforce.API, vault *auth.Vault) {
	if enforcer != nil {
		enforcer.RegisterRoutes(mux)
	}
	if vault != nil {
		kv := &keyHandlers{vault: vault, token: os.Getenv("MGMT_TOKEN")}
		mux.HandleFunc("POST /v1/keys", kv.guard(kv.handleIssue))
		mux.HandleFunc("GET /v1/keys", kv.guard(kv.handleList))
		mux.HandleFunc("DELETE /v1/keys/{id}", kv.guard(kv.handleRevoke))
		mux.HandleFunc("POST /v1/keys/{id}/rotate", kv.guard(kv.handleRotate))
	}
}

// MountCacheMgmt registers the saver management plane. The dashboard
// /api/cache/* routes target exactly these shapes (see
// internal/cache/WIRING.md): stats snapshot, config PUT, scoped DELETE.
// Nil-safe: nothing mounted when hook is nil.
func MountCacheMgmt(mux *http.ServeMux, hook *cache.Hook) {
	if hook == nil {
		return
	}
	token := os.Getenv("MGMT_TOKEN")
	gate := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if token != "" {
				got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
				if got == "" || got != token {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "management auth required"})
					return
				}
			}
			next(w, r)
		}
	}
	mux.HandleFunc("GET /v1/cache/stats", gate(func(w http.ResponseWriter, r *http.Request) {
		snap := hook.Stats.Snapshot()
		writeJSON(w, http.StatusOK, map[string]any{
			"hit_rate":      snap.HitRate,
			"exact_hits":    snap.ExactHits,
			"semantic_hits": snap.SemanticHits,
			"misses":        snap.Misses,
			"saved_usd":     snap.SavedUSD,
			"size":          hook.Exact.Size() + hook.Semantic.Size(),
			"threshold":     hook.Semantic.Threshold(),
			"connected":     true,
		})
	}))
	mux.HandleFunc("PUT /v1/cache/config", gate(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SimilarityThreshold float64 `json:"similarity_threshold"`
			DefaultTTLSecs      int64   `json:"default_ttl_secs"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body)
		applied := map[string]any{}
		if body.SimilarityThreshold != 0 {
			// Hook clamps to [0.85,0.99]; 0.80–0.84 persists dashboard-side
			// but enforces at the floor (documented in the PUT response).
			hook.Semantic.SetThreshold(body.SimilarityThreshold)
			applied["similarity_threshold"] = hook.Semantic.Threshold()
		}
		if body.DefaultTTLSecs > 0 {
			hook.Config.DefaultTTL = time.Duration(body.DefaultTTLSecs) * time.Second
			applied["default_ttl_secs"] = body.DefaultTTLSecs
		}
		writeJSON(w, http.StatusOK, map[string]any{"applied": applied})
	}))
	mux.HandleFunc("DELETE /v1/cache", gate(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var ex, sem int
		switch {
		case q.Get("agent") != "":
			a := q.Get("agent")
			ex = hook.Exact.PurgeByAgent(a)
			sem = hook.Semantic.Purge(func(e cache.Entry) bool { return e.AgentID == a })
		case q.Get("team") != "":
			t := q.Get("team")
			ex = hook.Exact.PurgeByTeam(t)
			sem = hook.Semantic.Purge(func(e cache.Entry) bool { return e.TeamID == t })
		case q.Get("model") != "":
			m := q.Get("model")
			ex = hook.Exact.PurgeByModel(m)
			sem = hook.Semantic.Purge(func(e cache.Entry) bool { return e.Model == m })
		default:
			ex = len(hook.Exact.Keys())
			hook.Exact.Clear()
			sem = hook.Semantic.Clear()
		}
		writeJSON(w, http.StatusOK, map[string]any{"exact_removed": ex, "semantic_removed": sem})
	}))
}

type keyHandlers struct {
	vault *auth.Vault
	token string // empty = no gate (localhost dev)
}

func (k *keyHandlers) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if k.token != "" {
			got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
			if got == "" || got != k.token {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "management auth required"})
				return
			}
		}
		next(w, r)
	}
}

func (k *keyHandlers) handleIssue(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string `json:"name"`
		AgentScope string `json:"agent_scope"`
		TeamScope  string `json:"team_scope"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body)
	if strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	issued, err := k.vault.Issue(r.Context(), body.Name, body.AgentScope, body.TeamScope)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not issue key"})
		return
	}
	// Full key material returned ONCE.
	writeJSON(w, http.StatusCreated, issued)
}

func (k *keyHandlers) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := k.vault.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not list keys"})
		return
	}
	if list == nil {
		list = []auth.KeyInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": list})
}

func (k *keyHandlers) handleRevoke(w http.ResponseWriter, r *http.Request) {
	ok, err := k.vault.Revoke(r.Context(), r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not revoke key"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (k *keyHandlers) handleRotate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GraceSeconds int64 `json:"grace_seconds"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body)
	issued, err := k.vault.Rotate(r.Context(), r.PathValue("id"), time.Duration(body.GraceSeconds)*time.Second)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}
	writeJSON(w, http.StatusCreated, issued)
}
