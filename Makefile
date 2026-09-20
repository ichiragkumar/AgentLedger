.PHONY: build test vet run docker docker-up docker-down tidy smoke

BINARY := bin/proxy
VERSION ?= dev

build:
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=$(VERSION)" -o $(BINARY) ./cmd/proxy

test:
	go test ./... -count=1

test-cover:
	go test ./... -count=1 -coverprofile=coverage.out
	go tool cover -func=coverage.out | tail -20

vet:
	go vet ./...

tidy:
	go mod tidy

run: build
	PORT=8787 PRICES_FILE=data/prices.json ./$(BINARY)

docker:
	docker build -t agentledger/proxy:$(VERSION) .

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down -v

# Smoke test against a local mock upstream (no real keys needed).
# Starts the proxy with OPENAI_BASE_URL pointed at the mock, sends one
# non-stream + one SSE request, checks /metrics.
smoke:
	bash examples/smoke.sh
