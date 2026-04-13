# gogcli-mcp Design Spec

**Date:** 2026-04-12
**Status:** Approved

## Overview

An MCP server that wraps the `gog` CLI (gogcli), exposing Google service operations as typed MCP tools. Sheets is implemented first; the architecture is scaffolded for easy addition of other services (Gmail, Calendar, Drive, etc.).

## Architecture

### Project Structure

```
gogcli-mcp/
├── src/
│   ├── index.ts          — MCP server entry point; registers all service tools
│   ├── runner.ts         — Core executor: spawns gog, handles auth & errors
│   └── tools/
│       └── sheets.ts     — Sheets curated tools + escape hatch
├── package.json
├── tsconfig.json
└── .mcp.json             — MCP server config for Claude Code
```

### Key Principle

No service tool file touches `child_process` directly. All execution goes through `runner.ts`. Adding a new service means creating `src/tools/<service>.ts` and registering it in `index.ts`.

## Components

### `runner.ts`

Exports a single `run(service, subcommand, args, options)` function:

- Prepends global flags: `--json`, `--no-input`, `--color=never`
- Injects `--account <email>` from `options.account` → `GOG_ACCOUNT` env var → omit
- Spawns `gog` as a child process, capturing stdout and stderr separately
- On exit code 0: returns parsed JSON (or raw stdout if not valid JSON)
- On non-zero exit: throws an error with stderr content as the message (gogcli stderr is human-readable)

### `src/tools/sheets.ts`

Exports `registerSheetsTools(server: McpServer)`. Implements:

| Tool | gog command | Notes |
|------|-------------|-------|
| `gog_sheets_get` | `gog sheets get <id> <range>` | Read-only hint |
| `gog_sheets_update` | `gog sheets update <id> <range> <values>` | Values as JSON array of arrays |
| `gog_sheets_append` | `gog sheets append <id> <range> <values>` | Values as JSON array of arrays |
| `gog_sheets_clear` | `gog sheets clear <id> <range>` | Destructive hint |
| `gog_sheets_metadata` | `gog sheets metadata <id>` | Returns tabs, named ranges, etc. |
| `gog_sheets_create` | `gog sheets create <title>` | Returns new spreadsheet ID |
| `gog_sheets_find_replace` | `gog sheets find-replace <id> <find> <replace>` | |
| `gog_sheets_run` | `gog sheets <subcommand> [args...]` | Escape hatch for any other sheets op |

All tools accept an optional `account` string parameter to override the default account.

### `src/index.ts`

Creates the `McpServer`, calls `registerSheetsTools(server)` (and future service registrations), connects via `StdioServerTransport`.

### `.mcp.json`

Documents `GOG_ACCOUNT` as the environment variable for the default Google account. Used by Claude Code to configure the server.

## Auth Flow

Account resolution order (most specific wins):

1. Tool-level `account` parameter (per-call override)
2. `GOG_ACCOUNT` environment variable (session default)
3. No `--account` flag (gogcli uses its own configured default)

## Error Handling

- Runner captures stdout and stderr as separate streams
- Non-zero exit: throw `Error(stderr)` — gogcli error messages are already user-readable
- The MCP tool catches the error and returns it as text content so the model sees it

## Testing

- **Unit tests** (vitest): mock `child_process.spawn` to assert correct argument construction for each tool without executing gogcli
- **No integration tests**: real-world validation is done by running the server against live gogcli

## Adding Future Services

To add a new service (e.g., Gmail):

1. Create `src/tools/gmail.ts` with `registerGmailTools(server)`
2. Implement curated tools for common operations + a `gog_gmail_run` escape hatch
3. Import and call `registerGmailTools(server)` in `src/index.ts`
4. No changes to `runner.ts` required

## Stack

- **Language:** TypeScript (ES2022, NodeNext modules)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Schema validation:** Zod
- **Build:** esbuild (single bundled output)
- **Tests:** vitest
- **Pattern:** Mirrors ofw-mcp structure
