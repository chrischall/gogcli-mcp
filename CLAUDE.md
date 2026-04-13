# gogcli-mcp

Monorepo of MCP servers wrapping [gogcli](https://github.com/steipete/gogcli) — provides Claude with read/write access to Google Sheets, Docs, Gmail, Calendar, Drive, and more.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `gogcli-mcp` | `packages/gogcli-mcp` | All services — 52 tools (auth, gmail, calendar, drive, tasks, contacts, basic sheets/docs) |
| `gogcli-mcp-sheets` | `packages/gogcli-mcp-sheets` | Focused — auth + 30 Sheets tools (base + 22 extra: tabs, formatting, named ranges, etc.) |
| `gogcli-mcp-docs` | `packages/gogcli-mcp-docs` | Focused — auth + 21 Docs tools (base + 14 extra: insert, delete, export, sed, comments, etc.) |

Sub-packages are **focused** — each includes only auth + its service's tools. Users who want everything use the base.

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

## Adding Tools to a Sub-Package

1. Add the tool registration in `packages/<pkg>/src/tools/<service>-extra.ts`
2. Add a test in `packages/<pkg>/tests/tools/<service>-extra.test.ts`
3. Import `accountParam` and `runOrDiagnose` from `gogcli-mcp/lib`
4. Follow the exact same pattern as existing tools

## Adding a New Google Service to Base

1. Create `packages/gogcli-mcp/src/tools/<service>.ts` — export `registerXxxTools(server: McpServer)`
2. Add tests in `packages/gogcli-mcp/tests/tools/<service>.test.ts`
3. In `packages/gogcli-mcp/src/server.ts`, import and call `registerXxxTools(server)`
4. Add tools to `packages/gogcli-mcp/manifest.json`

## gogcli Notes

- `gog schema --json` outputs machine-readable command/flag schema for all subcommands
- `gog sheets update` and `gog sheets append` accept `--values-json=<JSON 2D array>` for structured input
- All commands support `--account <email>` for multi-account targeting
- `--no-input` prevents interactive prompts; `--json` ensures parseable output; `--color=never` strips ANSI codes
