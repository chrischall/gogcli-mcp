# Recurring `invalid_grant` — root cause & the seamless re-auth path

## Symptom

Every authenticated call (Gmail, Drive, Sheets, Docs, …) fails at the token step with:

```
oauth2: "invalid_grant" "Token has been expired or revoked."
```

It is **account-wide**, not tool-specific, and it recurs on a roughly **weekly** cadence.

## Root cause (confirmed 2026-07-24)

`invalid_grant` on a refresh means the stored **refresh token itself** is rejected — the whole
account is signed out, not just a stale access token that would refresh silently.

The cause here is the **7-day refresh-token limit Google applies to OAuth apps whose consent
screen is still in "Testing" publishing status.** Evidence:

| Signal | Value |
|---|---|
| `gog auth list` → `created_at` | `2026-07-17T15:08:39Z` |
| Failure observed | `2026-07-24` — **exactly 7 days later** |
| `gog auth list --check` → `valid` | `false`, error `invalid_grant` |
| `gog auth doctor --check` hint | *"refresh token was revoked, expired, or blocked by OAuth app policy … verify the OAuth consent app is published for long-lived use"* |
| OAuth client | `107821271097-…apps.googleusercontent.com` — a **user-owned** client (`107821271097` is the Google Cloud project number). gog has **no** built-in shared client. |

Because the OAuth client belongs to a Google Cloud project **you own**, the consent-screen
publishing status — and therefore the fix — is fully in your control.

### Other causes, ruled out

- **Rotation not persisted** — ruled out. gog *does* persist a rotated refresh token on refresh
  (`internal/googleapi/client_auth.go:151-244`), rewriting the keyring record atomically.
- **>50 tokens / user-revoked / keyring corruption / clock skew / wrong client** — ruled out:
  one token stored, keyring healthy (`gog auth doctor`), calls worked for a full 7 days.

### Concurrent keyring writes — ruled out (checked again 2026-08-09)

A recurring theory holds that the Fly runner's parallelism corrupts the keyring: all four
connectors (sheets/gmail/drive/docs) are Durable Objects pointing at **one** Machine and **one**
`/data` volume, `fly-gog-runner/server.mjs` has no queue or mutex (`server.inFlight` is only a
drain counter), so two `gog` processes could read-modify-write the same encrypted keyring at once.

The premise is false, and the reason it keeps coming back is that people read the wrong file.
`internal/secrets/file_keyring_safe.go` is about filesystem-safe key *names* (base64) and contains
no locking — but **`internal/secrets/keyring_lock.go` + `keyring_lock_unix.go` do the locking**, via
a real `flock(2)` (`unix.LOCK_EX`/`LOCK_SH`) on a `.lock` file in the keyring directory, with a
5 s default timeout (`GOG_KEYRING_LOCK_TIMEOUT`).

Evidence:

- **It is cross-process, not just cross-goroutine.** `lockKeyringFile` calls `unix.Flock`, which is
  the kernel's own inter-process lock; the in-process `sync.RWMutex` beside it only keeps one
  runtime's goroutines from fighting over the same fd.
- **Every token entry point takes it.** `KeyringStore.withReadLock`/`withWriteLock` wrap all of
  `token.go`'s paths (`SetToken`, `GetToken`, delete, rotate) plus `secret.go` and
  `default_account.go`.
- **It predates the deployment by a wide margin.** It landed in `f3d5753` *"fix(auth): serialize
  file keyring access"* (2026-05-22), first released in **v0.19.0**; `fly-gog-runner/Dockerfile`
  pins `GOG_VERSION=0.34.1`, which contains it.
- **gogcli's own suite proves both properties, and it passes today.**
  `go test ./internal/secrets/ -run 'Lock|Concurren' -count=1 -v` →
  `TestKeyringLockBlocksConcurrentProcess` (spawns a **second OS process** that holds the flock and
  asserts this one is refused) and `TestKeyringStoreFileBackendConcurrentSetToken` (12 concurrent
  `SetToken` writers, zero errors, keyring readable afterwards) both `--- PASS`.
- **The symptom does not match.** A torn keyring surfaces as a decode failure
  (`jwt.DecodeBytes() expects token of 3 or 5 parts`), not `Google API error (401 authError)`.
  Nor could a lost write explain a failure that arrives *exactly* 7 days after issue.

**Therefore: do not add a mutex, queue, or semaphore to `server.mjs`.** It buys no correctness that
`flock` does not already provide, and it costs real behaviour — one Machine serves all four
services, so a runner-level mutex would park a 30 s Gmail attachment download in front of an
unrelated sheets read and manufacture timeouts at the connector's 35 s deadline.

## The durable fix (do this once)

In the **[Google Cloud Console → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)**
for project `107821271097`, click **Publish App** to move it from *Testing* to *In production*.
Refresh tokens then last ~6 months of inactivity instead of 7 days.

An unverified production app is fine for personal use — the only difference at re-auth is a
one-time "Advanced → continue to (unsafe)" click. Until you publish, every re-auth only resets
the weekly clock.

## What the wrapper does now (the safety net)

Even with the durable fix pending, the recovery experience is no longer a dead end:

### 1. Structured `invalid_grant` errors, on every service

`diagnose()` (`src/tools/utils.ts`) now maps `invalid_grant` to its own plain-English message —
distinct from a generic 401 — naming the 7-day/Testing cause, pointing at the durable fix, and
offering both re-auth paths. Every service routes failures through `runOrDiagnose`, so Gmail,
Drive, Sheets and Docs all surface the same guidance instead of a raw shell error.

### 2. `gog_auth_health` — proactive token health

Runs `gog auth list --check` (a **live** refresh against Google, which `gog_auth_status` does
not do) and reports, per account:

- whether the token is currently valid,
- the mapped cause when it is not,
- how long ago it was authorized,
- a **⚠ warning as it approaches the 7-day cliff** (with an estimated expiry date), so you can
  re-authorize on your own schedule instead of mid-task.

### 3. Headless re-auth — `gog_auth_add_url` → `gog_auth_add_complete`

The interactive `gog_auth_add` needs a browser on the same host as gog (its loopback callback),
which the **hosted connector cannot provide**. The two-step remote flow works everywhere,
including the Fly-backed connector, because both steps are non-interactive gog calls:

1. **`gog_auth_add_url`** → returns a Google sign-in URL (valid 10 min). Hand it to the user.
2. The user signs in; the browser is redirected to a `localhost` URL that **fails to load — that
   is expected**. They copy that full URL from the address bar.
3. **`gog_auth_add_complete`** with the pasted URL → exchanges the code and stores the token.

Pass the **same `services`** value to both steps (default `all`), and run step 2 within 10
minutes of step 1 (gog matches them via a 10-minute, `0600`-mode state file in its config dir).

> Note: the step-1 tool uses `redactMode: 'tokens'` so the wrapper's secret-redaction does not
> mangle the consent URL's scope names (the shared redactor mistakes
> `classroom.coursework.students` for a secret). A step-1 URL carries no token; real token shapes
> (`ya29.…`/`1//…`) are still stripped everywhere.

## What is intentionally **not** built here

- **Proactive background access-token refresh** — irrelevant to this failure (the *refresh* token
  dies, not the access token) and not a gog primitive the wrapper can drive; gog refreshes access
  tokens on-demand at call time already.
- **Rotation persistence** — already handled correctly inside gog (see above).
- **Device-code flow** — gog has none; the remote paste-back flow above is the headless path.
