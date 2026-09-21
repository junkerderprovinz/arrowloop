# arrowloop: two-way file synchronisation with a state database and a brake
#
# GitHub:  https://github.com/junkerderprovinz/arrowloop
# Image:   ghcr.io/junkerderprovinz/arrowloop
# License: AGPL-3.0-only
#
# One static Go binary. rclone is compiled in as a library rather than run as a
# second executable, so there is no version skew between the tool and the thing
# it drives.

# The web and build stages run on the runner's own platform and cross-compile,
# rather than being emulated under QEMU for the arm64 target.
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --no-audit --no-fund
COPY web/ ./web/
RUN npm --prefix web run build

FROM --platform=$BUILDPLATFORM golang:1.27-bookworm@sha256:648f440f42a0958804efb24df176f806f9d353b41f1c0627f666428e40310f6b AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
# Each file the web package embeds is named here. A file added beside embed.go
# and not here fails with "pattern ...: no matching files found", and only in
# this build, because every other build has the whole checkout.
COPY web/*.go web/placeholder.html ./web/
COPY --from=web /src/web/dist ./web/dist

ARG TARGETOS
ARG TARGETARCH
# Shown in the startup banner and the READY line; "dev" marks an unstamped
# local build.
ARG VERSION=dev
# -trimpath keeps the build machine's directory layout out of the binary, so the
# same commit produces the same bytes wherever it is built.
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags "-s -w -X github.com/junkerderprovinz/arrowloop/internal/boot.Version=${VERSION}" \
    -o /out/arrowloop ./cmd/arrowloop

FROM debian:stable-slim@sha256:5bc3287b25407c965a30f38e32603dc253a3869e1b12a21ac09bfc27fd8b13ce AS runtime

LABEL org.opencontainers.image.title="arrowloop" \
      org.opencontainers.image.description="Two-way file synchronisation with a per-file state database, a trash, and brakes that refuse an implausible deletion." \
      org.opencontainers.image.source="https://github.com/junkerderprovinz/arrowloop" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

# ca-certificates for TLS to the cloud backends, tini so a stop signal reaches
# the process rather than being swallowed by PID 1, tzdata so a cron schedule
# means local time.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tini tzdata; \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /out/arrowloop /usr/local/bin/arrowloop

# Holds arrowloop.json, the per-job state databases and the run log.
VOLUME ["/config"]
EXPOSE 8422

# Inside a container the binary's loopback default would be unreachable. The
# interface has no login of its own, so the exposure decision belongs to
# whoever publishes the port.
#
# The image runs as root and writes into someone else's share. With umask 022
# every file would land as 0644 root:root, readable but not changeable by the
# share's owner; 000 matches an Unraid share's 0777 nobody:users. Set it to 022
# for the restrictive behaviour.
ENV ARROWLOOP_ADDR=0.0.0.0:8422 \
    ARROWLOOP_UMASK=000 \
    TZ=Europe/Berlin

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/arrowloop", "healthcheck"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/arrowloop"]
CMD ["web", "-config", "/config/arrowloop.json"]
