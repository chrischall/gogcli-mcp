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

For this project's own deployment the manual step above is a fallback: the
`deploy-connector` workflow deploys the Worker automatically whenever
release-please cuts a release, pinned to the release tag, so the live connector
tracks the release instead of drifting behind `main`. (It had drifted far enough
to keep serving a tool schema that `main` had already replaced.)

It needs one repository secret:

| Secret | Required | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | token with **Workers Scripts: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | only if the token can reach several accounts | disambiguates the target account |

If `CLOUDFLARE_API_TOKEN` is absent the job warns and passes rather than failing
an otherwise-good release — so a missing secret shows up as "connector not
deployed" in the run summary, not as a broken release.

You can also deploy any ref on demand — Actions → **deploy-connector** → *Run
workflow* — which is the way to ship a connector-only fix without cutting a
release, or to retry a release deploy that failed.

> Only the Worker is automated. The Fly backend (`fly-gog-runner`) is a separate
> deployable: a change under `fly-gog-runner/` still needs a manual `fly deploy`.

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
   the backend's `/health` endpoint before the session is created — an invalid
   key is rejected on the login page.

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
