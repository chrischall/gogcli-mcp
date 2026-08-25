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

`runner.ts` always injects `--json --no-input --color=never`, strips `GOG_ACCESS_TOKEN` and other ambient `*_TOKEN`/`*_SECRET`/`*_API_KEY`/`*_PRIVATE_KEY` env vars from the child, augments PATH with Homebrew/`~/.local/bin`/`~/go/bin`, and redacts bearer/refresh-token patterns from any error text surfaced to the MCP client (mcp-utils `redactSecrets` plus Google-specific `ya29.`/`1//` token shapes). Default timeout: 30 s.

## Environment

```
GOG_ACCOUNT=<email>   # default account passed as --account to every gog call (per-tool override available)
GOG_PATH=<path>       # absolute path to the gog binary; defaults to `gog` on PATH
GOG_READONLY=1        # block all mutating gog API requests (injects gog's --readonly); set to 0/false/no/off (or unset) to allow writes
DISPLAY_TZ=<IANA>     # zone for *Display fields and for interpreting naive gog values; defaults to America/New_York
GOG_TIMEZONE=<IANA>   # zone gog itself formats in; pinned on the Fly runner, keep in sync with DISPLAY_TZ
GOG_RUNNER_URL=<url>  # run gog on the Fly backend instead of spawning the binary (remote-runner.ts)
GOG_RUNNER_KEY=<key>  # bearer for that backend; BOTH or neither — either alone is refused, not silently spawned
```

`GOG_RUNNER_URL` + `GOG_RUNNER_KEY` are what let a host with no `gog` binary
serve at all — notably mcp-host, whose runner image is Node + git + tar and
nothing else. Set them and `useRemoteGogRunner()` installs the same executor the
Cloudflare connector uses, forwarding arg-arrays to `<runner>/run`; leave either
unset and nothing changes. `GOG_PATH` is then irrelevant, since nothing is
spawned.

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
unreachable whenever the caller and gog share no filesystem (hosted connector,
any `GOG_RUNNER_URL` backend). `attachInline` / `content` carry the bytes
instead, riding the existing `GogFileArg` temp-file seam — now with
`encoding: 'base64'`, an exact `filename` (gog reads an attachment's MIME
filename off the path), and `positional` for `gog drive upload <localPath>`.
Ceilings are enforced in the tool layer so the error names the file rather than
arriving from a transport the caller cannot see, and **both are derived from the
Fly runner's own constants** rather than picked: 8 MiB per file mirrors
`MAX_FILE_ARG_BYTES`, and the per-message total is computed backwards from
`MAX_BODY_BYTES` (32 MiB) because payloads travel base64-encoded inside one JSON
body — a limit stated in decoded bytes has to absorb the 4/3 inflation or it
documents a size the runner rejects. Restate a runner constant here and keep the
two in sync; the alternative is importing a package the Worker bundle must not
pull in.

The budget belongs to the **request**, not to the attachments: a mail body over
`PAYLOAD_INLINE_MAX` becomes a `GogFileArg` riding in that same JSON body, so
`inlineAttachmentArgs` measures the sibling args it is handed rather than
assuming they are small. Pass the args assembled so far when calling it —
otherwise "every input was inside its own documented limit" can still add up to
a rejected request. Each payload is materialized into its **own** numbered subdirectory, so
repeated `--attach` with colliding basenames is safe.

Every gog response passes through `normalizeTimestamps` (`src/timestamps.ts`) on the `runOrDiagnose` seam, which rewrites allowlisted timestamp fields to ISO-8601 with an explicit offset and adds a `<field>Display` sibling. Both the key and the value shape must match before anything is rewritten — a name-only match would corrupt spreadsheet cell data. See [`docs/timestamps.md`](docs/timestamps.md).

`GOG_READONLY` is a global kill-switch: when set to any value other than `0`/`false`/`no`/`off`, `runner.ts` adds gog's `--readonly` flag to every call so mutating API requests are refused at runtime. gog has no native env binding for `--readonly`, so the wrapper translates the env var into the flag; callers can also opt in per-call via the `readonly` option on `RunOptions`.

### Required gog version

`runner.ts` exports `MIN_GOG_VERSION` — the minimum gogcli (`gog`) binary version the wrapper's tools assume. It's the single source of truth (keep this section in sync). When a change starts relying on a newer `gog` flag/subcommand, bump `MIN_GOG_VERSION` and label the PR **`gogcli-bump`** so the requirement change surfaces in its own release-notes section (`.github/release.yml`). Current floor: **gog ≥ 0.38.0**. A bump must also move the `fly-gog-runner/Dockerfile` `GOG_VERSION` build arg **and the `tag:` in all nine `packages/*/mint.yaml` `dependencies` blocks** — those pin the `gog` release a hosted install provisions, so leaving them behind hands the child a binary older than the floor its tools assume, and nothing else ties them together.

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
5. Use `z.enum([...])` for closed-set CLI flags (states, types, roles), not `z.string()` with values in `.describe()`.
6. Annotations: `readOnlyHint: true` for reads; `destructiveHint: true` for deletes/overwrites/grades/run-escape-hatches. Leave creates and restorative ops unannotated.
7. Gated deletes need `--force`: if the `gog` subcommand prompts for confirmation, append `--force` to the args — the runner always injects `--no-input`, so without it gog refuses (`refusing to delete … without --force (non-interactive)`). Not every delete is gated; confirm against a real `gog` (the mocked tests can't catch a missing `--force`). See [Gotchas](#gotchas).
8. Add the new tool to the sub-package's `manifest.json`.

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
- **Secrets in env**: `runner.ts` strips `GOG_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, and any var ending in `_TOKEN`/`_SECRET`/`_API_KEY`/`_PRIVATE_KEY` before spawning `gog`. Adding new ambient credentials? Audit the regex.
- **PATH augmentation**: desktop MCP clients spawn with a stripped PATH; the runner re-adds `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/go/bin`. If `gog` lives elsewhere, set `GOG_PATH`.
- **Coverage gate**: 100% on `src/**` (excluding each package's `src/index.ts`). New code without tests fails CI.
- **`--force` on gated destructive commands**: gog gates MOST destructive commands behind a confirmation, and the runner always injects `--no-input`, so without `--force` they fail at runtime with `refusing to … without --force (non-interactive)`. Assume a new delete/remove/clear-style subcommand is gated unless proven otherwise — the authoritative check is `confirmDestructive`/`dryRunAndConfirmDestructive` call sites in gogcli's `internal/cmd/`, or probe live with fake IDs: `gog <cmd> fakeid --no-input` (the gate fires before any API call — but beware commands that resolve names via the API *first*; those show an API error on fake IDs even when gated, e.g. `sheets delete-tab`, `gmail labels delete`). Conventions: append `--force` as the LAST arg; conditional gates get a conditional push (`drive share` only for `to=anyone`, `api call` only with `allowWrite`, `gmail filters create` only with `forward`, `docs insert-image`/`replace-image` only with a local `file`, `contacts dedupe` only with `apply`). Exception: `gog_gmail_drafts_delete` and `gog_gmail_batch_delete` deliberately expose `force` as a tool param instead of auto-appending — permanent deletions that bypass Trash keep the extra friction. Known non-gated (leave alone): `docs table-row/column delete`, `docs named-range delete`, `docs delete`, `docs clear`, `sheets named-ranges delete`, `sheets clear`, `sheets validation clear`, `classroom courses archive`, `gmail batch trash`. The mocked unit tests only assert the arg array, so a missing `--force` passes CI but breaks live.
- **Plugin assets**: `.claude-plugin/{plugin,marketplace}.json`, `manifest.json`, `server.json`, `SKILL.md` are distribution artifacts — they're not part of the runtime but their versions are synced at release time. Don't bump them by hand.
- **Exactly ONE `@modelcontextprotocol/sdk` in the tree** — the root `overrides` block exists solely to hold that line, and `packages/gogcli-mcp/tests/sdk-single-copy.test.ts` is the guard. `agents` (root devDependency, the Worker connector's `McpAgent`) declares the SDK as an **exact** pin, so it takes the root slot that `@chrischall/mcp-utils` resolves its peer from — and it does so wherever npm happens to place mcp-utils itself, since a nested copy walks up to that same root. The moment our workspaces ask for a newer SDK than that pin, they nest a second copy, and because `McpServer` carries a `private _serverInfo` TypeScript compares the two **nominally**: every entry in `BASE_TOOL_REGISTRARS` fails `TS2322: not assignable to type 'ToolRegistrar'` with no API change and nothing to fix in the source. That is a dependency-resolution failure wearing a type error's clothes — read the resolved paths in the error, not the signature. The override is a private-root dev-tree concern only; it is not published and cannot reach a consumer of these packages. When bumping the SDK, bump the override with it (dependabot does not know it exists).
