# gogcli-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude natural-language access to Google Sheets (and more) via [gogcli](https://github.com/steipete/gogcli).

> [!WARNING]
> **AI-developed project.** This codebase was entirely built and is actively maintained by [Claude Sonnet 4.6](https://www.anthropic.com/claude). No human has audited the implementation. Review all code and tool permissions before use.

## What you can do

Ask Claude things like:

- *"Read the data in Sheet1!A1:D20 of my budget spreadsheet"*
- *"Append this week's expenses to my tracking sheet"*
- *"Create a new spreadsheet called Q2 Planning"*
- *"Find all instances of 'TBD' in my project sheet and replace with 'Done'"*
- *"What tabs are in spreadsheet ID xyz?"*

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated (`gog --help` works)
- [Claude Desktop](https://claude.ai/download) or [Claude Code](https://claude.ai/code)
- Node.js 18 or later

Install gogcli via Homebrew:

```bash
brew install gogcli
```

Then authenticate:

```bash
gog auth add
```

## Installation

### 1. Clone and build

```bash
git clone https://github.com/chrischall/gogcli-mcp.git
cd gogcli-mcp
npm install
npm run build
```

### 2. Add to Claude Desktop

Edit your Claude Desktop config file:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `gogcli` entry inside `"mcpServers"`:

```json
{
  "mcpServers": {
    "gogcli": {
      "command": "node",
      "args": ["/absolute/path/to/gogcli-mcp/dist/index.js"],
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

Replace `/absolute/path/to/gogcli-mcp` with the actual path. On Mac, run `pwd` inside the cloned directory to get it.

`GOG_ACCOUNT` is optional — omit it to use gogcli's configured default account.

### 3. Add to Claude Code

The repo includes `.mcp.json`. From the project directory:

```bash
# The .mcp.json is already configured — just set your account
export GOG_ACCOUNT=you@gmail.com
```

Or add `GOG_ACCOUNT` to your shell profile.

## Tools

Read-only tools run automatically. Write tools ask for confirmation first.

| Tool | What it does | Permission |
|------|-------------|------------|
| `gog_sheets_get` | Read values from a range | Auto |
| `gog_sheets_metadata` | Get title, tabs, and named ranges | Auto |
| `gog_sheets_update` | Write values to a range | Confirm |
| `gog_sheets_append` | Append rows after existing data | Confirm |
| `gog_sheets_clear` | Clear values in a range | Confirm |
| `gog_sheets_create` | Create a new spreadsheet | Confirm |
| `gog_sheets_find_replace` | Find and replace across a spreadsheet | Confirm |
| `gog_sheets_run` | Run any `gog sheets` subcommand (escape hatch) | Confirm |

All tools accept an optional `account` parameter to target a specific Google account for that call, overriding `GOG_ACCOUNT`.

## Multiple Accounts

If you use multiple Google accounts with gogcli, you can target a specific account per-call:

```
Read Sheet1!A1:D10 from spreadsheet abc123 using my work account work@company.com
```

Claude will pass `account: "work@company.com"` to the tool, which adds `--account work@company.com` to the gogcli command.

## Troubleshooting

**"gog not found"** — gogcli is not installed or not in your PATH. Run `gog --help` in your terminal to verify. Install with `brew install gogcli`.

**"not authenticated"** — run `gog auth add` to authenticate. Run `gog auth list` to see configured accounts.

**"Spreadsheet not found"** — verify the spreadsheet ID (the long string in the URL between `/d/` and `/edit`).

**Tools not appearing in Claude Desktop** — go to **Settings → Developer** to see connected servers. Fully quit and relaunch after editing the config.

**Can't find the config file on Mac** — in Finder press Cmd+Shift+G and paste `~/Library/Application Support/Claude/`.

## Security

- `GOG_ACCOUNT` is optional and only selects which authenticated account to use
- No credentials are stored or passed by this server — authentication is handled entirely by gogcli's own keyring
- All gogcli invocations use `--no-input` to prevent interactive prompts
- All arguments are passed as arrays to `child_process.spawn` — no shell injection risk

## Development

```bash
npm test                # run the test suite (33 tests, 100% coverage)
npm run build           # compile TypeScript → dist/index.js
npm run test:coverage   # run with coverage report
```

### Project structure

```
src/
  runner.ts       gog CLI executor (auth injection, timeout, error handling)
  index.ts        MCP server entry point
  tools/
    sheets.ts     8 Google Sheets tools
tests/
  runner.test.ts
  tools/
    sheets.test.ts
```

### Adding more Google services

gogcli supports Gmail, Calendar, Drive, Contacts, Tasks, Docs, Slides, Chat, and more. To add a service:

1. Create `src/tools/<service>.ts` with `registerXxxTools(server: McpServer)`
2. Create `tests/tools/<service>.test.ts` (mock runner via `vi.mock`)
3. Call `registerXxxTools(server)` in `src/index.ts`

See `CLAUDE.md` for the full pattern.

## License

MIT
