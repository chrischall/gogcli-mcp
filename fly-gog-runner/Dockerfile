# fly-gog-runner image: Node 22 + the `gog` CLI binary, run as a non-root user.
# Multi-stage: the builder downloads/extracts gog; the final image carries only
# the binary + server.mjs (no curl, no apt lists).

FROM node:22-bookworm-slim AS builder

# TARGETARCH is amd64/arm64 — matches gog's release asset naming exactly.
ARG TARGETARCH
ARG GOG_VERSION=0.34.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  url="https://github.com/openclaw/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_${TARGETARCH}.tar.gz"; \
  curl -fsSL "$url" -o /tmp/gog.tar.gz; \
  tar -xzf /tmp/gog.tar.gz -C /tmp; \
  install -m 0755 /tmp/gog /usr/local/bin/gog; \
  rm -f /tmp/gog.tar.gz; \
  gog --version

FROM node:22-bookworm-slim

# ca-certificates: gog's HTTPS calls to Google APIs. gosu: the entrypoint drops
# from root to the `app` user after fixing the volume's ownership.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/gog /usr/local/bin/gog

# Non-root runtime user (the server runs as this after the entrypoint privilege
# drop; only the boot-time volume chown runs as root).
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
COPY server.mjs /app/server.mjs
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown -R app:app /app

ENV PORT=8080
EXPOSE 8080

# Entrypoint runs as root to chown the Fly volume (GOG_HOME) to `app`, then
# execs the server as `app` via gosu. See entrypoint.sh.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/server.mjs"]
