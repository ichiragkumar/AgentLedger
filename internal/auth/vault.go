// Vault issues and validates virtual keys (vk_*) for the key-vault API.
//
// Storage: Postgres table virtual_keys when a pool is supplied, else
// in-memory (dev/tests). Only sha256 hashes are stored — full key material
// is returned ONCE at issue/rotate time and never again. List endpoints
// expose prefix/last4 only. Implements auth.Resolver so the proxy accepts
// issued keys on the data plane without any code change there.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// KeyInfo is the list-safe view of a virtual key (no material).
type KeyInfo struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	AgentScope string     `json:"agent_scope"`
	TeamScope  string     `json:"team_scope"`
	Prefix     string     `json:"prefix"`
	Last4      string     `json:"last4"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	Revoked    bool       `json:"revoked"`
	// GraceExpiresAt is set on a rotated (revoked-but-honored) key; the key
	// resolves until this time. RotatedFrom links the replacement chain.
	GraceExpiresAt *time.Time `json:"grace_expires_at,omitempty"`
	RotatedFrom    string     `json:"rotated_from,omitempty"`
}

// IssuedKey is returned ONCE at issue/rotate time.
type IssuedKey struct {
	KeyInfo
	Key string `json:"key"`
}

type vaultEntry struct {
	info KeyInfo
	hash string
}

// Vault stores virtual keys in Postgres (preferred) or memory.
type Vault struct {
	mu      sync.Mutex
	pool    *pgxpool.Pool
	mem     map[string]*vaultEntry // hash -> entry
	byID    map[string]*vaultEntry // id -> entry
	grace   time.Duration          // default rotate grace
	nowFunc func() time.Time
}

// NewVault builds a vault. pool may be nil (memory mode).
func NewVault(pool *pgxpool.Pool) *Vault {
	return &Vault{
		pool:    pool,
		mem:     map[string]*vaultEntry{},
		byID:    map[string]*vaultEntry{},
		grace:   10 * time.Minute,
		nowFunc: time.Now,
	}
}

// HashKey returns the hex sha256 of key material (what is stored).
func HashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Issue creates a key. The full key is in the return value ONLY.
func (v *Vault) Issue(ctx context.Context, name, agentScope, teamScope string) (*IssuedKey, error) {
	id, err := randomHex(8)
	if err != nil {
		return nil, err
	}
	secret, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	key := "vk_" + secret
	info := KeyInfo{
		ID: id, Name: name, AgentScope: agentScope, TeamScope: teamScope,
		Prefix: "vk_" + secret[:4], Last4: secret[len(secret)-4:],
		CreatedAt: v.nowFunc().UTC(),
	}
	entry := &vaultEntry{info: info, hash: HashKey(key)}
	if v.pool != nil {
		_, err = v.pool.Exec(ctx, `INSERT INTO virtual_keys
			(id, name, agent_scope, team_scope, key_hash, key_prefix, key_last4)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			id, name, agentScope, teamScope, entry.hash, info.Prefix, info.Last4)
		if err != nil {
			return nil, fmt.Errorf("vault: insert: %w", err)
		}
	} else {
		v.mu.Lock()
		v.mem[entry.hash] = entry
		v.byID[id] = entry
		v.mu.Unlock()
	}
	out := &IssuedKey{KeyInfo: info, Key: key}
	return out, nil
}

// Resolve implements Resolver. Revoked (or grace-expired) keys are rejected.
func (v *Vault) Resolve(virtualKey string) (Resolution, error) {
	if virtualKey == "" || len(virtualKey) > maxVirtualKeyLen {
		return Resolution{}, ErrUnknownKey
	}
	hash := HashKey(virtualKey)
	if v.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var prefix string
		var revokedAt, grace *time.Time
		err := v.pool.QueryRow(ctx, `SELECT key_prefix, revoked_at, grace_expires_at
			FROM virtual_keys WHERE key_hash = $1`, hash).Scan(&prefix, &revokedAt, &grace)
		if err != nil {
			return Resolution{}, ErrUnknownKey
		}
		now := v.nowFunc().UTC()
		if revokedAt != nil && (grace == nil || now.After(*grace)) {
			return Resolution{}, ErrUnknownKey
		}
		go v.touch(hash)
		return Resolution{KeyPrefix: prefix}, nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	e, ok := v.mem[hash]
	if !ok || e.info.Revoked {
		return Resolution{}, ErrUnknownKey
	}
	now := time.Now().UTC()
	e.info.LastUsedAt = &now
	return Resolution{KeyPrefix: e.info.Prefix}, nil
}

// touch updates last_used_at best-effort (never fails a request).
func (v *Vault) touch(hash string) {
	if v.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, _ = v.pool.Exec(ctx, `UPDATE virtual_keys SET last_used_at = now() WHERE key_hash = $1`, hash)
}

// List returns prefix-only views (newest first in PG, undefined order in memory).
func (v *Vault) List(ctx context.Context) ([]KeyInfo, error) {
	if v.pool != nil {
		rows, err := v.pool.Query(ctx, `SELECT id, name, agent_scope, team_scope,
			key_prefix, key_last4, created_at, last_used_at, revoked_at IS NOT NULL,
			grace_expires_at, COALESCE(rotated_from, '')
			FROM virtual_keys ORDER BY created_at DESC`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []KeyInfo
		for rows.Next() {
			var k KeyInfo
			if err := rows.Scan(&k.ID, &k.Name, &k.AgentScope, &k.TeamScope,
				&k.Prefix, &k.Last4, &k.CreatedAt, &k.LastUsedAt, &k.Revoked,
				&k.GraceExpiresAt, &k.RotatedFrom); err != nil {
				return nil, err
			}
			out = append(out, k)
		}
		return out, rows.Err()
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	out := make([]KeyInfo, 0, len(v.byID))
	for _, e := range v.byID {
		out = append(out, e.info)
	}
	return out, nil
}

// Revoke kills a key immediately (grace cleared).
func (v *Vault) Revoke(ctx context.Context, id string) (bool, error) {
	if v.pool != nil {
		tag, err := v.pool.Exec(ctx, `UPDATE virtual_keys
			SET revoked_at = now(), grace_expires_at = NULL WHERE id = $1`, id)
		if err != nil {
			return false, err
		}
		return tag.RowsAffected() > 0, nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	e, ok := v.byID[id]
	if !ok {
		return false, nil
	}
	e.info.Revoked = true
	return true, nil
}

// Rotate revokes id (with grace) and issues a fresh key with the same
// name/scope. The old key works until grace expires.
func (v *Vault) Rotate(ctx context.Context, id string, grace time.Duration) (*IssuedKey, error) {
	if grace <= 0 {
		grace = v.grace
	}
	if v.pool != nil {
		var name, agentScope, teamScope string
		err := v.pool.QueryRow(ctx, `SELECT name, agent_scope, team_scope
			FROM virtual_keys WHERE id = $1 AND revoked_at IS NULL`, id).
			Scan(&name, &agentScope, &teamScope)
		if err != nil {
			return nil, fmt.Errorf("vault: rotate: key not found")
		}
		issued, err := v.Issue(ctx, name, agentScope, teamScope)
		if err != nil {
			return nil, err
		}
		_, err = v.pool.Exec(ctx, `UPDATE virtual_keys
			SET revoked_at = now(), grace_expires_at = now() + ($1::text)::interval, rotated_from = $2
			WHERE id = $3`, grace.String(), issued.ID, id)
		if err != nil {
			return nil, err
		}
		return issued, nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	e, ok := v.byID[id]
	if !ok || e.info.Revoked {
		return nil, fmt.Errorf("vault: rotate: key not found")
	}
	e.info.Revoked = true
	graceUntil := v.nowFunc().UTC().Add(grace)
	e.info.GraceExpiresAt = &graceUntil
	// Issue inline (same logic, memory path).
	rawID, _ := randomHex(8)
	secret, _ := randomHex(16)
	key := "vk_" + secret
	info := KeyInfo{
		ID: rawID, Name: e.info.Name, AgentScope: e.info.AgentScope, TeamScope: e.info.TeamScope,
		Prefix: "vk_" + secret[:4], Last4: secret[len(secret)-4:],
		CreatedAt: v.nowFunc().UTC(),
	}
	ne := &vaultEntry{info: info, hash: HashKey(key)}
	v.mem[ne.hash] = ne
	v.byID[rawID] = ne
	return &IssuedKey{KeyInfo: info, Key: key}, nil
}
