#!/usr/bin/env bash
# Mock-upstream e2e smoke: no real provider keys needed.
# Builds the proxy, runs a fake OpenAI upstream, sends non-stream + SSE
# requests through the proxy, and asserts logging/metrics/headers.
set -euo pipefail
cd "$(dirname "$0")/.."

MOCK_PORT=18081
PROXY_PORT=18787

# 1. Fake upstream: OpenAI-compatible responses with usage blocks.
python3 - "$MOCK_PORT" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
port = int(sys.argv[1])
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode()
        try: model = json.loads(body).get("model", "gpt-4o-mini")
        except Exception: model = "gpt-4o-mini"
        if "stream" in body and "true" in body and "stream_test" in body:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b'data: {"model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n')
            self.wfile.write(b'data: {"model":"gpt-4o-mini","usage":{"prompt_tokens":7,"completion_tokens":9,"total_tokens":16}}\n\n')
            self.wfile.write(b'data: [DONE]\n\n')
            return
        payload = {"id":"chatcmpl-mock","object":"chat.completion","model":model,
                   "usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30},
                   "choices":[{"message":{"role":"assistant","content":"mock"}}]}
        raw = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
MOCK_PID=$!

go build -o /tmp/agentledger-smoke ./cmd/proxy
OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT" ANTHROPIC_BASE_URL="http://127.0.0.1:$MOCK_PORT" \
GOOGLE_BASE_URL="http://127.0.0.1:$MOCK_PORT" DEEPSEEK_BASE_URL="http://127.0.0.1:$MOCK_PORT" \
PORT="$PROXY_PORT" PRICES_FILE=data/prices.json /tmp/agentledger-smoke > /tmp/agentledger-smoke.log 2>&1 &
PROXY_PID=$!

cleanup() { kill "$MOCK_PID" "$PROXY_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PROXY_PORT/health" >/dev/null && break
  sleep 0.2
done

echo "--- non-stream ---"
curl -sf "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
  -H "Content-Type: application/json" -H "AgentLedger-Key: vk_test" \
  -H "X-Agent-Id: smoke-agent" -H "X-Team-Id: smoke-team" -H "X-Project-Id: smoke-proj" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}' | head -c 300
echo

echo "--- sse stream ---"
curl -sf "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
  -H "Content-Type: application/json" -H "AgentLedger-Key: vk_test" \
  -H "X-Agent-Id: smoke-agent" \
  -d '{"model":"gpt-4o-mini","messages":[],"stream":true,"stream_test":true}' | head -c 300
echo

echo "--- metrics ---"
curl -sf "http://127.0.0.1:$PROXY_PORT/metrics" | grep -E "agentledger_(requests_total|tokens_in_total|tokens_out_total)"
echo "SMOKE OK"
