# gogcli-mcp

Monorepo of MCP servers wrapping [gogcli](https://github.com/steipete/gogcli) — provides Claude with read/write access to Google Sheets, Docs, Gmail, Calendar, Drive, and more.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `gogcli-mcp` | `packages/gogcli-mcp` | Common operations across every service — 84 tools (auth + read/grading subsets of gmail, calendar, classroom, drive, slides, tasks, contacts, basic sheets/docs) |
| `gogcli-mcp-sheets` | `packages/gogcli-mcp-sheets` | Focused — 35 tools: auth + Sheets (8 base + 22 extra: tabs, formatting, named ranges, etc.) |
| `gogcli-mcp-docs` | `packages/gogcli-mcp-docs` | Focused — 26 tools: auth + Docs (7 base + 14 extra: insert, delete, export, sed, comments, etc.) |
| `gogcli-mcp-drive` | `packages/gogcli-mcp-drive` | Focused — 27 tools: auth + Drive (9 base + 13 extra: upload, download, permissions, comments, shared drives, etc.) |
| `gogcli-mcp-slides` | `packages/gogcli-mcp-slides` | Focused — 18 tools: auth + Slides (7 base + 6 extra authoring tools: create-from-markdown/template, add/delete/replace slide, update notes) |
| `gogcli-mcp-classroom` | `packages/gogcli-mcp-classroom` | Focused — 49 tools: auth + Classroom (25 base read/grading + 19 extra CRUD/admin: course/coursework/topic/announcement/invitation create/update/delete, student/teacher add/remove) |
| `gogcli-mcp-gmail` | `packages/gogcli-mcp-gmail` | Focused — 32 tools: auth + Gmail (4 base + 23 extra: threads, labels, drafts, attachments, forward, autoreply, bulk operations) |
| `gogcli-mcp-contacts` | `packages/gogcli-mcp-contacts` | Focused — 15 tools: auth + Contacts (5 base + 5 extra People API: directory search, profiles, relations) |
| `gogcli-mcp-calendar` | `packages/gogcli-mcp-calendar` | Focused — 18 tools: auth + Calendar (7 base + 6 extra Meet space management: create, get, update, end, history, participants) |

Sub-packages are **focused** — each includes only auth + its service's tools. Base now holds the common subset every service exposes; each sub-package layers on its dedicated extras.

## Build & Test

```bash
npm run build        # build all packages (tsc --noEmit + esbuild)
npm test             # test all packages (vitest with 100% coverage)
npm run typecheck    # typecheck all packages

# Single package:
npm run build --workspace=packages/gogcli-mcp-sheets
npm test --workspace=packages/gogcli-mcp-docs
```

## Versioning

All packages share the same version. **Single source of truth:** root `package.json` → `"version"`. The build script (`scripts/bundle.js`) injects it into all bundles at build time via `--define:GOGCLI_VERSION`.

The tag-and-bump workflow syncs the version into each package's `package.json` and `manifest.json` automatically.

### Release workflow

Main is always one version ahead of the latest tag. To release:

```bash
gh workflow run tag-and-bump.yml --ref main
```

The action:
1. Runs CI (build + test all packages)
2. Tags: `v<version>` (e.g. `v1.0.6`)
3. Bumps patch in all packages' version files
4. Tag push triggers Release workflow (npm publish all packages + .mcpb + GitHub release)

Do NOT manually bump versions or create tags unless the user explicitly asks.

## Architecture

- `packages/gogcli-mcp/src/runner.ts` — only module touching `child_process`. Exports `run(args, options)` with `Spawner` DI for testing. Injects `--json --no-input --color=never`, strips `GOG_ACCESS_TOKEN`. 30-second default timeout.
- `packages/gogcli-mcp/src/server.ts` — `createBaseServer()` factory: creates `McpServer`, registers all base tools, returns the server for sub-packages to extend.
- `packages/gogcli-mcp/src/lib.ts` — barrel export for sub-packages: `createBaseServer`, `run`, `accountParam`, `runOrDiagnose`, `toText`, `toError`.
- `packages/gogcli-mcp/src/tools/*.ts` — each service registers tools via `registerXxxTools(server)`.
- Sub-packages import from `gogcli-mcp/lib`, call `createBaseServer()`, add their own tools, then connect transport.

## Tool placement

The split between **base** and **sub-package extras** matters:

- **Base** = common operations every service exposes (read, list, get, grade,
  accept, send, the everyday writes a user reaches for daily). Plus the `run`
  escape hatch so agents can still hit anything not wrapped.
- **Sub-package extras** = service-specific authoring, admin, CRUD that's
  intentionally niche enough to keep out of the kitchen-sink bundle.

When adding a tool, ask: does a user opening the "all services" base package
want this tool exposed by default? If yes → base. If no → extras.

## Adding Tools to a Sub-Package

1. Add the tool registration in `packages/<pkg>/src/tools/<service>-extra.ts`
2. Add a test in `packages/<pkg>/tests/tools/<service>-extra.test.ts` — use
   the shared harness:
   ```ts
   import { setupExtrasHandlers, toText, type ToolHandler }
     from '../../../gogcli-mcp/tests/helpers/extras-harness.js';
   ```
3. Import `accountParam` and `runOrDiagnose` from `gogcli-mcp/lib`
4. Follow the inline `if (flag) args.push(\`--flag=\${val}\`)` style — no helpers
5. Use `z.enum([...])` for closed-set CLI flags (states, types, roles), not
   `z.string()` with values stuffed into `.describe()`
6. Annotations: `readOnlyHint: true` for reads, `destructiveHint: true` for
   deletes/overwrites/grades/run-escape-hatches. Leave creates and restorative
   ops (e.g. unarchive) unannotated.
7. Update the sub-package's `manifest.json` with the new tool

## Adding a New Google Service to Base

1. Create `packages/gogcli-mcp/src/tools/<service>.ts` — export `registerXxxTools(server: McpServer)`
2. Add tests in `packages/gogcli-mcp/tests/tools/<service>.test.ts`
3. In `packages/gogcli-mcp/src/server.ts`, import and call `registerXxxTools(server)`
4. Add tools to `packages/gogcli-mcp/manifest.json`
5. Same annotation/enum/inline-style rules as the sub-package list above

## gogcli Notes

- `gog schema --json` outputs machine-readable command/flag schema for all subcommands
- `gog sheets update` and `gog sheets append` accept `--values-json=<JSON 2D array>` for structured input
- All commands support `--account <email>` for multi-account targeting
- `--no-input` prevents interactive prompts; `--json` ensures parseable output; `--color=never` strips ANSI codes

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

The **PR title** becomes the bullet — write it like a user-facing changelog entry, not internal shorthand. Conventional-commit prefixes are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.
