#!/usr/bin/env python3
"""Mock upstream LLM — deterministic completions + realistic usage.

Listens on 127.0.0.1:9999 and answers ANY POST path with an OpenAI-style
chat.completions payload. Token counts scale with input length
(words * 1.33) so proxy cost math is realistic; completion length derives
deterministically from the prompt hash. The *text* is mock (labeled); all
metering downstream of it is real. Stdlib only.
"""

import hashlib
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 9999


def tokens_for(text: str) -> int:
    return max(1, int(len(text.split()) * 1.33))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            n = 0
        raw = self.rfile.read(n) if n > 0 else b"{}"
        try:
            body = json.loads(raw.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            body = {}
        model = str(body.get("model", "mock-model"))
        messages = body.get("messages", [])
        prompt_text = " ".join(str(m.get("content", "")) for m in messages if isinstance(m, dict))
        prompt_tokens = tokens_for(prompt_text) + 8  # framing overhead

        digest = hashlib.sha256(prompt_text.encode()).hexdigest()
        completion_tokens = 40 + (int(digest[:4], 16) % 80)
        answer = (
            f"[mock upstream · {model}] Answer derived from {prompt_tokens} "
            f"prompt tokens (digest {digest[:8]}). This text is mock; "
            f"all metering of this request is real."
        )
        payload = {
            "id": f"chatcmpl-mock-{digest[:8]}",
            "object": "chat.completion",
            "created": 1789893000,
            "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                      "total_tokens": prompt_tokens + completion_tokens},
        }
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # quiet
        pass


if __name__ == "__main__":
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"mock upstream on 127.0.0.1:{PORT} (any POST path)")
    srv.serve_forever()
