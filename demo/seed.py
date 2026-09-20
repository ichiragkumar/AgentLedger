#!/usr/bin/env python3
"""Seed the kitchen-sink demo: 5 vk_demo_* keys + 3 team budgets.

Writes full key material ONCE to demo/.keys.json (gitignored — same
sensitivity as .env). Budgets are deliberately small so burn is visible
within a few cycles. Stdlib only.
"""

import json
import os
import urllib.request

DASH = os.environ.get("DASH", "http://localhost:3000")
KEYS_FILE = "demo/.keys.json"

AGENTS = [
    ("support-bot", "support"), ("ticket-classifier", "support"),
    ("summarizer", "content"), ("code-reviewer", "engineering"),
    ("research-agent", "engineering"),
]

BUDGETS = [
    {"level": "team", "key": "support", "window": "monthly", "tokenLimit": 2000000, "dollarLimit": 5},
    {"level": "team", "key": "content", "window": "monthly", "tokenLimit": 2000000, "dollarLimit": 5},
    {"level": "team", "key": "engineering", "window": "monthly", "tokenLimit": 2000000, "dollarLimit": 10},
]


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(DASH + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status, json.loads(res.read().decode())


def main():
    keys = {}
    for agent, team in AGENTS:
        status, out = api("POST", "/api/keys", {"name": f"vk_demo_{agent}", "agentScope": agent, "teamScope": team})
        assert status == 201, out
        keys[agent] = out["fullKey"]
        synced = "proxy" if "proxySynced" not in out else "pg-fallback"
        print(f"key {agent}: {out['key']['prefix']}…{out['key']['last4']} ({synced})")
    with open(KEYS_FILE, "w", encoding="utf-8") as f:
        json.dump(keys, f)
    os.chmod(KEYS_FILE, 0o600)
    print(f"wrote {KEYS_FILE} (mode 600, gitignored)")
    for b in BUDGETS:
        status, out = api("POST", "/api/budgets", b)
        assert status in (200, 201), out
        synced = "no-mirror" if out.get("proxySynced") is False else "mirrored"
        print(f"budget team:{b['key']} ${b['dollarLimit']} ({synced})")


if __name__ == "__main__":
    main()
