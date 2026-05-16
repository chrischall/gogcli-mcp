# gogcli-mcp

Monorepo of MCP servers wrapping [gogcli](https://github.com/steipete/gogcli) — gives Claude read/write access to Google Workspace (Sheets, Docs, Gmail, Calendar, Drive, Slides, Classroom, Tasks, Contacts). Each package is a standalone MCP server using stdio transport.

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
```

`runner.ts` treats unresolved `.mcpb` placeholders (`${user_config.xxx}`) and empty strings as unset — useful for desktop clients that pass blank user-config fields through literally.

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
7. Add the new tool to the sub-package's `manifest.json`.

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

Files that store the version (kept in sync automatically):

1. Root `package.json` + every `packages/*/package.json` (synced by `scripts/bump.js` via `npm version --workspaces`).
2. Every `packages/*/manifest.json` (synced by `scripts/bump.js`).
3. Every `packages/*/server.json` and `packages/*/.claude-plugin/{plugin,marketplace}.json` (synced inside the Release workflow at tag time).

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Versioning is handled by the **Tag & Bump** GitHub Action (`.github/workflows/tag-and-bump.yml`).

### Release workflow

Main is always one version ahead of the latest tag. To release:

```bash
gh workflow run tag-and-bump.yml --ref main
```

The action:
1. Runs CI (build + test on Node 22).
2. Tags the current commit `v<version>`.
3. `npm run bump` patches root + all workspaces + manifest.json files.
4. Commits, pushes main, then pushes the tag (requires `RELEASE_PAT`, not `GITHUB_TOKEN`, so the tag push triggers the next workflow).
5. The tag push triggers the **Release** workflow (`release.yml`): syncs versions across JSON files, builds `.mcpb` bundles, packages `.skill` files, publishes every package to npm via OIDC trusted publishing, publishes each `server.json` to the MCP Registry, publishes skills to ClawHub, and creates a GitHub Release with `scripts/changelog.js` output + `.mcpb`/`.skill` assets attached.

<!-- pr-workflow:v1 -->
## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review *and* skip auto-generated release notes — GitHub's `generate_release_notes` (configured in `.github/release.yml`) only picks up merged PRs. Push directly to `main` only when the user explicitly asks for it (e.g. emergency hotfix).

For every PR, apply exactly one label so it lands in the right release-notes section:

| Label                | Section in release notes |
|----------------------|--------------------------|
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

The **PR title** becomes the bullet — write it like a user-facing changelog entry (`ck_set_session: refuse stale refresh tokens`), not internal shorthand (`auth tweaks`). Conventional-commit prefixes (`feat:`, `fix:`, `chore:`) are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.

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
- **Plugin assets**: `.claude-plugin/{plugin,marketplace}.json`, `manifest.json`, `server.json`, `SKILL.md` are distribution artifacts — they're not part of the runtime but their versions are synced at release time. Don't bump them by hand.
