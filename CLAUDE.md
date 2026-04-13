# gogcli-mcp

MCP server wrapping [gogcli](https://github.com/steipete/gogcli) — provides Claude with read/write access to Google Sheets, with a scaffold for Gmail, Calendar, Drive, and more.

## Build & Test

```bash
npm run build        # tsc --noEmit (type check) + esbuild bundle → dist/index.js
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
npm run test:coverage  # vitest with 100% coverage enforcement
npm run typecheck    # tsc --noEmit only
```

## Versioning

Version appears in FOUR places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → run `npm install --package-lock-only` after changing package.json
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`

### Release workflow

Main is always one version ahead of the latest tag. To release, run the **Tag & Bump** GitHub Action (`tag-and-bump.yml`) which:

1. Runs CI (build + test)
2. Tags the current commit with the current version
3. Bumps patch in all four files
4. Rebuilds, commits, and pushes main + tag
5. The tag push triggers the **Release** workflow (CI + npm publish + .mcpb + .skill + GitHub release)

Do NOT manually bump versions or create tags unless the user explicitly asks. Always prefer the Tag & Bump action: `gh workflow run tag-and-bump.yml --ref main`. The action handles all four version files, tagging, and triggering the release.

## Architecture

- `src/runner.ts` — only module touching `child_process`. Exports `run(args, options)` with `Spawner` DI for testing. Injects `--json --no-input --color=never`, handles `--account` from `options.account` → `GOG_ACCOUNT` env var → omit. 30-second timeout kills stalled processes.
- `src/tools/sheets.ts` — registers 8 Sheets MCP tools via `registerSheetsTools(server)`. Imports `run()` from runner. Errors are caught and returned as text content so the model can read gogcli's error messages.
- `src/index.ts` — MCP server entry point. Creates `McpServer`, calls `registerXxxTools(server)` for each service, connects via `StdioServerTransport`.
- `tests/runner.test.ts` — unit tests for runner using mock `Spawner` DI (no real processes)
- `tests/tools/sheets.test.ts` — unit tests for sheets tools, runner mocked via `vi.mock`

## Adding a New Google Service

To add Gmail, Calendar, Drive, etc.:

1. Create `src/tools/<service>.ts` — export `registerXxxTools(server: McpServer)`
2. Implement curated tools for common ops + a `gog_<service>_run` escape hatch (see `sheets.ts` for the pattern)
3. Create `tests/tools/<service>.test.ts` — mock `runner.run` via `vi.mock('../../src/runner.js')`
4. In `src/index.ts`, import and call `registerXxxTools(server)`
5. Add tools to `manifest.json` tools list
6. No changes to `runner.ts` or `.mcp.json` required

## gogcli Notes

- `gog schema --json` outputs machine-readable command/flag schema for all subcommands
- `gog sheets update` and `gog sheets append` accept `--values-json=<JSON 2D array>` for structured input
- All commands support `--account <email>` for multi-account targeting
- `--no-input` prevents interactive prompts; `--json` ensures parseable output; `--color=never` strips ANSI codes
- `gog agent exit-codes` documents stable exit codes for automation
