# TODO

Remaining Google services exposed by `gog` that don't yet have dedicated MCP coverage. Each entry sketches scope, fit, and prerequisites for adding it.

## High-value next candidates

### Chat → new sub-package `gogcli-mcp-chat`

Google Chat is the closest analog to gmail in shape (messages/threads/spaces) and is the highest-leverage missing service. Agents that already know how to summarize emails and reply could do the same in Chat with minimal additional skill development.

- **`gog chat`** subcommands to verify with `gog chat --help`:
  - `spaces` (list, get, create) — DMs, group chats, named spaces
  - `messages` (list, get, send, update, delete) — text and card messages
  - `members` (list, add, remove) — space membership
  - `attachments` — read/download files attached to messages
  - `search` — across accessible spaces
- **Tool count estimate:** ~18–22 dedicated + `gog_chat_run` escape hatch.
- **Notable**: card/rich messaging support may need a JSON-string param like `--card-json`.
- **Pattern**: mirror `gogcli-mcp-gmail` — focused sub-package with dedicated tools per common operation.

### Forms → new sub-package `gogcli-mcp-forms`

Reading form responses and structurally working with surveys is a strong agent use case (intake processing, summarization).

- **`gog forms`** subcommands to verify:
  - `list` — forms owned by the account
  - `get` — form metadata + question schema
  - `responses` (list, get) — submissions
  - `create`, `update` (questions, items) — form authoring
- **Tool count estimate:** ~10–14 dedicated + `gog_forms_run`.
- **Notable**: question types are an enum; expose `questionType` as `z.enum([...])` where practical.
- **Prerequisite**: confirm the Forms API scope is already configured in gogcli.

### Keep → likely a small new sub-package `gogcli-mcp-keep`

Lightweight note capture and search. Smaller surface, but high frequency-of-use for personal productivity flows.

- **`gog keep`** subcommands to verify:
  - `list`, `get`, `create`, `update`, `delete` for notes
  - `search`
  - Possibly labels/colors/pin metadata
- **Tool count estimate:** ~8–12 tools.
- **Caveat**: Keep API is Workspace-only (no personal Google accounts). Document this clearly in the README.
- **Decision point**: small enough that it could live in `gogcli-mcp` base instead of a focused sub-package. Default to base, only split if it grows past ~10 tools.

## Lower priority

### YouTube → potentially two sub-packages

YouTube has a huge surface; one wrapper would be unwieldy. Likely splits:

1. `gogcli-mcp-youtube-creator` — channel/video management, uploads, comments moderation, analytics for creators
2. `gogcli-mcp-youtube-viewer` — search, watch history, playlists, subscriptions for consumers

- **Decision**: skip until there's a clear user request — the surface is large and the typical agent use case is unclear.

### Sites → likely base addition or skipped

Google Sites is niche. `gog sites` probably exposes read/edit/publish. Could be folded into the base package as a small set of tools with a `run` escape hatch.

- **Tool count estimate:** ~5–8 tools.
- **Decision**: add to base only if users ask for it.

### Groups → admin, skip for now

Google Groups is workspace admin territory. Often requires a service account with domain-wide delegation.

- **Decision**: skip unless a specific admin agent use case appears. The `gog_classroom_run`-style escape hatch in a future `gog_admin_run` would cover one-off needs.

### Analytics → niche but powerful

GA4 reporting is a real agent use case (weekly traffic reports, anomaly detection), but the surface is reporting-shaped, not CRUD-shaped — typically a single "run report" tool with a heavy params object.

- **Tool count estimate:** ~6–10 tools (`reports run`, `dimensions/metrics list`, `accounts/properties list`, `realtime`).
- **Decision**: add when there's user demand. Wraps neatly into `gogcli-mcp-analytics` if added.

### Search Console → niche SEO

Same shape as Analytics: a few queries against a reporting endpoint.

- **Decision**: skip until requested. Could share a sub-package with Analytics (`gogcli-mcp-insights`?) if/when both are added.

### Admin (Workspace Directory) → skip without DWD setup

Requires domain-wide delegation, service account, admin role. Complex auth flow that doesn't fit gogcli's per-user OAuth model cleanly.

- **Decision**: skip. If anyone needs it, expose only a thin `gog_admin_run` in the base + clear docs about DWD setup.

### Apps Script → developer niche

Project management, deployments, script execution. Useful for power users automating Workspace, but niche.

- **Tool count estimate:** ~8 tools.
- **Decision**: skip until requested. Could pair with a future Sites/Forms wrapper as a "Workspace power-user" bundle.

## Cross-cutting follow-ups

- **People-as-an-alias for Contacts directory**: People search hits the Workspace directory while `gog contacts search` only sees personal contacts. Worth updating the `gog_contacts_search` description to mention `gog_people_search` for directory-wide search.
- **Meet conferences attached to events**: when `gog calendar create` is enhanced to attach a Meet space, it's a one-flag change (likely `--add-meet`). Verify the flag name with `gog calendar create --help` first.
- **Track + autoreply observability**: `gog_gmail_autoreply` adds a dedupe label on threads. Worth a recipe in the gmail README showing how to combine `gog_gmail_autoreply` with `gog_gmail_search` to inspect what was auto-replied to.

## Folded in this pass

- ✅ **People → contacts** — `gog_people_me/get/search/relations/raw` added to `packages/gogcli-mcp/src/tools/contacts.ts`.
- ✅ **Meet → calendar** — `gog_meet_create/get/update/end/history/participants` added to `packages/gogcli-mcp/src/tools/calendar.ts`.

## Conventions for new wrappers

When adding any of the above, follow the established pattern:

1. Verify the gogcli surface with `gog <service> --help` and `gog <service> <cmd> --help`.
2. TDD: write the test file first against the expected argv shape.
3. Use `accountParam` + `runOrDiagnose` from `./utils.js` (base) or `../../../gogcli-mcp/src/lib.js` (sub-packages).
4. Inline `if (flag) args.push(\`--flag=\${val}\`)` — no helpers.
5. Annotations: `readOnlyHint: true` for reads, `destructiveHint: true` for deletes/overwrites/grades. Leave creates without annotations.
6. 100% coverage threshold enforced by vitest config — write enough tests to hit every branch.
7. Update `packages/gogcli-mcp/manifest.json` with new tools.
8. Update `CLAUDE.md` packages table if scope changed.
