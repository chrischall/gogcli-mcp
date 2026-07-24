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
