# Kitchen-sink demo (local proof, spec 21)

5 Acme agents doing real work through the local proxy. Metering is real;
only the LLM *text* is mock (see honesty contract in spec 21).

## Run order
```zsh
# 1. infra (if not already up)
docker compose up -d postgres redis qdrant

# 2. mock upstream (terminal A)
python3 demo/mock_upstream.py

# 3. proxy pointed at the mock (terminal B — all *_BASE_URL to :9999)
OPENAI_BASE_URL=http://127.0.0.1:9999 \
ANTHROPIC_BASE_URL=http://127.0.0.1:9999 \
GOOGLE_BASE_URL=http://127.0.0.1:9999 \
DEEPSEEK_BASE_URL=http://127.0.0.1:9999 \
DATABASE_URL='postgres://agentledger:agentledger@localhost:5432/agentledger?sslmode=disable' \
PORT=8787 go run ./cmd/proxy

# 4. dashboard (terminal C) — already serves :3000? skip if running
npm run dev --workspace=agentledger-dashboard

# 5. seed keys + budgets (terminal D)
python3 demo/seed.py

# 6. run traffic
python3 demo/runner.py --once
```

Then open `http://localhost:3000/overview`: 5 agents, 3 teams, spend,
budget burn. `demo/.keys.json` holds key material (mode 600, gitignored —
treat like `.env`). Swap `*_BASE_URL` to real providers when keys exist;
zero demo code changes.
