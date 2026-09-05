# =============================================================================
# reeveroll — two-way file synchronisation with a state database and a brake
#
# GitHub:  https://github.com/junkerderprovinz/reeveroll
# Image:   ghcr.io/junkerderprovinz/reeveroll
# License: AGPL-3.0-only
#
# One static Go binary. rclone is compiled IN as a library rather than shelled
# out to, so unlike most sync images this one carries no second executable and
# no version skew between the tool and the thing it drives.
# Multi-arch amd64 + arm64; buildx provides TARGETOS/TARGETARCH for cross-build.
# =============================================================================

# buildx injects BUILDPLATFORM, the runner's own platform. Pinning the web and
# build stages to it makes them run NATIVELY and cross-compile, rather than
# being emulated under QEMU for the arm64 target.
ARG BUILDPLATFORM

# ---- Stage 1: web (build the interface into web/dist) -----------------------
# Arch-independent output, so it is built once on the native runner platform.
FROM --platform=$BUILDPLATFORM node:24-slim AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --no-audit --no-fund
COPY web/ ./web/
RUN npm --prefix web run build

# ---- Stage 2: build (cross-compile the static binary) -----------------------
FROM --platform=$BUILDPLATFORM golang:1.26-bookworm AS build
WORKDIR /src

# The module graph first, so `go mod download` is cached across source changes.
COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
# web/embed.go plus the built interface, so the //go:embed all:dist inside it
# resolves against something real rather than against the placeholder page.
COPY web/*.go ./web/
COPY --from=web /src/web/dist ./web/dist

ARG TARGETOS
ARG TARGETARCH
# Stamped into the binary and printed in the startup banner and the READY line,
# so the running image's version is visible in the container log. "dev" for an
# unstamped local build, which is worth being able to see.
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags "-s -w -X github.com/junkerderprovinz/reeveroll/internal/boot.Version=${VERSION}" \
    -o /out/reeveroll ./cmd/reeveroll

# ---- Stage 3: runtime -------------------------------------------------------
FROM debian:stable-slim AS runtime

LABEL org.opencontainers.image.title="reeveroll" \
      org.opencontainers.image.description="Two-way file synchronisation with a per-file state database, a trash, and brakes that refuse an implausible deletion." \
      org.opencontainers.image.source="https://github.com/junkerderprovinz/reeveroll" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

# ca-certificates for TLS to S3 and WebDAV, tini so a stop signal reaches the
# process rather than being swallowed by PID 1, tzdata so a cron schedule means
# what the person who wrote it meant.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tini tzdata; \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /out/reeveroll /usr/local/bin/reeveroll

# /config holds reeveroll.json, the per-job state databases and the run log.
# It is the one directory that must survive the container, and the template
# says so.
VOLUME ["/config"]
EXPOSE 8422

# 0.0.0.0 here rather than the binary's own loopback default: inside a container
# loopback would mean nobody can reach it at all. The exposure decision belongs
# to whoever publishes the port, and the template documents that this interface
# has no login of its own.
ENV REEVEROLL_ADDR=0.0.0.0:8422 \
    TZ=Europe/Berlin

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/reeveroll", "healthcheck"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/reeveroll"]
CMD ["web", "-config", "/config/reeveroll.json"]
