# 03 — Phase 0: Foundation (Week 0, Day 1-3)

> Prev: [02-architecture-tech-stack](./02-architecture-tech-stack.md) | Parent: [00-index](./00-index.md) | Next: [04-phase-1-mirror](./04-phase-1-mirror.md)

### *"Set up the bones before you build the house"*

## What You Ship
Project skeleton, CI/CD, and development environment.

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 0.1 | Initialize Go module, project structure (cmd/, internal/, pkg/, api/) | Clean repo | 2hr |
| 0.2 | Set up GitHub repo, branch protection, PR templates | Collaborative-ready | 1hr |
| 0.3 | Docker Compose for local dev (proxy + Redis + Postgres + Qdrant) | `docker compose up` works | 3hr |
| 0.4 | CI pipeline (GitHub Actions: lint, test, build, Docker image) | Green badge on main | 2hr |
| 0.5 | Basic Makefile (build, test, run, docker) | Developer ergonomics | 1hr |
| 0.6 | README with architecture diagram, quickstart placeholder | First impression ready | 1hr |

## Acceptance Criteria
- [ ] `git clone && docker compose up` brings up all services in <60 seconds
- [ ] `make test` runs (even with 0 tests, the pipeline is green)
- [ ] PR to `main` triggers CI automatically
- [ ] README explains what AgentLedger is in <30 seconds of reading

## Suggested Repo Layout
```
cmd/proxy/
internal/proxy/ logger/ pricing/ auth/
pkg/models/
api/openapi.yaml
docker-compose.yml
Makefile
.github/workflows/ci.yml
specs/
```
