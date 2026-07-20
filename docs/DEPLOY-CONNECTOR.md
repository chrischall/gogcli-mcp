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

**Do not paste that id into `wrangler.jsonc`.** The committed file keeps the
`"REPLACE_WITH_OAUTH_KV_NAMESPACE_ID"` placeholder on purpose — the id is
account-identifying and should not live in source. `npm run worker:deploy`
(step 5) substitutes it at deploy time into a gitignored generated config, so
there is nothing to edit and nothing to revert afterwards.

It resolves the id from the first source that answers:

| Order | Source | Needs |
|-------|--------|-------|
| 1 | `$OAUTH_KV_ID` | nothing — explicit override, no API calls |
| 2 | `wrangler kv namespace list` | token with **Workers KV Storage: Edit** |
| 3 | the deployed Worker's live bindings | token with **Workers Scripts** only; requires an already-deployed Worker |

For a brand-new environment source 3 cannot work (nothing is deployed yet), so
either grant the token **Workers KV Storage: Edit** or pass the id explicitly:

```sh
OAUTH_KV_ID=abcd1234... npm run worker:deploy
```

> Wrangler does **not** interpolate environment variables inside its config
> (a `"${OAUTH_KV_ID}"` id is uploaded literally), which is why the substitution
> happens in `scripts/deploy-worker.mjs` rather than in `wrangler.jsonc`.

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

This runs `scripts/deploy-worker.mjs`, which resolves the `OAUTH_KV` namespace id
(step 3), writes the gitignored `wrangler.generated.jsonc`, and hands that to
`wrangler deploy` — bundling and pushing `packages/gogcli-mcp/src/worker.ts` plus
the per-session agent Durable Objects. The committed `wrangler.jsonc` is never
modified.

The Cloudflare API token needs **Workers Scripts: Edit**, and
**Workers KV Storage: Edit** unless you supply the id via `$OAUTH_KV_ID`.

Extra arguments are forwarded to `wrangler deploy`:

```sh
npm run worker:deploy -- --dry-run   # bundle and show bindings, deploy nothing
```

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
npm run worker:deploy -- --dry-run # confirm it bundles without deploying
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
