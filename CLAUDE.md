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
    index.ts               # bin entry — createBaseServer() + stdio transport
    server.ts              # createBaseServer() factory + VERSION constant (injected by esbuild)
    runner.ts              # only module touching child_process; exports run() with Spawner DI
    lib.ts                 # barrel export consumed by sub-packages
    tools/
      auth.ts calendar.ts classroom.ts contacts.ts docs.ts drive.ts
      gmail.ts sheets.ts slides.ts tasks.ts
      utils.ts             # accountParam, runOrDiagnose, toText/toError, ids, paginationParams, registerRunTool
  tests/
    helpers/test-harness.ts # setupHandlers(register) + toText(); ToolHandler type

packages/gogcli-mcp-<service>/
  src/
    index.ts               # createServer() + registerAuthTools + registerXxxTools + registerExtra<Xxx>Tools
    tools/<service>-extra.ts
  tests/tools/<service>-extra.test.ts
```

Sub-packages import from `gogcli-mcp/src/lib.js` (NOT the published `gogcli-mcp/lib`) — `tsconfig.json` includes `../gogcli-mcp/src/**/*` so esbuild bundles the source directly. There is no inter-package build dependency.

`runner.ts` always injects `--json --no-input --color=never`, strips `GOG_ACCESS_TOKEN` and other ambient `*_TOKEN`/`*_SECRET`/`*_API_KEY`/`*_PRIVATE_KEY` env vars from the child, augments PATH with Homebrew/`~/.local/bin`/`~/go/bin`, and redacts bearer/refresh-token patterns from any error text surfaced to the MCP client. Default timeout: 30 s.

## Environment

```
GOG_ACCOUNT=<email>   # default account passed as --account to every gog call (per-tool override available)
GOG_PATH=<path>       # absolute path to the gog binary; defaults to `gog` on PATH
GOG_READONLY=1        # block all mutating gog API requests (injects gog's --readonly); set to 0/false/no/off (or unset) to allow writes
```

`runner.ts` treats unresolved `.mcpb` placeholders (`${user_config.xxx}`) and empty strings as unset — useful for desktop clients that pass blank user-config fields through literally.

`GOG_READONLY` is a global kill-switch: when set to any value other than `0`/`false`/`no`/`off`, `runner.ts` adds gog's `--readonly` flag to every call so mutating API requests are refused at runtime. gog has no native env binding for `--readonly`, so the wrapper translates the env var into the flag; callers can also opt in per-call via the `readonly` option on `RunOptions`.

### Required gog version

`runner.ts` exports `MIN_GOG_VERSION` — the minimum gogcli (`gog`) binary version the wrapper's tools assume. It's the single source of truth (keep this section in sync). When a change starts relying on a newer `gog` flag/subcommand, bump `MIN_GOG_VERSION` and label the PR **`gogcli-bump`** so the requirement change surfaces in its own release-notes section (`.github/release.yml`). Current floor: **gog ≥ 0.31.1**.

## Tool placement

The split between base and sub-package extras matters:

- **Base** = common operations every service exposes (read, list, get, grade, accept, send — daily writes a user reaches for) plus the `run` escape hatch.
- **Sub-package extras** = service-specific authoring, admin, CRUD that's intentionally niche enough to keep out of the kitchen-sink bundle.

When adding a tool, ask: does a user opening the all-services base package want this exposed by default? Yes → base. No → extras.

## Adding tools to a sub-package

1. Register in `packages/<pkg>/src/tools/<service>-extra.ts`.
2. Add a test in `packages/<pkg>/tests/tools/<service>-extra.test.ts` using the shared harness:
   ```ts
   import { setupHandlers, toText, type ToolHandler }
     from '../../../gogcli-mcp/tests/helpers/test-harness.js';
   ```
3. Import `accountParam` / `runOrDiagnose` from `../../../gogcli-mcp/src/lib.js`.
4. Inline `if (flag) args.push(\`--flag=\${val}\`)` — no helpers.
5. Use `z.enum([...])` for closed-set CLI flags (states, types, roles), not `z.string()` with values in `.describe()`.
6. Annotations: `readOnlyHint: true` for reads; `destructiveHint: true` for deletes/overwrites/grades/run-escape-hatches. Leave creates and restorative ops unannotated.
7. Gated deletes need `--force`: if the `gog` subcommand prompts for confirmation, append `--force` to the args — the runner always injects `--no-input`, so without it gog refuses (`refusing to delete … without --force (non-interactive)`). Not every delete is gated; confirm against a real `gog` (the mocked tests can't catch a missing `--force`). See [Gotchas](#gotchas).
8. Add the new tool to the sub-package's `manifest.json`.

## Adding a new Google service to base

1. Create `packages/gogcli-mcp/src/tools/<service>.ts` exporting `registerXxxTools(server: McpServer)`.
2. Add tests in `packages/gogcli-mcp/tests/tools/<service>.test.ts`.
3. Wire it in `packages/gogcli-mcp/src/server.ts` (`createBaseServer`) and re-export from `src/lib.ts`.
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

<!-- pr-workflow:v2 -->
## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review *and* skip auto-generated release notes — GitHub's `generate_release_notes` (configured in `.github/release.yml`) only picks up merged PRs. Push directly to `main` only when the user explicitly asks for it (e.g. emergency hotfix).

For every PR, apply exactly one label so it lands in the right release-notes section:

| Label                | Section in release notes |
|----------------------|--------------------------|
| `gogcli-bump`        | ⚠️ Required gogcli version (raises `MIN_GOG_VERSION`) |
| `enhancement`        | Features                 |
| `bug`                | Bug Fixes                |
| `security`           | Security                 |
| `refactor`           | Refactor                 |
| `documentation`      | Documentation            |
| `test`               | Tests                    |
| `dependencies`       | Dependencies             |
| `ci` / `github_actions` | CI & Build            |
| *(none / unmatched)* | Other Changes            |
| `ignore-for-release` | Hidden from notes        |

**The PR title MUST be a Conventional Commit** (`fix(security): refuse stale refresh tokens`, `feat(sheets): add dry-run write guard`), not internal shorthand (`auth tweaks`). This matters twice over:

1. **release-please reads the PR title.** Because the repo squash-merges only (see [How PRs merge](#how-prs-merge)), the PR title *becomes the squash commit's subject line* — and that subject is the only thing release-please parses to decide the version bump and CHANGELOG section. A title without a `feat:`/`fix:`/`docs:`/etc. type is invisible to release-please: it bumps nothing, adds no changelog entry, and the change never gets published. Conventional prefixes in *individual commit messages* don't help — squash discards them; only the PR title survives.
2. **It's also the GitHub release-notes bullet** (`generate_release_notes`), sectioned by the label above. A clean, user-facing conventional title reads fine in both places.

So: put the conventional type in the **title**, keep it user-facing, and apply the matching label.

### How PRs merge

**Don't run `gh pr merge` yourself.** The automation does it:

1. `pr-auto-review.yml` runs a Claude review on every PR **except** the release-please release PR (which it deliberately skips). On a `pass` **or `warn`** verdict it adds the `ready-to-merge` label — nits (`warn`) ride along and don't block. A `fail` (🔴 important findings) is the only verdict that blocks auto-merge.
2. `auto-merge.yml`, on the `ready-to-merge` label (or on a dependabot PR), arms `gh pr merge --auto --squash`. The moment CI is green the PR squash-merges itself.

For ordinary feature/fix PRs, opening with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a release-notes line) is the whole job. Only a `fail` verdict needs a manual override to ship — add the label yourself after addressing or accepting the findings: `gh pr edit <num> --add-label ready-to-merge`.

### Auto-review follow-up issues

When a PR's auto-review verdict is `warn` or `fail`, the pipeline opens or updates a single `auto-review-followup` issue ("Auto-review follow-ups for PR #N") whose checklist captures every finding, and links it from the PR's `<!-- auto-review-verdict -->` comment (`📋 Tracking follow-ups: #N`). `warn` (nits only) still auto-merges — the issue carries the nits forward — so most nits are fixed in a *later* PR, not the original; `fail` blocks until the important findings are addressed on the PR itself.

When asked to address the auto-review comments / review findings on a PR:

1. Read the verdict comment, open the linked `auto-review-followup` issue, and treat its checklist as the work list (alongside any inline review comments).
2. Resolve each item, checking off only what you've **verified** is genuinely fixed.
3. If every item is resolved on the current PR, add `Closes #<issue>` to that PR's body so the merge closes it; if some are deferred, check off only the resolved ones and leave the issue open.
4. For nits whose `warn` PR already auto-merged, address them in a follow-up PR that references `Closes #<issue>`.

(This mirrors the fleet-wide convention in `~/.claude/CLAUDE.md`.)

### PR timing — only open when the feature is done

Because PRs auto-merge as soon as auto-review passes, **do not open a PR until the feature is genuinely complete**. There's no draft-PR safety net here:

- Don't open a PR to "stage" work while live verification, follow-up fixes, or final passes are still pending — by the time you finish those, the half-baked PR may already be in `main`.
- Push commits to the branch first; only run `gh pr create` once tests pass, live verification (if applicable) is green, and you'd be comfortable with the change shipping as-is.
- If follow-ups land after a PR is already open, they need to land on the same branch *before* auto-review flips to `pass`. Once the PR squash-merges, late commits orphan onto a stale branch and become their own follow-up PR.
- If you genuinely need a checkpoint review without shipping, open the PR as a GitHub draft (`gh pr create --draft …`) — auto-review skips drafts. Mark it ready-for-review only when the feature is truly done.

**Release PRs are the one manual touch.** release-please opens its own release PR and leaves it open as your staging artifact — `pr-auto-review.yml` skips it on purpose, so it sits there accumulating changes until you decide to ship. When you're ready, add `ready-to-merge` to it the same way: `gh pr edit <num> --add-label ready-to-merge`. The `auto-merge.yml` arm then takes over and the publish job fires the moment the release PR lands.

The repo allows squash-merge only — `--merge` and `--rebase` are blocked at the branch-protection ruleset level.

## gogcli notes

- `gog schema --json` outputs the machine-readable command/flag schema for every subcommand — use it to look up flags before adding new tools.
- `gog sheets update` / `gog sheets append` accept `--values-json=<JSON 2D array>` for structured input.
- All commands take `--account <email>` for multi-account targeting.
- `--no-input` suppresses interactive prompts; `--json` ensures parseable output; `--color=never` strips ANSI codes. The runner always sets all three.

## Gotchas

- **ESM + NodeNext**: imports must use `.js` extensions even for `.ts` source (e.g. `import { run } from './runner.js'`).
- **Sub-packages bundle base source directly**: each sub-package's `tsconfig.json` includes `../gogcli-mcp/src/**/*` and esbuild inlines it. Don't try to import from the published `gogcli-mcp/lib` path inside the workspace.
- **`createServer` vs `createBaseServer`**: sub-packages use `createServer()` (empty server) and register only what they need. Only the base bin uses `createBaseServer()`.
- **stdio transport**: stdout is reserved for JSON-RPC — never `console.log` from request handlers. Log to stderr.
- **Secrets in env**: `runner.ts` strips `GOG_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, and any var ending in `_TOKEN`/`_SECRET`/`_API_KEY`/`_PRIVATE_KEY` before spawning `gog`. Adding new ambient credentials? Audit the regex.
- **PATH augmentation**: desktop MCP clients spawn with a stripped PATH; the runner re-adds `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/go/bin`. If `gog` lives elsewhere, set `GOG_PATH`.
- **Coverage gate**: 100% on `src/**` (excluding each package's `src/index.ts`). New code without tests fails CI.
- **`--force` on gated destructive commands**: gog gates MOST destructive commands behind a confirmation, and the runner always injects `--no-input`, so without `--force` they fail at runtime with `refusing to … without --force (non-interactive)`. Assume a new delete/remove/clear-style subcommand is gated unless proven otherwise — the authoritative check is `confirmDestructive`/`dryRunAndConfirmDestructive` call sites in gogcli's `internal/cmd/`, or probe live with fake IDs: `gog <cmd> fakeid --no-input` (the gate fires before any API call — but beware commands that resolve names via the API *first*; those show an API error on fake IDs even when gated, e.g. `sheets delete-tab`, `gmail labels delete`). Conventions: append `--force` as the LAST arg; conditional gates get a conditional push (`drive share` only for `to=anyone`, `api call` only with `allowWrite`, `gmail filters create` only with `forward`, `docs insert-image`/`replace-image` only with a local `file`, `contacts dedupe` only with `apply`). Exception: `gog_gmail_drafts_delete` and `gog_gmail_batch_delete` deliberately expose `force` as a tool param instead of auto-appending — permanent deletions that bypass Trash keep the extra friction. Known non-gated (leave alone): `docs table-row/column delete`, `docs named-range delete`, `docs delete`, `docs clear`, `sheets named-ranges delete`, `sheets clear`, `sheets validation clear`, `classroom courses archive`, `gmail batch trash`. The mocked unit tests only assert the arg array, so a missing `--force` passes CI but breaks live.
- **Plugin assets**: `.claude-plugin/{plugin,marketplace}.json`, `manifest.json`, `server.json`, `SKILL.md` are distribution artifacts — they're not part of the runtime but their versions are synced at release time. Don't bump them by hand.
