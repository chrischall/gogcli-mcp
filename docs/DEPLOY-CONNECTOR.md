# Deploying the gogcli remote connector

This is the operator runbook for standing up `gogcli-mcp` as a hosted remote
connector reachable from claude.ai (web, desktop, mobile). It has **two moving
parts**:

1. a **Fly.io backend** (`fly-gog-runner`) that owns the real `gog` install +
   the Google OAuth handshake, and executes each forwarded `gog` arg-array; and
2. a **Cloudflare Worker** (this repo's `wrangler.jsonc` / `packages/gogcli-mcp/src/worker.ts`)
   that speaks the claude.ai OAuth/MCP-over-HTTP protocol and forwards every
   `gog` call to the Fly backend over authenticated HTTPS.

The connector's login is a **field login** — a personal **connector key** (the
Fly backend's `RUNNER_KEY`), **not** Google OAuth. Google OAuth lives entirely
inside the Fly backend's `gog` install; the Worker never sees a Google token.

If you just want `gogcli-mcp` on your own machine talking only to your own
Google account, you don't need any of this — see the main [README](../README.md)
for the local stdio / `.mcpb` install instead.

None of the steps below can be done by an agent: they require your own Fly.io
and Cloudflare accounts.

## Prerequisites

- A Fly.io account and the `fly` CLI (`flyctl`).
- A Cloudflare account (free tier is fine).
- Node and this repo checked out with dependencies installed (`npm install`).

## Steps

### 1. Deploy the Fly.io backend

Follow `fly-gog-runner/README.md` to deploy the `gog` runner. In short you:

- set two secrets — a strong **`RUNNER_KEY`** (the shared bearer the Worker and
  you present; also the connector's login "key" and what guards `/health` and
  `/run`) and a **`GOG_KEYRING_PASSWORD`** (encrypts gog's stored refresh token
  in the volume's file keyring) — then `fly deploy`;
- seed the backend's `gog` with your Google auth so it holds a refresh token for
  the account(s) you want to reach — run `fly-gog-runner/seed-auth.sh` once (it
  exports your local refresh token and imports it, plus your OAuth client, onto
  the volume). Interactive `gog auth add` on the Machine also works.

Note the backend's URL, e.g. `https://gogcli-gog-runner.fly.dev`. It must expose:

- `GET /health` → `200` when the `Authorization: Bearer <RUNNER_KEY>` matches
  (used by the connector's login page to verify the key);
- `POST /run` with body `{ "args": [...] }` → `{ "stdout": "…" }` (or a non-2xx
  with `{ "error": "…" }`), which runs `gog <args…>` and returns its stdout.

### 2. Log in to Cloudflare

```sh
npx wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account.

### 3. Create the OAuth KV namespace

The connector stores OAuth state and per-user session data (including each
user's encrypted connector key) in a KV namespace bound as `OAUTH_KV` (see
`wrangler.jsonc`).

```sh
npx wrangler kv namespace create gogcli-connector-oauth
```

The command prints something like:

```
{ "binding": "OAUTH_KV", "id": "abcd1234..." }
```

Paste the returned `id` into `wrangler.jsonc`, replacing the one already there:

```jsonc
"kv_namespaces": [{ "binding": "OAUTH_KV", "id": "abcd1234..." }],
```

The id in the repo belongs to this project's own deployment. It is committed
deliberately — a KV namespace id is an identifier, not a credential: reaching the
namespace requires an API token scoped to that account, and any token that could
use the id can already enumerate namespaces without it. (Every other connector in
the fleet commits its id the same way.)

You still have to replace it, because it lives in a different account and
Cloudflare will reject it:

```
✘ KV namespace 'abcd1234...' is not valid. [code: 10042]
```

If you see that error, this step is the one you missed.

### 4. Point the Worker at your Fly backend

In `wrangler.jsonc`, set `vars.FLY_ENDPOINT` to your Fly backend URL from step 1:

```jsonc
"vars": { "FLY_ENDPOINT": "https://gogcli-gog-runner.fly.dev" }
```

`FLY_ENDPOINT` is a plain (non-secret) var — the connector key is what
authenticates, and it is supplied per-user at login, never baked into the
Worker.

### 5. Deploy the Worker

```sh
npm run worker:deploy
```

This runs `wrangler deploy`, which bundles and pushes
`packages/gogcli-mcp/src/worker.ts` (plus the per-session agent Durable Objects
and the `OAUTH_KV` namespace from step 3). The Cloudflare API token you deploy
with needs **Workers Scripts: Edit**; **Workers KV Storage: Edit** is only needed
if you want `wrangler kv namespace create`/`list` to work from the same token.

#### Automatic deploys

For this project's own deployment the manual steps are a fallback: **both halves
deploy automatically** whenever release-please cuts a release, pinned to the
release tag, so what is live tracks the release instead of drifting behind `main`.
(The Worker had drifted far enough to keep serving a tool schema `main` had
already replaced.)

```
release-please ──> deploy-runner (Fly)  ──> deploy-connector (Worker)
               └─> publish (npm + MCP registry + ClawHub)
```

The Fly backend goes first. The two halves are compatible in both directions, so
this isn't a correctness requirement — but a new Worker against an old runner is
the combination that leans on the compatibility fallback, so the other order is
preferred. If the runner deploy fails the Worker deploy is skipped, leaving a
consistent pair rather than a half-updated one.

Repository secrets:

| Secret | Required | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | token with **Workers Scripts: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | only if the token can reach several accounts | disambiguates the target account |
| `FLY_API_TOKEN` | yes | app-scoped Fly deploy token |

Create the Fly token scoped to the one app rather than using a personal auth
token:

```sh
fly tokens create deploy -a gogcli-gog-runner
```

If a token is absent that job warns and passes rather than failing an
otherwise-good release — a missing secret shows up as "not deployed" in the run summary,
not as a broken release.

You can also deploy any ref on demand — Actions → **deploy-runner** or
**deploy-connector** → *Run workflow* — which is the way to ship a fix without
cutting a release, or to retry a release deploy that failed.

The runner's Google auth lives on a persistent volume, not in the image, so
redeploying does not disturb the stored refresh token. After rollout the workflow
probes `/healthz`, because a green `fly deploy` means the image rolled out, not
that the service answers.

On success it prints the deployed URL:

```
https://gogcli-connector.<your-subdomain>.workers.dev
```

Because `wrangler.jsonc` also declares a custom-domain route
(`connector.gogcli.nullnet.app`), the connector is additionally served there
once TLS provisions — which takes **a few minutes** after the first deploy. Use
the `*.workers.dev` URL in the meantime. The zone must be in the deploying
Cloudflare account; if it isn't, remove the `routes` entry and use the
`*.workers.dev` URL.

Sanity-check locally before/after deploying:

```sh
npm run worker:dev                 # run the Worker locally
npx wrangler deploy --dry-run      # confirm it bundles without deploying
npm run worker:test                # Worker-specific suite (Miniflare / real Workers runtime)
```

### 6. Add it as a connector in claude.ai

1. Go to claude.ai → **Settings** → **Connectors** → **Add custom connector**.
2. Paste the deployed URL with `/mcp` appended — the custom domain
   `https://connector.gogcli.nullnet.app/mcp` (or, before the custom domain's
   TLS is ready, `https://gogcli-connector.<your-subdomain>.workers.dev/mcp`).
3. Claude opens the connector's login page (served by the Worker at
   `/authorize`) and prompts for a **gogcli connector key**. Enter the same
   `RUNNER_KEY` you set on the Fly backend in step 1. The key is verified against
   the backend's `/health` endpoint before the session is created.

**If the login page shows an error, read which of the two it is** — they are not
the same problem and only one of them is about your key:

| What the login page says | What it means | What to do |
| --- | --- | --- |
| `Invalid connector key (backend rejected it)` | The runner received the key, compared it to its own `RUNNER_KEY`, and refused it (HTTP 401/403). | Get the right key — `fly secrets list` will tell you whether `RUNNER_KEY` is the one you think it is. |
| `…did not answer the key check…` / `…could not reach the gog backend…` | The runner never answered, so **your key was never checked**. | Wait a few seconds and press the button again. The Worker already retried once for you. |

The second row is not hypothetical: the runner answers `503 {"retryable":true}`
to every request from the moment a shutdown signal lands until it finishes
draining — i.e. for the whole of **every deploy** — and Fly's proxy answers 502
while a stopped Machine boots. Both used to be reported as "Invalid connector
key", which is why a connector can end up stuck showing only `authenticate` and
`complete_authentication`: the user was told, wrongly, that they had the wrong
key, and reasonably stopped. If you find a connector in that state, re-add it —
there is nothing to repair on the backend.

This connector is unlisted: it only shows up for people you've explicitly shared
the URL with. Anyone with the URL who supplies a valid connector key can drive
the `gog` account(s) the Fly backend is logged into — so treat `RUNNER_KEY` as a
shared secret and only hand it to people you'd trust with that account.

### 7. Verify

1. Confirm the connector appears (Settings → Connectors) and shows as connected.
2. Run a read, e.g. ask Claude to run `gog_sheets_get` or `gog_gmail_search`.

If those work, the deploy is verified end-to-end.

## How auth works

- **Field login, not Google OAuth.** Each user who adds the connector logs in
  with the **connector key** (the Fly backend's `RUNNER_KEY`) via the Worker's
  `/authorize` page. The key is verified (`GET <FLY_ENDPOINT>/health` with the
  key as a bearer token) before the session is created.
- That key is stored **encrypted at rest** in the OAuth provider's KV-backed
  props (`OAUTH_KV`), scoped to that session, and turned into a per-session Fly
  executor by `worker.ts`'s `buildClient`. It is used only to authenticate calls
  to `<FLY_ENDPOINT>/run`.
- **Google credentials never reach the Worker.** The Google OAuth refresh token
  lives inside the Fly backend's `gog` install; the Worker only ever forwards
  assembled `gog` arg-arrays and gets back stdout.

## Reading the auth log

`wrangler.jsonc` sets `observability.enabled = true`, so the Worker has a
Workers Logs sink. Every auth-state transition writes exactly one line to it,
prefixed `gog-auth` and carrying a JSON record:

```
gog-auth {"at":"2026-08-09T03:52:16.004Z","event":"runner.auth-failed","service":"gmail","endpoint":"https://gogcli-gog-runner.fly.dev","reason":"the gog-runner rejected the connector’s bearer token, …"}
```

Filter on `gog-auth` in the Workers Logs UI, or tail live with
`npx wrangler tail --format pretty | grep gog-auth`. On a stdio server the same
records go to **stderr** (never stdout — that is the JSON-RPC channel), so they
land in the MCP host's server log.

| `event` | what it means |
| --- | --- |
| `runner.auth-failed` | The runner rejected the connector's bearer token. `gog` never ran and **no Google credential was read** — fix `GOG_RUNNER_KEY` / `RUNNER_KEY`, do not re-authorize an account. |
| `grant.dead` | `invalid_grant`: the refresh token is gone. The only event that legitimately means a human must re-authorize. |
| `token.minted` | A fresh access token was obtained from the refresh token. |
| `token.cache-hit` | An unexpired cached token was served without contacting Google. **Off by default** — a cache hit is the steady state, so narrating it would write one line per tool call. Set `GOG_AUTH_LOG_CACHE_HITS=1` to turn it on while investigating which token a call was served. |
| `token.evicted` / `token.evict-noop` | A rejected access token was dropped, or was already superseded/absent. |
| `token.mint-failed` | The exchange failed for something other than a dead grant (Google 5xx, unreachable). |
| `replay.attempted` / `.succeeded` / `.failed` | The one automatic replay after Google refused an access token. A `.succeeded` is a failure the caller never saw. A `.failed` is followed by a second `token.evicted` **only when Google refused the replay's token too**; if the replay died in transport (a drain 503, a client-side timeout) nothing is evicted, because Google never saw that token and it is unproven rather than refused. |
| `replay.declined` | Google refused the token but the call was not replayable; `reason` says which rule refused. **Four of the six rules are reached after the eviction**, with the rejected token already dropped — a write (not a known read-only subcommand), a token that was already superseded, a deadline with too little left to retry, and a source that produced no token once the eviction had happened. The eviction is the repair; the replay is only the convenience on top of it. The remaining **two are refused before the eviction** and correctly so — no access token was supplied with the call, and the token source cannot mint a replacement — because in neither case is there a cached token of ours to drop. |
| `connect.google-ok` | Connect time: the Google layer was measured live (the runner ran `gog auth list --check`) and every stored account refreshed successfully. |
| `connect.google-unhealthy` | Connect time: the probe reached a verdict about the credential and the verdict is bad — Google **refused** it, or there is no account on the volume at all. Emitted only when the runner asserts `measured:true`. The user was connected anyway — see below. `reason` carries the runner's classification, e.g. `invalid_grant`. |
| `connect.google-unmeasured` | Connect time: nothing was learned about the credential — the runner is older than `GET /health/google` (HTTP 404), was draining, the probe timed out, `gog` could not be run at all, its output could not be parsed, or it declined to state validity (`measured:false`) — or it answered without stating `measured` at all, in which case nothing is read out of its `ok` either. **This is a fact about the probe, not about the credential**; it is never reported as ill health. |
| `refusal.google-ok` | **The one record that means "we cannot explain this."** Google refused a real hosted call, and a live check of the same credential taken seconds later succeeded — so neither a dead grant nor the 7-day cliff accounts for it. Emitted at `error` level because it is the only evidence that could ever justify building automatic recovery on the hosted path; its continued absence is what retires that idea. |
| `refusal.google-unhealthy` | Google refused a hosted call and the live check **reached a verdict** that agrees the credential is refused (`measured:true`). `reason` carries the runner's classification (e.g. `invalid_grant`). This is the expected shape of the weekly Testing-mode expiry, and the user must re-authorize. |
| `refusal.google-unmeasured` | Google refused a hosted call and the live check reached no verdict — the runner predates `GET /health/google` (HTTP 404), the probe was throttled (at most one per minute per session), too little of the call's deadline remained, or the runner answered `measured:false` (it timed out, `gog` could not be run, the output could not be parsed) or did not state `measured` at all. **A fact about the probe, not about the credential.** |

Read `measured` before `ok`, always. The runner reports **both**, because "is the
Google layer healthy" and "did anything find out" are independent questions and
only the pair can be read honestly: a probe that timed out or could not be run is
`ok:false`, and filing that as `-unhealthy` would tell an operator the refresh
token was dead on evidence nobody gathered. The connector reads the two through
one shared function (`src/google-probe.ts`) precisely because the two call sites
previously made this judgement separately. Anything ambiguous — including a
runner that does not state `measured` — resolves to `-unmeasured`, which
under-claims and loses nothing, since the runner's own cause string rides on the
same log line.

Credentials cannot appear in these lines. A credential is named only by
`credential`, a 12-hex-character slice of the SHA-256 that already keys the
token cache, and the whole serialized record is passed through the same
`redactSecrets` that guards every error returned to a client.

One deployment shape silences the `-ok` readings entirely: a Fly volume holding a **service account
alongside** an OAuth account. gogcli cannot check a service account (it has no refresh token), so it
stamps that entry `valid:true, error:"service account (not checked)"`, and the runner's `ok` is an
AND across accounts — the volume answers `ok:false, measured:false` forever. Every reading there is
`-unmeasured`, so `connect.google-ok` and `refusal.google-ok` are unreachable, and the absence of
the unexplained-refusal record on such a box means nothing at all. See the mixed-volume paragraph in
`fly-gog-runner/README.md`. The single-identity volumes this connector actually runs on are
unaffected.

Note which events a **hosted** connector can actually produce. `worker.ts` builds
its executor without a per-caller token source, so `gog` runs as the Fly volume's
own identity: the `token.*` events belong to the stdio/`useRemoteGogRunner` path,
and the hosted Worker emits `runner.auth-failed` plus, on a Google 401, a
`refusal.google-*` reading followed by `replay.declined` with `no access token
was supplied`. It also emits exactly one `connect.google-*` line per successful
login, from `connector-auth.ts`.

### Why a hosted Google 401 is measured rather than retried

The instinct on reading "the hosted path has no automatic recovery" is to build
one. It should not be built. `gog` is spawned fresh for every `POST /run` and
re-reads the keyring each time, so there is no cross-spawn in-memory token that
could go stale — a Google 401 here means the **stored** credential was refused,
and no retry can repair that. (The stdio/`useRemoteGogRunner` path is different:
there a token source holds a cached access token, which is exactly what the
`token.evicted` / `replay.*` machinery exists for.)

What was missing was never a retry. It was an answer to the question nobody
could answer after the incident: *at the moment Google refused that call, was the
refresh token on the volume alive or dead?* `replay.declined` records only that
**we** did nothing. So the hosted path now takes one live reading — the same
`GET /health/google` probe the connect path uses — and writes down what it heard,
immediately before the decision record. Read as a pair, the two lines say "here
is what Google said, and here is why we did nothing about it".

The reading is deliberately cheap and deliberately powerless:

- It runs **only** when Google refused a call that carried no token of ours, i.e.
  the hosted shape. A runner transport 401 and an ordinary `gog` failure are
  never probed — asking Google about a failure Google never saw would re-create,
  one layer down in the log, the misattribution 2.21.1 removed from the user's
  screen.
- It is **skipped when `gog` already said `invalid_grant`** (that path logs
  `grant.dead`). Spending a Google API call to be told what gog just said would
  cost the most on the single most common failure and learn nothing.
- It is **throttled to one per minute per session** and bounded by whatever is
  left of the tool call's own deadline. `/health/google` spawns a real `gog auth
  list --check`, which costs a Google API call and takes the keyring's exclusive
  `flock` — `auth list` → `store.ListTokens()` → `withWriteLock` →
  `unix.LOCK_EX`, in gogcli v0.34.1, the tag the Dockerfile pins; a model
  retrying a refused call must not turn one diagnostic into a queue of them on
  the box that is already failing.
- It **never changes what the caller sees**, never throws, and never decides
  anything. The error the tool returns is byte-identical with the probe present
  or absent.

### Why a `connect.google-unhealthy` login still succeeds

Because the tools that repair a dead Google credential — `gog_auth_add_url` and
`gog_auth_add_complete` — are MCP tools, and MCP tools are reachable only once
the connector is connected. Refusing the login on a dead Google grant would lock
the user out of the only path that fixes it. The probe exists so that status
never claims health nobody measured, **not** so that a bad measurement can refuse
a connection.

Two limits worth knowing before you read these lines as a live status:

- They are written on the **connect** path only. claude.ai's later "refreshed" is
  an OAuth exchange inside `OAUTH_KV` and reaches neither Fly nor Google —
  `ConnectorAuth` exposes only a `login` hook, so there is nowhere to run a probe
  from. A `connect.google-ok` from last Tuesday says nothing about today.
- They describe the credential on the **Fly volume**, which every connector for
  that machine shares. A `connect.google-unhealthy` on `gog_docs` is not a
  docs-specific fault.

## Rotation / teardown

- **Rotate the connector key:** set a new `RUNNER_KEY` on the Fly backend
  (`fly secrets set RUNNER_KEY=…`); every user re-adds the connector with the new
  key. (Old sessions stop working the moment the backend stops honouring the old
  key.)
- **Tear down the Worker:**

  ```sh
  npx wrangler kv namespace delete --namespace-id <id-from-step-3>
  npx wrangler delete
  ```

  Deleting the KV namespace invalidates every stored session — everyone will
  need to log in again if it's redeployed.
- **Tear down the backend:** `fly apps destroy <app>` (see `fly-gog-runner/README.md`).
