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

### Keep → new sub-package `gogcli-mcp-keep`

Lightweight note capture and search. Smaller surface, but high frequency-of-use for personal productivity flows.

- **`gog keep`** subcommands to verify:
  - `list`, `get`, `create`, `update`, `delete` for notes
  - `search`
  - Possibly labels/colors/pin metadata
- **Tool count estimate:** ~8–12 tools.
- **Caveat**: Keep API is Workspace-only (no personal Google accounts). Document this clearly in the README.
- **Split**: put list/get/search/create in base (common ops), put update/delete/labels-management in extras. Mirror the slides/classroom rebalance.

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

- **Meet conferences attached to events**: when `gog calendar create` is enhanced to attach a Meet space, it's a one-flag change (likely `--add-meet`). Verify the flag name with `gog calendar create --help` first.
- **Track + autoreply observability**: `gog_gmail_autoreply` adds a dedupe label on threads. Worth a recipe in the gmail README showing how to combine `gog_gmail_autoreply` with `gog_gmail_search` to inspect what was auto-replied to.
- **Manifest description drift**: ~45 of 84 base-package tool descriptions in `packages/gogcli-mcp/manifest.json` are slightly different from the source `description:` in `src/tools/*.ts`. Same for sub-package manifests. Build a `scripts/sync-manifest-descriptions.js` that reads source, extracts (tool, description) pairs, and updates each manifest. Needs special handling for the dynamic `gog_<service>_run` factory descriptions (they aren't string literals in source). Once written, run it once to sync, then add a CI check to flag future drift.

## Conventions for new wrappers

See **Tool placement** + **Adding Tools to a Sub-Package** in CLAUDE.md for the
authoritative pattern. Key points:

1. Verify the gogcli surface with `gog <service> --help` and `gog <service> <cmd> --help`.
2. TDD: write the test file first against the expected argv shape. Use the
   shared `extras-harness.ts` helper (see CLAUDE.md).
3. Use `accountParam` + `runOrDiagnose` from `./utils.js` (base) or `../../../gogcli-mcp/src/lib.js` (sub-packages).
4. Inline `if (flag) args.push(\`--flag=\${val}\`)` — no generic helpers.
5. `z.enum([...])` for closed-set flags; `z.string()` only for free-form input.
6. Split base vs extras by the "common operations vs specialty" rule
   (slides/classroom/contacts/calendar refactor in v2.0.5+ is the model).
7. 100% coverage threshold enforced by vitest config.
8. Update both base and sub-package `manifest.json` files when a tool moves.
9. Update `CLAUDE.md` packages table if tool counts or scope changes.
