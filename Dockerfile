# ---- build ----
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
# stdlib only: no deps to download, but keep the layer warm for Phase 2 (redis/pgx)
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/proxy ./cmd/proxy

# ---- run ----
FROM gcr.io/distroless/static-debian12:nonroot AS run
WORKDIR /app
COPY --from=build /out/proxy /app/proxy
COPY data/prices.json /app/data/prices.json
ENV PORT=8787 PRICES_FILE=/app/data/prices.json
EXPOSE 8787
USER nonroot:nonroot
ENTRYPOINT ["/app/proxy"]
