# fly-gog-runner

A tiny, standalone HTTP service that runs the [`gog`](https://github.com/openclaw/gogcli)
CLI on a [Fly.io](https://fly.io) scale-to-zero Machine. It is the **only** place
the `gog` binary actually runs in the connector architecture: a Cloudflare Worker
connector assembles a fully-formed `gog` arg-array and forwards it here over
authenticated HTTPS; this box executes it and returns the raw stdout.

- **Single-user.** It runs the operator's own Google account. `gog`'s auth lives
  on a persistent Fly volume mounted at `GOG_HOME` (`/data`). Fly mounts volumes
  root-owned, so the container's entrypoint chowns `/data` to the non-root `app`
  user at boot (gog must write refreshed tokens there) before dropping privileges
  via `gosu` — the server process itself never runs as root.
- **Zero npm dependencies.** `server.mjs` is pure Node built-ins.
- **Not an npm workspace.** This directory sits outside the monorepo's
  `packages/*` glob and is deployed on its own; it does not affect repo CI,
  build, or coverage.

## What it exposes

| Method & path   | Auth            | Purpose                                                                 |
|-----------------|-----------------|-------------------------------------------------------------------------|
| `GET /healthz`  | none            | Liveness for Fly/uptime checks. Runs no gog. → `200 {"ok":true}`        |
| `GET /health`   | bearer required | Key verification for the connector's `login()` — proves the key is good without depending on gog being seeded. → `200 {"ok":true}` / `401` |
| `POST /run`     | bearer required | Runs `gog <args>` verbatim. → `200 {"stdout"}` on exit 0; `502 {"error","stderr"}` on gog failure; `400 {"error"}` on bad input |

Auth is a bearer token compared in constant time against `RUNNER_KEY`. Missing or
mismatched → `401`. The server **refuses to start** if `RUNNER_KEY` is unset.

`/run` input validation: `args` must be a non-empty array of strings, ≤ 64
elements, each ≤ 4096 chars, with no NUL byte. Execution uses `execFile` (no
shell), so shell metacharacters are inert. There is **no subcommand allowlist**
— it is the operator's own `gog`.

### Safety flags are injected upstream

This box runs args **verbatim**. The Worker's `run()` is responsible for
injecting `--readonly`, `--json`, `--no-input`, `--color=never`, and any other
safety flags before forwarding. Do not assume this service adds them.

The service does **not** redact secrets — it returns raw stdout to the trusted
Worker over HTTPS, and redaction happens at that Worker boundary. As
defense-in-depth, the child `gog` process runs with ambient `*_TOKEN` /
`*_SECRET` / `*_API_KEY` / `*_PRIVATE_KEY` env vars (and `GOG_ACCESS_TOKEN`,
`GOOGLE_APPLICATION_CREDENTIALS`) stripped; `GOG_HOME` and `PATH` are preserved.

## Deploy

Requires the [`flyctl`](https://fly.io/docs/flyctl/) CLI and a Fly account.

```bash
# From this directory. First time — creates the app from fly.toml.
# (fly launch will prompt to reuse the existing fly.toml; keep it.)
fly launch --no-deploy

# Create the persistent volume for gog's auth/config (match [[mounts]].source).
# Use the same region as primary_region in fly.toml.
fly volumes create gogdata --region iad --size 1

# Set the shared secret the Worker connector will send as `Authorization: Bearer`.
# Generate a strong random value and store it in the Worker's config too.
fly secrets set RUNNER_KEY="$(openssl rand -hex 32)"

# Build + deploy the image.
fly deploy
```

`fly deploy` builds the `Dockerfile`, which downloads the pinned `gog` release
(`ARG GOG_VERSION`, currently `0.34.1`) for the target arch and bakes it into the
image. To move to a newer gog, bump `GOG_VERSION` in the `Dockerfile` and
redeploy.

## Seeding `GOG_HOME` (one-time auth)

`gog` needs the operator's Google credentials in `GOG_HOME` (`/data`) before
`/run` can do anything useful. Two options:

1. **Run `gog auth add` on the Machine.** SSH in and complete the OAuth flow so
   the tokens land on the volume:

   ```bash
   fly ssh console
   # inside the Machine (runs as root):
   GOG_HOME=/data gog auth add        # follow the device/OAuth prompts
   GOG_HOME=/data gog auth status     # confirm the account is authorized
   ```

   `fly ssh console` runs as root, so the seeded token files land root-owned.
   Restart the Machine afterwards (`fly machine restart <id>`) so the entrypoint
   re-chowns `/data` to `app` before the server serves requests.

2. **Copy your local gog config onto the volume.** If you already have a working
   `gog` locally, copy its config dir into the volume (e.g. via
   `fly ssh sftp shell` / `fly ssh console` + a tarball) so `/data` contains the
   same auth/token files your local `GOG_HOME` holds.

After seeding, verify end-to-end:

```bash
# Liveness (no auth, no gog):
curl -fsS https://<app>.fly.dev/healthz

# Key check (bearer):
curl -fsS -H "Authorization: Bearer $RUNNER_KEY" https://<app>.fly.dev/health

# A real gog call:
curl -fsS -X POST https://<app>.fly.dev/run \
  -H "Authorization: Bearer $RUNNER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"args":["--version"]}'
```

## How the Worker connector calls it

- **`GET /health`** with `Authorization: Bearer <RUNNER_KEY>` during the
  connector's `login()` to verify the key is correct — independent of whether gog
  is seeded yet.
- **`POST /run`** with the same bearer and a JSON body `{"args": [...]}` for
  every gog invocation. The connector's `run()` assembles the full arg-array
  (including `--readonly` and other safety flags) before sending; this box does
  not add them.

## Possible future hardening

- **Denylist auth-mutating subcommands.** Since this box holds the operator's
  live Google auth, a future revision could reject `args` that begin with
  `auth ...` (e.g. `auth add`, `auth remove`, `auth logout`) at `/run` so the
  connector can never rotate or drop credentials remotely. Not implemented today
  — the operator seeds and manages auth directly on the Machine.

## Local development

```bash
node --check server.mjs        # syntax
node --test .                  # unit tests (node:test, no gog needed)
```
