# fly-gog-runner

A tiny, standalone HTTP service that runs the [`gog`](https://github.com/openclaw/gogcli)
CLI on a single [Fly.io](https://fly.io) Machine. It is the **only** place
the `gog` binary actually runs in the connector architecture: a Cloudflare Worker
connector assembles a fully-formed `gog` arg-array and forwards it here over
authenticated HTTPS; this box executes it and returns the raw stdout.

- **Single-user.** It runs the operator's own Google account. `gog`'s auth lives
  on a persistent Fly volume mounted at `GOG_HOME` (`/data`). Fly mounts volumes
  root-owned, so the container's entrypoint chowns `/data` to the non-root `app`
  user at boot (gog must write refreshed tokens there) before dropping privileges
  via `gosu` — the server process itself never runs as root.
- **One Machine, kept warm.** `fly.toml` sets `min_machines_running = 1`. The
  Fly proxy was otherwise autostopping the Machine after ~3 minutes without a
  request — ordinary think-time between two tool calls in one conversation turn,
  and it hits every `gog_*` connector at once because they all share this box.
  The purchase is latency, not correctness: a cold start measured ~4.1 s against
  the connector's 35 s deadline, so the runner was never actually failing on it.
  The price is a shared-cpu-1x/512 MB Machine billed 24/7 — on the order of
  **$3/month** at Fly's current published rate, versus near-zero usage-based
  before (the volume is billed either way). Setting it back to `0` is a
  perfectly defensible way to save that; the runner stays correct across cold
  starts regardless, since Fly still stops Machines for deploys, host
  migrations, and OOMs.
- **Zero npm dependencies.** `server.mjs` is pure Node built-ins.
- **Not an npm workspace.** This directory sits outside the monorepo's
  `packages/*` glob and is deployed on its own; it does not affect repo CI,
  build, or coverage.

## What it exposes

| Method & path   | Auth            | Purpose                                                                 |
|-----------------|-----------------|-------------------------------------------------------------------------|
| `GET /healthz`  | none            | Liveness for Fly/uptime checks. Runs no gog. → `200 {"ok":true}`        |
| `GET /health`   | bearer required | Key verification for the connector's `login()` — proves the key is good without depending on gog being seeded. → `200 {"ok":true}` / `401` |
| `GET /health/google` | bearer required | **Layer-2 probe.** Runs `gog auth list --check --json` — a REAL token refresh against Google — and reports whether the credential on `/data` still works. → always `200 {"ok":bool,"measured":bool,"accounts":[…],"error"?}` once authorized; `401` otherwise |
| `POST /run`     | bearer required | Runs `gog <args>` verbatim. → `200 {"stdout"}` on exit 0; `422 {"error","stderr","retryable":false}` on gog failure; `400 {"error"}` on bad input; `500 {"error","retryable":true}` if this box can't write a file arg to disk; `503 {"error","retryable":true}` while draining for shutdown |

Auth is a bearer token compared in constant time against `RUNNER_KEY`. Missing or
mismatched → `401`. The server **refuses to start** if `RUNNER_KEY` is unset.

Note that a gog failure is **`422`, not `5xx`**. `gog` ran here and exited
non-zero, so the same args will fail identically and the caller must not retry.
5xx is reserved for infrastructure — which is also what Fly's edge proxy returns
when it can't reach the Machine at all — so the status alone carries the
retryable/not-retryable classification.

### Two health endpoints, because there are two credentials

`/health` and `/health/google` measure **different layers** and must not be conflated:

- **Layer 1** is the connector key (`RUNNER_KEY`): claude.ai → Worker → this box. `/health`
  answers it, and deliberately **runs no gog**.
- **Layer 2** is the Google refresh token in gog's file keyring on `/data`. Only
  `/health/google` answers it, by making gog actually talk to Google.

`/health` passing therefore says *nothing* about whether the next Gmail call will work — that gap
is why a connector could report "connected" twice and then take a Google 401 on the next call.

**`/health` must never start depending on gog.** The re-auth tools (`gog_auth_add_url` /
`gog_auth_add_complete`) are MCP tools, reachable only *after* the connector has connected. If a
dead Google credential could fail layer-1 login, the user would be locked out of the very tools
that repair it. `THE LOCKOUT GUARD` in `server.test.mjs` pins this: with an `execFn` that throws on
any call, `/health` and `/healthz` still return `200 {"ok":true}` and gog is never spawned.

`/health/google` returns **`200` even when Google says no**, for the same reason `/run` returns 422
rather than 502: the status code carries "could I reach the runner", and the `ok` field carries
"is the credential alive". `ok` is true only when at least one account is stored **and** every one
of them just refreshed successfully.

**`measured` is the other half of the answer, and callers must read it first.** `ok` says whether the
Google layer is healthy; `measured` says whether anything found out. They are independent: a probe
that timed out, could not be run at all (no `gog` on `PATH`, no `credentials.json` on the volume), or
produced output we cannot parse is `ok:false, measured:false` — and reading that as "Google refused
the credential" would claim a verdict nobody obtained, which is the very defect this endpoint exists
to remove, with the alarm inverted. `measured:true` covers exactly the outcomes that ARE facts about
the credential: `invalid_grant`, a failed live check, and "no account is authorized" (gog answered
successfully that there is nothing to refuse). `ok:true` always travels with `measured:true` —
health is a claim only a measurement can license. The partition is `MEASURED_CAUSES` /
`UNMEASURED_CAUSES` in `server.mjs`, and a cause in neither resolves to `measured:false`, the
direction that can only under-claim.

An account gogcli says it **did not check** — `annotateAuthListCheck` stamps service accounts
`valid:true, error:"service account (not checked)"` — is never counted as healthy either. `ok` is an
AND across accounts, so one unchecked entry makes the whole answer `ok:false, measured:false`.

**Know what that costs on a MIXED volume.** A volume holding one healthy OAuth account *and* one
service account is `ok:false, measured:false` **permanently** — the service-account entry has no
refresh token for gogcli to check, so it always carries the marker, and the AND always collapses on
it. The direction is the safe one (nothing is ever reported healthier than it was measured), but the
answer stops varying: on such a deployment the endpoint can no longer distinguish a live credential
from a dead one, and the connector's `connect.google-ok` / `refusal.google-ok` — including the
unexplained-refusal record that is the whole point of the post-refusal probe — can never be emitted.
Diagnose those boxes with `/run` and gog's verbatim output instead. A future revision could report a
per-account verdict so the OAuth accounts still answer; today the whole-volume AND is deliberate and
this is its price.

Its `error` is drawn from a **closed vocabulary** (`PROBE_CAUSES` in `server.mjs`) — `invalid_grant`,
timed out, could not run, unrecognized output, no accounts, failed check, unknown validity, not
checked. gog's stdout/stderr is read only to *classify* and is never relayed, because this response
is destined for status text and log aggregators. `accounts` entries carry only `email`,
`created_at`, `valid`, and a reduced `error` marker; `scopes` and `subject` are dropped. Use `/run`
when you want gog's verbatim words.

The probe runs under its own `GOOGLE_PROBE_TIMEOUT_MS` (10 s), well under `/run`'s 30 s, so an
unreachable Google cannot hold a health check open.

### `/run` input validation

`args` must be a non-empty array of ≤ 64 elements. Each element is **either** a
plain string **or** a file arg. Execution uses `execFile` (no shell), so shell
metacharacters are inert. There is **no subcommand allowlist** — it is the
operator's own `gog`.

**Plain strings** go through `argv` and are capped at **64 KiB each**, measured
in bytes, and must contain no NUL byte. The cap exists because Linux caps a
*single* argv string at `MAX_ARG_STRLEN` (128 KiB, independent of `ARG_MAX`) and
exceeding it yields an opaque `E2BIG`; 64 KiB sits safely under that while still
carrying the legitimately-large args gog offers no file variant for (`sheets
update --values-json` and friends).

**File args** are how a payload leaves `argv` entirely — the only way to send
something larger than 64 KiB, and the reason a >4 KB Gmail draft body works:

```jsonc
{ "kind": "file", "flag": "body-html-file", "contents": "<p>…</p>", "ext": "html" }
```

| Field      | Required | Meaning                                                            |
|------------|----------|--------------------------------------------------------------------|
| `kind`     | yes      | Literal `"file"` — the discriminant.                                |
| `flag`     | yes      | Flag **name without leading dashes**, e.g. `body-html-file`. Must match `^[A-Za-z0-9][A-Za-z0-9-]*$`. |
| `contents` | yes      | The payload, verbatim. Capped at **8 MB**, measured in bytes.        |
| `ext`      | no       | Temp-file extension without the dot (`^[A-Za-z0-9]{1,16}$`). Default `txt`. |

The server writes `contents` to `<mkdtemp dir>/body.<ext>` (dir `0700`, file
`0600`), substitutes the element with the plain string `--<flag>=<path>`, runs
gog, and removes every temp dir in a `finally` — on success, on a non-zero exit,
on a timeout, on a throw. A leaked temp file holds user content, so that cleanup
is a security property, not tidiness.

The server does **not** know which gog flags have file variants; it passes
`flag` through verbatim. Choosing `--body-html-file` over `--body-html`, and
respecting gog's per-command quirks (some commands hard-error when both are
passed, some silently prefer the file; some strip trailing newlines from a file
payload, some preserve them), is the **caller's** job.

The whole POST body is capped at **32 MB** — 4x the per-file cap, so JSON
escaping of a max-size payload still leaves the precise per-flag error as the
one the caller sees. This ceiling sizes the Machine's `memory` in `fly.toml`;
the two must move together.

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
(`ARG GOG_VERSION`) for the target arch and bakes it into the image. The version
is deliberately NOT restated here — it is one of four places that move together
(the `ARG`, `MIN_GOG_VERSION` in `packages/gogcli-mcp/src/runner.ts`, and the
`tag:` in every `packages/*/mint.yaml`), and `scripts/check-runner-gog-version.mjs`
guards the other three but cannot guard prose. Read the current floor from the
"Required gog version" section of the root `CLAUDE.md`, or from the `ARG` itself.

To move to a newer gog, bump `GOG_VERSION` in the `Dockerfile` and redeploy. A
release does this for you: `release-please.yml`'s `deploy-runner` job redeploys
this app at the release tag whenever a release is cut, so a `GOG_VERSION` bump
that lands on `main` goes live with the next release rather than needing a manual
`fly deploy`.

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

# Google-credential check (bearer) — this one DOES run gog and talks to Google:
curl -fsS -H "Authorization: Bearer $RUNNER_KEY" https://<app>.fly.dev/health/google

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
npm test                       # unit tests (node:test, no gog needed)
```
