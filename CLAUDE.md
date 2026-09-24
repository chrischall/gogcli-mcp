# gogcli-mcp

Monorepo of MCP servers wrapping [gogcli](https://github.com/openclaw/gogcli) — gives Claude read/write access to Google Workspace (Sheets, Docs, Gmail, Calendar, Drive, Slides, Classroom, Tasks, Contacts). Each package is a standalone MCP server using stdio transport.

## Packages

All under `packages/*` as an npm workspace. Single source of truth for version: root `package.json` (all packages share it).

| Package | Path | Scope |
|---------|------|-------|
| `gogcli-mcp` | `packages/gogcli-mcp` | Base — common subset of every service, plus `gog_<service>_run` escape hatches |
| `gogcli-mcp-sheets` | `packages/gogcli-mcp-sheets` | Auth + Sheets (base + extras: tabs, formatting, named ranges, …) |
| `gogcli-mcp-docs` | `packages/gogcli-mcp-docs` | Auth + Docs (base + extras: insert, export, sed, comments, …) |
| `gogcli-mcp-drive` | `packages/gogcli-mcp-drive` | Auth + Drive (base + extras: upload, permissions, shared drives, …) |
| `gogcli-mcp-slides` | `packages/gogcli-mcp-slides` | Auth + Slides (base + authoring extras) |
| `gogcli-mcp-classroom` | `packages/gogcli-mcp-classroom` | Auth + Classroom (base + CRUD/admin extras) |
| `gogcli-mcp-gmail` | `packages/gogcli-mcp-gmail` | Auth + Gmail (base + threads, labels, drafts, bulk ops) |
| `gogcli-mcp-contacts` | `packages/gogcli-mcp-contacts` | Auth + Contacts (base + People API extras) |
| `gogcli-mcp-calendar` | `packages/gogcli-mcp-calendar` | Auth + Calendar (base + Meet space management) |

## Commands

```bash
npm install                                          # install all workspaces
npm run build                                        # tsc --noEmit + esbuild bundle for every package
npm test                                             # vitest across all packages (100% coverage gate)
npm run typecheck                                    # tsc --noEmit across all packages

# Single package
npm run build --workspace=packages/gogcli-mcp-sheets
npm test  --workspace=packages/gogcli-mcp-docs
```

Run locally (requires a built bundle and `gog` on PATH):
```bash
GOG_ACCOUNT=you@gmail.com node packages/gogcli-mcp/dist/index.js
```

## Tool naming

All tools are prefixed `gog_` and namespaced by service (e.g. `gog_sheets_read`, `gog_gmail_send`, `gog_drive_list`). Each service also exposes `gog_<service>_run` as an escape hatch for unmapped subcommands.

## Architecture

```
packages/gogcli-mcp/
  src/
    index.ts               # bin entry — runMcp({ name, version, tools: BASE_TOOL_REGISTRARS }) from @chrischall/mcp-utils
    server.ts              # BASE_TOOL_REGISTRARS list + VERSION constant (injected by esbuild)
    runner.ts              # only module touching child_process; exports run() with Spawner DI
    lib.ts                 # barrel export consumed by sub-packages
    tools/
      auth.ts calendar.ts classroom.ts contacts.ts docs.ts drive.ts
      gmail.ts sheets.ts slides.ts tasks.ts
      utils.ts             # accountParam, runOrDiagnose, errorText, ids, paginationParams, registerRunTool
  tests/                   # drive tools through createTestHarness from @chrischall/mcp-utils/test

packages/gogcli-mcp-<service>/
  src/
    index.ts               # runMcp({ ..., tools: [registerAuthTools, registerXxxTools, registerExtra<Xxx>Tools] })
    tools/<service>-extra.ts
  tests/tools/<service>-extra.test.ts
```

Sub-packages import from `gogcli-mcp/src/lib.js` (NOT the published `gogcli-mcp/lib`) — `tsconfig.json` includes `../gogcli-mcp/src/**/*` so esbuild bundles the source directly. There is no inter-package build dependency.

`runner.ts` always injects `--json --no-input --color=never`, strips `GOG_ACCESS_TOKEN` and other ambient `*_TOKEN`/`*_SECRET`/`*_KEY`/`*_CREDENTIALS` env vars from the child, augments PATH with Homebrew/`~/.local/bin`/`~/go/bin`, and redacts bearer/refresh-token patterns from any error text surfaced to the MCP client (mcp-utils `redactSecrets` plus Google-specific `ya29.`/`1//` token shapes). Default timeout: 30 s.

## Environment

```
GOG_ACCOUNT=<email>   # default account passed as --account to every gog call (per-tool override available)
GOG_PATH=<path>       # absolute path to the gog binary; defaults to `gog` on PATH
GOG_READONLY=1        # block all mutating gog API requests (injects gog's --readonly); set to 0/false/no/off (or unset) to allow writes
DISPLAY_TZ=<IANA>     # zone for *Display fields and for interpreting naive gog values; defaults to America/New_York
GOG_TIMEZONE=<IANA>   # zone gog formats naive dates in; unset, runner.ts hands gog DISPLAY_TZ so the two cannot diverge
GOG_GMAIL_TRUSTED_DOMAINS=<csv> # additional domains excluded from external-recipient audit alerts
GOG_SEND_CONFIRM_FALLBACK=token # opt-in two-phase preview + confirmToken for gated dispatches on clients with no elicitation
GOG_CONFIRM_TTL_SECONDS=<n>     # confirmToken lifetime (default 600)
GOG_CONFIRM_SECRET=<secret>     # confirmToken HMAC key (default: random per process); stripped from gog's env by the _SECRET rule
GOG_FILE_ROOTS=<dirs>  # ':'-separated dirs every server-side path param (attach/localPath/file/out/outDir/dir) must resolve inside; default ~/gogcli-mcp-files
GOG_CLIENT_ID=<id>          # startup auth bootstrap: OAuth client id, imported into gog's keyring
GOG_CLIENT_SECRET=<secret>  # startup auth bootstrap: OAuth client secret
GOG_REFRESH_TOKEN=<token>   # startup auth bootstrap: refresh token for GOG_ACCOUNT (`gog auth tokens export`)
GOG_KEYRING_BACKEND=file    # gog's own var; `file` on a headless host with no OS keychain
GOG_KEYRING_PASSWORD=<pw>   # gog's own var; encrypts the file keyring — required with the file backend
```

`bootstrapGogAuth()` (`src/bootstrap-auth.ts`) runs once at startup, before any
tool is served: with all four of `GOG_CLIENT_ID` / `GOG_CLIENT_SECRET` /
`GOG_REFRESH_TOKEN` / `GOG_ACCOUNT` set, it feeds them to `gog auth credentials
set` and `gog auth tokens import` as temp files — `GOG_CLIENT_SECRET` and
`GOG_REFRESH_TOKEN` are stripped from every spawned `gog`'s env (the `_SECRET` /
`_TOKEN` rule; `GOG_CLIENT_ID` is not a secret and passes), so files are the only
way in. A sha256
of the four is kept at `~/.gogcli-mcp/auth-bootstrap.sha256`: an unchanged secret
is not re-imported, a rotated one is. It never throws — a broken bootstrap still
leaves the auth tools reachable. Set none of them and it does nothing (local
installs authorise with `gog auth add` as before); set some and it logs what is
missing and skips.

**Dispatch confirmation.** `requireDispatchConfirmation` (`src/dispatch-confirmation.ts`) is the one rail every
tool that reaches another person goes through: Gmail (via the `requireGmailDispatchConfirmation` wrapper in
`src/gmail-dispatch-guard.ts`), Chat send and DM, Drive share, Classroom announcement and invitation, and
guest-visible Calendar create/update/respond. A new tool that posts, shares, invites or notifies belongs on it.
Elicitation is primary. Only when the client declares none AND the call site passes a `DispatchTokenFallback`
AND `GOG_SEND_CONFIRM_FALLBACK=token` does it run the two-phase flow in `src/send-confirm-token.ts`. The fallback's `subject()` is called lazily, so an extra read there
(`gog_gmail_forward` fetches the original) never touches the elicitation path. It must rebuild the payload from a
**fresh** read on every call, because phase 2 is only as good as that re-read. A draft binds its messageId and an
event binds its etag as the token's `revision`. The forwarding-filter call site deliberately passes no fallback.
A read a sub-package makes through a base helper must take the sub-package's `runOrDiagnose` (see `readCourse`),
or the sub-package's `lib.js` mock misses it and the unit test spawns the real `gog`.

`runner.ts` treats unresolved `.mcpb` placeholders (`${user_config.xxx}`) and empty strings as unset — useful for desktop clients that pass blank user-config fields through literally.

### Redaction vs. binary payloads

Redaction is for **prose**. A base64 blob is uniformly-distributed bytes over a
64-character alphabet, so given enough of it, it *will* spell a short secret
shape by chance — `1//` (a Google refresh token) has an expected ~0.37
occurrences in a 72 KiB attachment, i.e. it corrupted roughly **30%** of inline
attachments and surfaced as an MCP `-32602 "Invalid Base64 string"` at the
client. Two defences, both needed:

1. **`TOKEN_LEFT_BOUNDARY`** — every Google token pattern is anchored on a
   non-base64 character (or start of string) to its left. A real token is always
   delimited; a mid-blob false positive never is.
2. **`RunOptions.opaqueFields`** — names JSON fields whose values are opaque
   payloads (`contentBase64`), lifted out before redaction and restored after.
   Only values that are *entirely* base64 alphabet qualify, it is opt-in per
   call, and it never applies on the error path. This covers the class, so a new
   pattern added to mcp-utils cannot silently re-break attachments.

When adding a tool that returns caller-requested bytes through `run()`, pass
`opaqueFields`. Bytes that would still be invalid must never reach an `image`/
`resource` block — validate and degrade to a path/Drive delivery instead, since
an SDK base64 rejection is a protocol fault the caller cannot act on.

### Outbound attachments (`src/attachments.ts`)

Every gog attachment input is a **path resolved where gog runs**, which is
unreachable whenever the caller and gog share no filesystem (any hosted
connector). `attachInline` / `content` carry the bytes
instead, riding the existing `GogFileArg` temp-file seam — now with
`encoding: 'base64'`, an exact `filename` (gog reads an attachment's MIME
filename off the path), and `positional` for `gog drive upload <localPath>`.
Ceilings are enforced in the tool layer so the error names the file rather than
arriving from somewhere the caller cannot see. They are this wrapper's own caps
(they began as the retired remote runner's limits and were kept): 8 MiB per file,
and a per-message total computed backwards from a 32 MiB request budget spelled
base64-encoded — a limit stated in decoded bytes has to absorb the 4/3 inflation
or it documents a size the budget rejects.

The budget belongs to the **request**, not to the attachments: a mail body over
`PAYLOAD_INLINE_MAX` becomes a `GogFileArg` riding in that same JSON body, so
`inlineAttachmentArgs` measures the sibling args it is handed rather than
assuming they are small. Pass the args assembled so far when calling it —
otherwise "every input was inside its own documented limit" can still add up to
an over-budget request. Each payload is materialized into its **own** numbered subdirectory, so
repeated `--attach` with colliding basenames is safe.

Every gog response passes through `normalizeTimestamps` (`src/timestamps.ts`) on the `runOrDiagnose` seam, which rewrites allowlisted timestamp fields to ISO-8601 with an explicit offset and adds a `<field>Display` sibling. Both the key and the value shape must match before anything is rewritten — a name-only match would corrupt spreadsheet cell data. See [`docs/timestamps.md`](docs/timestamps.md).

### Response whitespace

The same seam then **minifies**, via `minifiedResult` from `@chrischall/mcp-utils`. gog pretty-prints its `--json` output and that indentation is roughly a fifth of a large response while carrying nothing a caller reads: measured at **18.6%** of a 19 KB `drive ls` (~900 tokens per call) and 38% of a small deeply-nested one. For a passthrough wrapper — a tool's output *is* gog's JSON — this is the largest token saving available, because there is no projection to make instead.

Three properties are load-bearing and tested in `tests/tools/utils.test.ts`:

- **Only FORMATTING whitespace goes.** `JSON.stringify` with no indent leaves whitespace *inside* a value untouched — the blank line between paragraphs of a mail body, the indentation of a quoted block. Never replace this with a regex over the serialised text or a `\s+` collapse; those corrupt exactly the payloads it exists to shrink.
- **Key order is preserved.** gog emits `nextPageToken` before its data array, and a truncated read still has to see it.
- **Non-JSON passes through byte-for-byte.** `gog auth list` is plain text and an empty body is legal; a mangled non-answer is worse than a large one. The guard mirrors `normalizeTimestamps`' so the two agree on what counts as JSON.

`lossless: true` is exempt and stays indented. That mirrors the fleet's `raw` rung, which `mcp-utils`' `viewResult` also leaves indented: it is the rung a *person* reaches for when a payload is not what they expected, and indentation is most of what makes an unfamiliar shape legible.

### The `view` enum

`gog_drive_ls` and `gog_calendar_events` register `view: 'compact' | 'full'` (`viewParam`/`resolveView` from mcp-utils), defaulting to **compact**. Compact is a real projection because gog passes `--fields` through to Google as an API field mask — it is not a local reshape.

Two rules govern any new one:

1. **The mask MUST name the response envelope's paging field, first.** A mask of `files(...)` or `items(...)` alone makes Google drop `nextPageToken`, so a compact read returns page one with an empty cursor and reads as "there is nothing more". Silent truncation, verified live on gog 0.39.0 for both Drive and Calendar. Each mask constant is asserted to start with `nextPageToken`.
2. **Choose the dropped fields from the DATA.** `drive ls` drops `thumbnailLink` (4,998 B at ONE distinct value over 25 rows), `owners`, `parents` and `hasThumbnail` — all near-constant. `calendar events` drops `description` (5,951 B) and `attendees` (3,145 B), the fat blobs `full` exists to return. Savings: **48%** and **66%**.

A rejected mask is not fatal: `runOrDiagnose` retries **unprojected** on a Google `invalidParameter` and says so on stderr, which is `projectOrRaw`'s role for a projection that happens across the network. Only a rejected mask is retried — a missing file is not a bad mask.

Only **9** gog commands accept `--fields` at all (`gog schema --json`), nearly all Drive plus `calendar events`, so this is the whole addressable set. `drive get` is excluded deliberately: its default set is already narrow and a mask saves 7%, which is below the bar for a parameter and a failure mode — "a tool whose output is already narrower than the projection takes no `view` at all".

**Not `raw`.** For a passthrough wrapper `raw` and `full` are the same bytes, and advertising both is the aliasing lie `fleet-conventions.md` forbids. Note also that this repo's `lossless` is NOT the fleet's `raw`: `lossless` skips normalization to give the `*_raw` dumps verbatim ground truth, whereas fleet `raw` means "no projection" and explicitly still normalizes.

**Two mechanisms, one vocabulary.** `compact` is served two different ways, and a caller never has to know which:

| mechanism | where | tools |
|---|---|---|
| `--fields` mask (Google projects it) | upstream | `gog_drive_ls`, `gog_calendar_events` |
| `stripMediaUrls` (we project it) | local, via `runOrDiagnose`'s `stripMedia` | `gog_drive_search`, `gog_drive_get` |

The local strip exists because only 9 gog commands accept `--fields`. It drops `thumbnailLink` and friends — URLs a model cannot see, cannot fetch, and would not benefit from if it could — and is verified end-to-end at **27.8%** on `gog_drive_search` and **27.5%** on `gog_drive_get`, with `webViewLink` (the URL a caller acts on, sitting in the same object) intact.

It is **opt-in per tool**, never applied at the seam by default, because a tool whose PRODUCT is the image must never strip — the tool's own name is the test. `gog_drive_ls` deliberately does not use it: its mask already drops `thumbnailLink` upstream, and applying it to `full` would contradict what `full` means.

This needed mcp-utils **0.23.0**: 0.22.0's `MEDIA_KEY` was anchored to a bare noun (`^photos?$`) while every Google API suffixes (`thumbnailLink`, `iconUri`, `photoUrl`), so it matched nothing here and measured 0.0%. Fixed upstream in chrischall/mcp-utils#192.

**Every other read tool takes no `view`, deliberately.** Per `fleet-conventions.md`, a tool registers only rungs it can honour, and without a field mask `compact` and `full` would be byte-identical — the aliasing lie. Adding `view` to a tool whose gog subcommand has no `--fields` would advertise a saving that does not exist.

**Server-side paths.** Every tool param naming a path on the gog host (`attach`, `localPath`, `file`, `contentFile`, `notesFile`, `image`, `bodyHtmlFile`, `signatureFile`, `out`, `dir`, an `@file` JSON input) goes through `confinePath` (`src/file-roots.ts`, mcp-utils `assertPathWithinRoots`, symlink-resolved) against `GOG_FILE_ROOTS` plus the private attachment download root — a new path param must too. Attachment downloads default to `ATTACHMENT_DOWNLOAD_ROOT` (`src/attachment-root.ts`): per-user under the OS temp dir, verified 0700/owned/not-a-symlink before each use, staging copies deleted after inline/Drive/URL delivery, the rest swept after 24 h. A tool that writes a file is never `readOnlyHint: true` (this overrides the "never downgrade" rule below); the read tools that used to `--download` (`thread_get`, `thread_attachments`, `drafts_get`) now refuse it and point at `gog_gmail_attachment`.

**Escape hatches and safety flags.** `gog_<service>_run` and `gog_api_call` forward model-supplied args, and gog takes the LAST value of a repeated flag, so `src/arg-guard.ts` refuses any forwarded arg that is `--` or is exactly (alone or with `=value`, case-insensitive) `--readonly`, `--enable-commands[-exact]`, `--disable-commands`, `--access-token`, `--home`, `--account`/`--acct`/`-a`, `--client`, `--gmail-no-send` or `--no-input`/`--non-interactive`; the runner refuses the same flags anywhere before `--` as a backstop. Exact names, never prefixes: the backstop sees every tool's argv, and a prefix match refused `gog_zoom_auth_setup`'s `--account-id`/`--client-id`/`--client-secret`. `src/run-path-guard.ts` applies `GOG_FILE_ROOTS` to every `gog_<service>_run`: path flags (`--out`, `--out-dir`, `--attach`, `--file`, `--*-file`, `--key`, `--cert`, `@file` in `--*-json`) are confined, `-o`/`-f` short forms and command-running flags (`--on-change`, `--on-new`, `--mmdc`) are refused, and subcommands whose local path is positional (`drive upload`/`sync`, `gmail import`, `appscript pull`, `slides add-slide`/`insert-image`/`replace-slide`) are refused in favour of their dedicated tools. `gog_auth_run` only runs `list`/`status`/`services`/`remove`/`alias`. `gog_gmail_run` and `gog_api_call` always run with gog's `--gmail-no-send` and refuse forwarding, filter, delegate and `*.send` paths — sending goes through the confirmed tools. gog also accepts `filters`/`forwarding`/`autoforward`/`delegates` directly under `gmail` (not listed in `gog schema`), so `vetGmailRun` refuses them as the subcommand as well as anywhere in a `settings` call's args.

`GOG_READONLY` is a global kill-switch: when set to any value other than `0`/`false`/`no`/`off`, `runner.ts` adds gog's `--readonly` flag to every call so mutating API requests are refused at runtime. gog has no native env binding for `--readonly`, so the wrapper translates the env var into the flag; callers can also opt in per-call via the `readonly` option on `RunOptions`.

### Required gog version

`runner.ts` exports `MIN_GOG_VERSION` — the minimum gogcli (`gog`) binary version the wrapper's tools assume. It's the single source of truth (keep this section in sync). When a change starts relying on a newer `gog` flag/subcommand, bump `MIN_GOG_VERSION` and label the PR **`gogcli-bump`** so the requirement change surfaces in its own release-notes section (`.github/release.yml`). Current floor: **gog ≥ 0.41.0**. A bump must also move **the `tag:` in all nine `packages/*/mint.yaml` `dependencies` blocks** — those pin the `gog` release a hosted install provisions, so leaving them behind hands the child a binary older than the floor its tools assume. `scripts/check-runner-gog-version.mjs` checks those against the floor and fails `npm test` on any pin below it, so a missed one is a red build.

A third pin set it **cannot** see is the `dependencies` pin stored on each live mcp-host registration. mcp-host resolves a dependency to an exact tag + asset + sha256 at registration time and keeps it; the follow cron moves only the *package* version, never a dependency pin. So a floor bump also means, on each of the six registrations below:

```sh
mcp-host set <id> --dep 'github:openclaw/gogcli@v<NEW>:gogcli_*_linux_amd64.tar.gz#gog'
```

(`set --dep` replaces the whole list, which is fine — gog is the only one.) Skip it and the connector follows to a release whose tools send flags its pinned `gog` does not have.

### Hosted registrations (mcp-host)

Six sub-packages are registered on mcp-host as their own connectors —
`gog-classroom`, `gog-docs`, `gog-drive`, `gog-gmail`, `gog-sheets`,
`gog-slides` — each `--npm`, `--follow` and `--data-dir`, with the
`openclaw/gogcli` dependency and the auth secrets. mcp-host installs `gog` onto
the child's PATH, the child spawns it locally with `$HOME` on the persistent data
dir, and `bootstrapGogAuth()` seeds gog's file keyring there from the secrets at
startup. That is exactly what `mint.yaml` declares, so a registration has no
standing `unmet` manifest asks. Registering a new one mirrors the others:

```sh
mcp-host register --slug gog-<service> --npm gogcli-mcp-<service> \
  --name 'gog <service>' --follow --data-dir \
  --dep 'github:openclaw/gogcli@v0.41.0:gogcli_*_linux_amd64.tar.gz#gog' \
  --env GOG_KEYRING_BACKEND=file \
  --secret-env GOG_CLIENT_ID=GOG_CLIENT_ID \
  --secret-env GOG_CLIENT_SECRET=GOG_CLIENT_SECRET \
  --secret-env GOG_REFRESH_TOKEN=GOG_REFRESH_TOKEN \
  --secret-env GOG_ACCOUNT=GOG_ACCOUNT \
  --secret-env GOG_KEYRING_PASSWORD=GOG_KEYRING_PASSWORD \
  --tools "$(node -e '…manifest minus *_run…')"
```

The `--dep` tag is the current `MIN_GOG_VERSION` — see [Required gog version](#required-gog-version).

**Rotating auth.** Two paths, and the marker decides between them. Either update
the `GOG_REFRESH_TOKEN` secret (a fresh one comes from `gog auth tokens export`
on a machine where the account is authorised) and restart the child — the
changed fingerprint makes the bootstrap re-import it — or re-auth in-connector
with `gog_auth_add_url` → `gog_auth_add_complete`. The in-connector token lands
in the keyring on the data dir and survives restarts, because the bootstrap only
re-imports when the *secret* changes; the next secret rotation then overrides
it.

**The `enabledTools` allowlist rots, and only we can see it.** Its whole job is
to withhold the two `*_run` escape hatches — arbitrary `gog` subcommand
execution is not something a hosted connector should offer — but mcp-host stores
that as an allowlist of *every other name*. So "hide two tools" is written as
"show these 53", and shipping a new tool leaves it absent from a list nobody
edited: fine on stdio, silently unreachable over the connector. mcp-host will
not catch it. `--follow` moves the version pin and carries `enabledTools` across
untouched, and the daily mint check lists `tools.enable` among its *deliberate*
silences — "a narrowing; a registration that ignores it serves more, not less."
That is the right default for a host reading an unverified file, and it is
exactly the blind spot we sit in, because we narrow on purpose.

`scripts/sync-mcp-host-tools.mjs` closes it. The list is **derived, never
authored**: `GET /registrations/{id}/tools` returns what the running child
serves, unnarrowed, so the correct allowlist is that set minus `*_run`. It reads
nothing from this checkout, which is what lets it judge whatever version each
registration has actually followed to.

```sh
npm run check:mcp-host-tools     # report drift, exit 1 if any
npm run sync:mcp-host-tools      # PUT the corrected lists
```

It also rides `npm test` as `--if-configured`, which **skips** (exit 0) when
`MCP_HOST_URL` / `MCP_HOST_ADMIN_TOKEN` are absent or the host is unreachable —
this is the one check here that talks to a live deployment, so it must be a
no-op in CI rather than a red build. Drift found by a check that *completed* is
never downgraded. There is no schedule: run it yourself after a release has been
followed.

**Timing matters, and it is counter-intuitive.** Syncing at release time is a
no-op — mcp-host is still pinned to the previous version and its child still
serves the old tools. The follow cron moves the pin ~04:17Z daily, so the check
is only meaningful *after* that has run and the child has restarted.

## Tool placement

The split between base and sub-package extras matters:

- **Base** = common operations every service exposes (read, list, get, grade, accept, send — daily writes a user reaches for) plus the `run` escape hatch.
- **Sub-package extras** = service-specific authoring, admin, CRUD that's intentionally niche enough to keep out of the kitchen-sink bundle.

When adding a tool, ask: does a user opening the all-services base package want this exposed by default? Yes → base. No → extras.

## Adding tools to a sub-package

1. Register in `packages/<pkg>/src/tools/<service>-extra.ts`.
2. Add a test in `packages/<pkg>/tests/tools/<service>-extra.test.ts` using the shared harness:
   ```ts
   import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
   import { rawTextResult } from '@chrischall/mcp-utils';
   ```
   Tool calls go through the real MCP RPC path (`harness.callTool(name, args)`), so zod
   input validation applies and thrown handler errors surface as `isError: true` results.
3. Import `accountParam` / `runOrDiagnose` from `../../../gogcli-mcp/src/lib.js`.
4. Inline `if (flag) args.push(\`--flag=\${val}\`)` — no helpers.
   Wrap every caller-supplied **positional** value (an ID, a query, a range, a name) in `pos()` from `lib.js` — `['gmail', 'search', pos(query)]`, `args.push(pos(calendarId))`, `...ids.map(pos)`. The runner moves marked values after a single `--` at the end of the argv, so a value starting with `-` (`-in:spam`, `--readonly=false`) is data, never a gog flag. Command words and flags stay bare strings; flags always use the `--flag=value` form.
5. Use `z.enum([...])` for closed-set CLI flags (states, types, roles), not `z.string()` with values in `.describe()`.
6. Annotations: **every tool declares one — "unannotated" is not neutral**, and the answer is MEASURED rather than judged. `destructiveHint` defaults to TRUE in the spec, so leaving a tool unannotated (which this list used to tell you to do) publishes it as destructive, and a client that must raise the same alarm for `gog_gmail_drafts_forward` as for `gog_gmail_send` has told the reader nothing. **The oracle is `gogcli/safety-profiles/`**, whose two profiles classify gog's own subcommands: `readonly: true` → `readOnlyHint: true`; `readonly: false` + `agent-safe: true` → `destructiveHint: false`; `agent-safe: false` → `destructiveHint: true`. The middle bucket is RECOVERABILITY, not "only additive" — `drive rename`, `calendar move`, `sheets rename-tab` and `gmail drafts update` relocate or overwrite and are still `false`, because the question this field answers is *should the client stop and ask a human*, and "can this be undone" is the better test of that than "does it only append". Anything the profiles do not classify EXACTLY stays as it is: a PARENT entry never classifies its children (`sheets.links: true` is the read, not `sheets links set` — that shipped as a write marked read-only, #381), a service-root `false` is a blanket block rather than a verdict (`classroom: false`), and an existing `readOnlyHint: true` is never downgraded. Verify what you actually published by reading `tools/list` off the BUILT server — the source is easy to mis-grep, an annotation may come from a shared registrar, and a handler that reads before it writes must be classified by its most dangerous call, not its first.
7. Gated deletes need `--force`: if the `gog` subcommand prompts for confirmation, append `--force` to the args — the runner always injects `--no-input`, so without it gog refuses (`refusing to delete … without --force (non-interactive)`). Not every delete is gated; confirm against a real `gog` (the mocked tests can't catch a missing `--force`). See [Gotchas](#gotchas).
8. Add the new tool to the sub-package's `manifest.json`.
9. After the release ships **and mcp-host has followed to it** (~04:17Z the next day), run
   `npm run sync:mcp-host-tools` — a new tool is absent from the hosted `enabledTools`
   allowlist until someone pushes it. See [Hosted registrations](#hosted-registrations-mcp-host).

## Auth & re-auth

`gog auth add` uses a **user-owned** OAuth client (`gog` has no built-in shared client). If that
client's consent screen is in **"Testing"** publishing status, Google expires every refresh token
**7 days** after authorization — surfacing as an account-wide `invalid_grant` roughly weekly. The
durable fix is to **publish the consent screen to "In production"** in the owning Google Cloud
project. Full write-up: [`docs/auth-invalid-grant-diagnosis.md`](docs/auth-invalid-grant-diagnosis.md).

Wrapper support for this:

- **`gog_auth_health`** — live per-account validity (`gog auth list --check`), token age, and a
  pre-expiry warning near the 7-day cliff. Unlike `gog_auth_status`, it makes a real refresh call.
- **`gog_auth_add_url` → `gog_auth_add_complete`** — the two-step remote/headless re-auth (gog
  `--remote --step 1/2`). Works over the hosted connector, where interactive `gog_auth_add`
  cannot. Pass the same `services` to both; step 2 must run within 10 min of step 1.
- **`diagnose()`** maps `invalid_grant` to a distinct, actionable error (cause + durable fix +
  both re-auth paths) on every service.
- **Least-privilege scopes.** The re-auth tools default `services` to only what the package wraps
  (`authToolsFor('<service>')`); the base all-services package keeps `all`. This avoids
  `invalid_scope` (Google rejects the whole request if any one scope is for a non-enabled API — and
  the wrapper can't catch that, since it happens in the user's browser, not at URL-build time).
  Overridable per call. Offender scopes → APIs to enable: [`docs/auth-scopes.md`](docs/auth-scopes.md).
- **`redactMode: 'tokens'`** on `run()` — for output that carries no token but that the shared
  redactor would corrupt (a step-1 consent URL's scope names); applies only the `ya29.`/`1//`
  token shapes. Default stays `'full'`.

## Adding a new Google service to base

1. Create `packages/gogcli-mcp/src/tools/<service>.ts` exporting `registerXxxTools(server: McpServer)`.
2. Add tests in `packages/gogcli-mcp/tests/tools/<service>.test.ts`.
3. Wire it into `BASE_TOOL_REGISTRARS` in `packages/gogcli-mcp/src/server.ts` and re-export from `src/lib.ts`.
4. Add the tools to `packages/gogcli-mcp/manifest.json`.
5. Same annotation/enum/inline-style rules as above.

## Testing

```bash
npm test                                            # all packages
npm test --workspace=packages/gogcli-mcp -- runner  # single file
```

`vitest.config.ts` enforces 100% line/branch/function/statement coverage on `src/**` (excluding `src/index.ts`). No real `gog` invocations — `runOrDiagnose` is mocked via `vi.mock('.../lib.js', ...)`; the runner has its own tests with a `Spawner` stub.

## Versioning

**Single source of truth:** root `package.json` → `"version"`. All workspaces share it. The build script (`scripts/bundle.js`) injects it into bundles at build time via `--define:GOGCLI_VERSION`.

Files that store the version, bumped in one release PR:

1. Root `package.json` and every `packages/*/package.json` are kept in sync by release-please's **`node-workspace`** plugin (no `extra-files` entry needed for these).
2. Other version-bearing files — `manifest.json`, `server.json`, `.claude-plugin/{plugin,marketplace}.json` — are declared as `extra-files` per package in `release-please-config.json`. Not every package ships every asset; e.g. `gogcli-mcp-contacts` and `gogcli-mcp-gmail` only list `manifest.json` in their `extra-files` block.

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. release-please owns versioning.

### Release workflow

release-please (`.github/workflows/release-please.yml`) opens / updates a single combined release PR whenever Conventional-Commit-style commits accumulate on `main` (`feat:`, `fix:`, etc.). Merging the release PR creates one `v<NEXT>` tag for all sub-packages (linked-versions); the second job in the same workflow then builds `.mcpb` bundles + `.skill` files, publishes every sub-package to npm via Trusted-Publisher OIDC, publishes each `server.json` to the MCP Registry, publishes skills to ClawHub (when `CLAWHUB_TOKEN` is set), and attaches all artifacts to the GitHub Release release-please authored.

<!-- pr-workflow:v3 -->
## Pull requests & release notes

Fleet policy — Conventional-Commit PR titles, labels, the auto-review /
auto-merge ladder, auto-review follow-up issues, PR timing, and release PRs —
lives in `~/.claude/CLAUDE.md`. Don't restate it here; the copies drifted.

Shared technical conventions (publishing, bundling, versioning guards,
write-verification, transport archetypes, testing traps) live in
[`chrischall/workflows`](https://github.com/chrischall/workflows):
`docs/fleet-conventions.md`, plus `README.md` for the CI pipeline contract.

## gogcli notes

- `gog schema --json` outputs the machine-readable command/flag schema for every subcommand — use it to look up flags before adding new tools.
- `gog sheets update` / `gog sheets append` accept `--values-json=<JSON 2D array>` for structured input.
- All commands take `--account <email>` for multi-account targeting.
- `--no-input` suppresses interactive prompts; `--json` ensures parseable output; `--color=never` strips ANSI codes. The runner always sets all three.

## Gotchas

- **ESM + NodeNext**: imports must use `.js` extensions even for `.ts` source (e.g. `import { run } from './runner.js'`).
- **Sub-packages bundle base source directly**: each sub-package's `tsconfig.json` includes `../gogcli-mcp/src/**/*` and esbuild inlines it. Don't try to import from the published `gogcli-mcp/lib` path inside the workspace.
- **Registrar lists, not server factories**: every package's `index.ts` boots via `runMcp` from `@chrischall/mcp-utils` with a registrar list. Sub-packages assemble their own list from `lib.js` registrars; only the base bin uses `BASE_TOOL_REGISTRARS`.
- **stdio transport**: stdout is reserved for JSON-RPC — never `console.log` from request handlers. Log to stderr.
- **Secrets in env**: `runner.ts` strips `GOG_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, and any var ending in `_TOKEN`/`_SECRET`/`_KEY`/`_CREDENTIALS` before spawning `gog`. `_PASSWORD` is deliberately NOT on it: `GOG_KEYRING_PASSWORD` decrypts gog's own file keyring, so that rule would strip the one credential the child needs. Adding new ambient credentials? Audit the regex with a control case for anything the child legitimately reads.
- **PATH augmentation**: desktop MCP clients spawn with a stripped PATH; the runner re-adds `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/go/bin`. If `gog` lives elsewhere, set `GOG_PATH`.
- **Coverage gate**: 100% on `src/**` (excluding each package's `src/index.ts`). New code without tests fails CI.
- **`--force` on gated destructive commands**: gog gates MOST destructive commands behind a confirmation, and the runner always injects `--no-input`, so without `--force` they fail at runtime with `refusing to … without --force (non-interactive)`. Assume a new delete/remove/clear-style subcommand is gated unless proven otherwise — the authoritative check is `confirmDestructive`/`dryRunAndConfirmDestructive` call sites in gogcli's `internal/cmd/`, or probe live with fake IDs: `gog <cmd> fakeid --no-input` (the gate fires before any API call — but beware commands that resolve names via the API *first*; those show an API error on fake IDs even when gated, e.g. `sheets delete-tab`, `gmail labels delete`). Conventions: append `--force` as the LAST arg; conditional gates get a conditional push (`drive share` only for `to=anyone`, `api call` only with `allowWrite`, `gmail filters create` only with `forward`, `docs insert-image`/`replace-image` only with a local `file`, `contacts dedupe` only with `apply`). Exception: `gog_gmail_drafts_delete` and `gog_gmail_batch_delete` deliberately expose `force` as a tool param instead of auto-appending — permanent deletions that bypass Trash keep the extra friction. Known non-gated (leave alone): `docs table-row/column delete`, `docs named-range delete`, `docs delete`, `docs clear`, `sheets named-ranges delete`, `sheets clear`, `sheets validation clear`, `classroom courses archive`, `gmail batch trash`. The mocked unit tests only assert the arg array, so a missing `--force` passes CI but breaks live.
- **Plugin assets**: `.claude-plugin/{plugin,marketplace}.json`, `manifest.json`, `server.json`, `SKILL.md` are distribution artifacts — they're not part of the runtime but their versions are synced at release time. Don't bump them by hand.
- **Exactly ONE copy of the MCP SDK** — tools use the modular SDK v2 `@modelcontextprotocol/server`, and it must resolve to the same physical copy here and inside `@chrischall/mcp-utils`; `packages/gogcli-mcp/tests/sdk-single-copy.test.ts` is the guard. `McpServer` carries private state, so a second copy produces nominal `TS2322` errors with no source-level API mismatch. Read the resolved paths in those errors before changing registrar signatures. Nothing in the tree needs the legacy `@modelcontextprotocol/sdk` v1 any more; do not reintroduce it.
- **Exactly ONE `zod` in the tree, for the same reason** — `packages/gogcli-mcp/tests/zod-single-copy.test.ts` is the guard. Any dependency that pins zod can take the hoisted root slot that `@chrischall/mcp-utils` (peer `^4.4.0`) and the MCP SDK resolve zod from; once a workspace asks for a newer zod than that pin, each nests its own copy. `ZodType` carries brand-bearing internals, so TypeScript compares the two **nominally**, and every schema handed to `registerTool` fails `TS2322: Type 'ZodString' is not assignable to type 'AnySchema'` — dependabot #333 produced **11,024** such errors from one patch-level bump, with nothing wrong in the source. Today nothing pins zod and the root `overrides` carries no `zod` entry; if a new dependency splits the tree, add one (dev-tree only, never published) and bump it with zod.
