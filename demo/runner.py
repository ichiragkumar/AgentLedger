#!/usr/bin/env python3
"""Kitchen-sink runner: 5 Acme agents doing real work through AgentLedger.

Each agent sends OpenAI-compatible payloads to the proxy with its own
virtual key + attribution headers. Models are chosen per the AFTER plan
(cheap where valid); the proxy meters everything for real. Research-agent
runs 3 chained steps (planner → researcher → writer) with chain headers so
the topology fallback path lights up.

Usage:
  python3 demo/runner.py --once                 # one pass, all agents
  python3 demo/runner.py --cycles 10 --interval 60
Env: PROXY (default http://localhost:8787), KEYS (default demo/.keys.json).
Stdlib only.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request

PROXY = os.environ.get("PROXY", "http://localhost:8787")
KEYS_FILE = os.environ.get("KEYS", "demo/.keys.json")
FIX = "demo/fixtures"


def load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return json.load(f)


def call(model, messages, key, agent, team, project="acme-demo", chain=None, parent=None, timeout=60):
    body = json.dumps({"model": model, "messages": messages}).encode()
    req = urllib.request.Request(
        PROXY + "/v1/chat/completions", data=body,
        headers={"Content-Type": "application/json", "AgentLedger-Key": key,
                 "X-Agent-Id": agent, "X-Team-Id": team, "X-Project-Id": project},
    )
    if chain:
        req.add_header("X-Request-Chain-Id", chain)
    if parent:
        req.add_header("X-Parent-Agent-Id", parent)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            out = json.loads(res.read().decode())
    except Exception as e:  # noqa: BLE001 — demo runner reports, never crashes
        return {"ok": False, "error": str(e)[:120], "ms": (time.time() - t0) * 1000}
    usage = out.get("usage", {})
    ms = (time.time() - t0) * 1000
    return {"ok": True, "model": model, "agent": agent,
            "prompt": usage.get("prompt_tokens", 0), "completion": usage.get("completion_tokens", 0),
            "ms": round(ms, 1)}


def one_cycle(keys, i):
    faqs = load("faqs.json"); tickets = load("tickets.json")
    articles = load("articles.json"); code = load("code.json"); research = load("research.json")
    calls = []
    # 1. support-bot — repeat-prone FAQs (cache bait incl. near-duplicates)
    q = faqs[i % len(faqs)]
    calls.append(call("gemini-2.0-flash", [{"role": "user", "content": f"Answer this customer FAQ concisely: {q}"}],
                      keys["support-bot"], "support-bot", "support"))
    # 2. ticket-classifier — simple task, cheapest tier
    t = tickets[i % len(tickets)]
    calls.append(call("gemini-2.0-flash", [{"role": "user", "content": f"Classify this support ticket as billing/technical/general/urgent with priority and sentiment: {t}"}],
                      keys["ticket-classifier"], "ticket-classifier", "support"))
    # 3. summarizer — long input, moderate tier
    a = articles[i % len(articles)]
    calls.append(call("claude-3-5-haiku", [{"role": "user", "content": f"Summarize this article in 3 bullet points. Title: {a['title']}. Body: {a['body']}"}],
                      keys["summarizer"], "summarizer", "content"))
    # 4. code-reviewer — tier by complexity
    c = code[i % len(code)]
    model = "claude-3-5-haiku" if c["complexity"] == "simple" else "claude-3-5-sonnet"
    calls.append(call(model, [{"role": "user", "content": f"Review this {c['language']} code. Return issues, suggestions, score/10: {c['code']}"}],
                      keys["code-reviewer"], "code-reviewer", "engineering"))
    # 5. research-agent — 3 chained steps, frontier planner
    rq = research[i % len(research)]
    chain = "demo-chain-%d" % (i // 1)
    calls.append(call("gpt-4o", [{"role": "user", "content": f"Break this research question into 3 sub-questions: {rq}"}],
                      keys["research-agent"], "planner", "engineering", chain=chain))
    calls.append(call("claude-3-5-sonnet", [{"role": "user", "content": f"Research and summarize 3 sources about: {rq}"}],
                      keys["research-agent"], "researcher", "engineering", chain=chain, parent="planner"))
    calls.append(call("claude-3-5-haiku", [{"role": "user", "content": f"Synthesize a final structured answer about: {rq}"}],
                      keys["research-agent"], "writer", "engineering", chain=chain, parent="researcher"))
    return calls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--cycles", type=int, default=1)
    ap.add_argument("--interval", type=int, default=60)
    args = ap.parse_args()
    if not os.path.exists(KEYS_FILE):
        print(f"missing {KEYS_FILE} — run: python3 demo/seed.py", file=sys.stderr)
        sys.exit(1)
    keys = json.load(open(KEYS_FILE, encoding="utf-8"))
    n = 1 if args.once else args.cycles
    total_ok = total_fail = 0
    for i in range(n):
        print(f"--- cycle {i + 1}/{n} ---")
        for r in one_cycle(keys, i):
            if r.get("ok"):
                total_ok += 1
                print(f"ok  {r['agent']:<18} {r['model']:<20} in={r['prompt']:<5} out={r['completion']:<4} {r['ms']}ms")
            else:
                total_fail += 1
                print(f"FAIL {r.get('error', '?')}")
        if not args.once and i < n - 1:
            time.sleep(args.interval)
    print(f"done: {total_ok} ok, {total_fail} failed")
    digest = hashlib.sha256(str(total_ok).encode()).hexdigest()[:6]
    print(f"run id: {digest} (match request counts on the dashboard)")


if __name__ == "__main__":
    main()
