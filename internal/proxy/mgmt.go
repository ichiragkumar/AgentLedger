package proxy

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agentledger/agentledger/internal/auth"
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
