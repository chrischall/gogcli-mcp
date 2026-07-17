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

# Create the persistent volume for gog's auth/config (match [[mounts]].source
# and primary_region in fly.toml). If a region is out of capacity
# ("insufficient CPUs"), pick a nearby one (e.g. ewr instead of iad) and set
# primary_region to match — the Machine must sit with its volume.
fly volumes create gogdata --region "$(awk -F'"' '/primary_region/{print $2}' fly.toml)" --size 1

# Two secrets:
#  RUNNER_KEY           the bearer the Worker (and you) send; also the connector
#                       login key. Save it — you enter it in claude.ai.
#  GOG_KEYRING_PASSWORD encrypts gog's stored refresh token in the file keyring
#                       on the volume (GOG_KEYRING_BACKEND=file). You never need
#                       to see it; the server reads it from its env.
fly secrets set RUNNER_KEY="$(openssl rand -hex 32)" \
                GOG_KEYRING_PASSWORD="$(openssl rand -hex 32)" --stage

# Build + deploy the image (applies the staged secrets).
fly deploy
```

`fly deploy` builds the `Dockerfile`, which downloads the pinned `gog` release
(`ARG GOG_VERSION`, currently `0.34.1`) for the target arch and bakes it into the
image. To move to a newer gog, bump `GOG_VERSION` in the `Dockerfile` and
redeploy.

## Seeding `GOG_HOME` (one-time auth)

`gog` needs your Google credentials in `GOG_HOME` (`/data`) before `/run` can do
anything useful — specifically **two** things: your OAuth *client* file
(`credentials.json`) and a stored *refresh token*.

If you already have a working `gog` locally, seed both in one shot with the
helper script (run it once, after `fly deploy`):

```bash
APP=gogcli-gog-runner EMAIL=you@gmail.com ./seed-auth.sh
```

It exports your refresh token from your local gog keyring, pushes it plus
`credentials.json` to the Machine, imports the token into the encrypted **file
keyring** on the volume, fixes ownership, verifies (`gog auth list`), and
restarts the Machine. It's secret-free — the token stays in your shell and the
keyring password comes from the Machine's injected `GOG_KEYRING_PASSWORD`.

Two details it takes care of that trip up a hand-rolled seed:

- Under a custom `GOG_HOME`, gog reads the client file from **`$GOG_HOME/data/credentials.json`**
  (i.e. `/data/data/credentials.json`), not `$GOG_HOME/credentials.json`.
- The box uses `GOG_KEYRING_BACKEND=file` (headless Linux has no OS keychain), so
  the refresh token must be **imported** (`gog auth tokens import`) — a macOS
  Keychain token isn't a copyable file. Plain `gog auth add` on the Machine also
  works but needs an interactive browser OAuth flow.

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
