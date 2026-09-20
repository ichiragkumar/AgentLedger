package auth

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestVaultIssueResolveListRevoke(t *testing.T) {
	v := NewVault(nil)
	ctx := context.Background()
	issued, err := v.Issue(ctx, "test-key", "demo-bot", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(issued.Key, "vk_") || len(issued.Key) != 3+32 {
		t.Fatalf("bad key shape: %q", issued.Key)
	}
	res, err := v.Resolve(issued.Key)
	if err != nil {
		t.Fatalf("resolve issued: %v", err)
	}
	if res.KeyPrefix == "" || res.KeyPrefix == issued.Key || len(res.KeyPrefix) > 8 {
		t.Fatalf("prefix must be short redacted form, got %q", res.KeyPrefix)
	}
	list, err := v.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %d, %v", len(list), err)
	}
	if list[0].Prefix == "" || list[0].Last4 == "" {
		t.Fatal("list must carry prefix/last4")
	}
	ok, err := v.Revoke(ctx, issued.ID)
	if err != nil || !ok {
		t.Fatalf("revoke = %v, %v", ok, err)
	}
	if _, err := v.Resolve(issued.Key); err == nil {
		t.Fatal("revoked key must not resolve")
	}
	if _, err := v.Resolve("vk_doesnotexist00000000000000000000"); err == nil {
		t.Fatal("unknown key must not resolve")
	}
}

func TestVaultRotate(t *testing.T) {
	v := NewVault(nil)
	ctx := context.Background()
	a, err := v.Issue(ctx, "rot", "*", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := v.Rotate(ctx, a.ID, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if b.Key == a.Key {
		t.Fatal("rotated key must differ")
	}
	if _, err := v.Resolve(b.Key); err != nil {
		t.Fatalf("new key must resolve: %v", err)
	}
	if _, err := v.Rotate(ctx, "nope", 0); err == nil {
		t.Fatal("rotating unknown id must fail")
	}
}

func TestVaultStoredOnlyHashes(t *testing.T) {
	v := NewVault(nil)
	ctx := context.Background()
	issued, _ := v.Issue(ctx, "h", "", "")
	for hash := range v.mem {
		if strings.Contains(hash, issued.Key) || hash == issued.Key {
			t.Fatal("raw material stored in map")
		}
		if len(hash) != 64 {
			t.Fatalf("stored value must be sha256 hex, got %q", hash)
		}
	}
}
