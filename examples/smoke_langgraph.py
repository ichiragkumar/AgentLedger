"""LangGraph-style e2e smoke test for the AgentLedger Mirror (no real keys).

Runs against the proxy with OPENAI_BASE_URL pointed at it. For CI without
provider keys, point the proxy at the mock in examples/smoke.sh instead —
this script documents the real-agent path (CrewAI/LangGraph send identical
OpenAI-compatible requests with attribution headers).

Usage:
    OPENAI_BASE_URL=http://localhost:8787/v1 python examples/smoke_langgraph.py
"""
import json
import os
import urllib.request

BASE = os.environ.get("OPENAI_BASE_URL", "http://localhost:8787/v1").rstrip("/")
VKEY = os.environ.get("AGENTLEDGER_KEY", "vk_test")
URL = BASE + "/chat/completions"

def post(payload: dict, stream: bool = False):
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "AgentLedger-Key": VKEY,
            "X-Agent-Id": "smoke-agent",
            "X-Team-Id": "smoke-team",
            "X-Project-Id": "smoke-project",
            "X-Request-Chain-Id": "smoke-chain-1",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print("status:", resp.status)
        print("provider:", resp.headers.get("X-AgentLedger-Provider"))
        print("cost:", resp.headers.get("X-AgentLedger-Cost-Usd"))
        body = resp.read().decode()
        print("body:", body[:300])
        return resp.status

# Non-streaming (works against a mock upstream in CI).
post({"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "ping"}]})
print("SMOKE OK — check spend with: curl localhost:8787/metrics")
