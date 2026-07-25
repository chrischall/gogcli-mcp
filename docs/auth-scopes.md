# OAuth scopes: `invalid_scope`, least-privilege, and the `services` default

## Symptom

Re-authorizing with the headless flow and `services="all"` failed:

```
Error 400: invalid_scope
Some requested scopes were invalid. {valid=[…/userinfo.email, …/adwords], invalid=[…]}
```

Requesting a narrower set (`gmail,drive,sheets,docs`) succeeded.

## Why one bad scope breaks the whole flow

Google rejects the **entire** authorization request if **any** requested scope is invalid
(unregistered on the OAuth consent screen, or for an API not enabled in the client's GCP project).
So a single bad scope in a big bundle poisons the whole re-auth.

**The wrapper cannot catch this and retry.** `gog_auth_add_url` (step 1) builds the consent URL
**locally** — no network call. Google only rejects when the *user's browser* opens the URL, and
since consent then fails there's no `code`, so `gog_auth_add_complete` (step 2) never runs either.
Neither wrapper step ever receives Google's `valid`/`invalid` lists. The only resilient fix
available to the wrapper is **preflight: don't request a scope that will be rejected** — i.e.
least-privilege.

## The fix: least-privilege `services` defaults

`gog`'s `services="all"` (identical to `user`/`all-user` in gog 0.34.1) expands to **47 scopes**,
including scopes for ~9 services this wrapper has **no tools for**. Those are exactly the ones that
trip `invalid_scope` when their API isn't enabled.

Each package/connector now defaults `services` to only what it wraps
(`registerAuthTools` → `authToolsFor('<service>')` in `src/tools/auth.ts`):

| Package / connector agent | default `services` |
|---|---|
| gmail | `gmail` |
| drive | `drive,driveactivity,drivelabels` |
| sheets | `sheets` |
| docs | `docs` |
| slides | `slides` |
| calendar | `calendar` (Meet tools need `meet` — request it explicitly) |
| contacts | `contacts` |
| classroom | `classroom` |
| **base (all-services)** | **`all`** (unchanged) |

`services` is always overridable per call — widen when a niche tool needs more
(`gog_auth_add_url(email, services="drive,meet")`). The base all-services package still requests
`all`; if you use it, the APIs below must be enabled or its re-auth will `invalid_scope`.

A Gmail-package re-auth now requests **6 scopes** (`email, gmail.modify, gmail.settings.basic,
gmail.settings.sharing, userinfo.email, openid`) instead of 47 — least-privilege, and immune to an
unregistered scope for a service it doesn't touch.

## Scopes dropped from a per-service request (enable the API to use them via `all`)

These are in `all` but have no tools here; they're the likely `invalid_scope` offenders. To use
`services="all"` you must **enable each API** in the GCP project *and* register its scope on the
OAuth consent screen:

| Scope(s) | Enable this API |
|---|---|
| `adwords` | Google Ads API |
| `analytics.readonly` | Google Analytics API |
| `chat.memberships`, `chat.messages`, `chat.messages.reactions.create`, `chat.messages.reactions.readonly`, `chat.spaces`, `chat.users.readstate.readonly` | Google Chat API |
| `forms.body`, `forms.responses.readonly` | Google Forms API |
| `meetings.space.created`, `meetings.space.readonly`, `meetings.space.settings` | Google Meet API |
| `photoslibrary.readonly.appcreateddata` | Photos Library API |
| `script.deployments`, `script.processes`, `script.projects` | Apps Script API |
| `webmasters` | Search Console API |
| `youtube.readonly` | YouTube Data API v3 |

> The authoritative `invalid=[...]` list for a specific project can only be read from Google's
> browser error page (or by inspecting enabled APIs in the console) — the connector never receives
> it. The table lists the un-toolable scopes that are dropped by least-privilege regardless; the
> actual offender(s) for this project are a subset.

## Note on `include_granted_scopes`

The flow sets `include_granted_scopes=true`, so a narrow re-auth is incremental: it adds the
requested scopes to any the account previously granted rather than replacing them. Narrowing the
default therefore doesn't strip access the user already consented to — it only controls what the
*new* consent screen asks for.
