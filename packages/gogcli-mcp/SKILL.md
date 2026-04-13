---
name: gogcli-mcp
description: Use when the user asks to read, write, or manage Google Sheets. Also triggers for requests involving Google Sheets data like "read my spreadsheet", "update a cell", "append rows", "create a spreadsheet", or "find and replace in Sheets". Broader Google service support (Gmail, Calendar, Drive) can be added via future service modules.
---

# gogcli-mcp

MCP server wrapping [gogcli](https://github.com/steipete/gogcli) — provides Claude with access to Google Sheets (and a scaffold for Gmail, Calendar, Drive, and more).

- **Source:** [github.com/chrischall/gogcli-mcp](https://github.com/chrischall/gogcli-mcp)

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated (`gog --help` works in your shell)
- Node.js 18 or later

## Setup

### Option A — Claude Code (direct MCP)

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "gogcli": {
      "command": "node",
      "args": ["/path/to/gogcli-mcp/dist/index.js"],
      "cwd": "/path/to/gogcli-mcp",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Option B — npx

```json
{
  "mcpServers": {
    "gogcli": {
      "command": "npx",
      "args": ["-y", "gogcli-mcp"],
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

`GOG_ACCOUNT` is optional — omit it to use gogcli's configured default account. Pass it per-tool-call to target a specific account dynamically.

## Available Tools

| Tool | What it does |
|------|-------------|
| `gog_sheets_get` | Read values from a range |
| `gog_sheets_update` | Write values to a range |
| `gog_sheets_append` | Append rows after existing data |
| `gog_sheets_clear` | Clear values in a range |
| `gog_sheets_metadata` | Get title, tabs, named ranges |
| `gog_sheets_create` | Create a new spreadsheet |
| `gog_sheets_find_replace` | Find and replace across a spreadsheet |
| `gog_sheets_run` | Run any `gog sheets` subcommand (escape hatch) |

All tools accept an optional `account` parameter to override the default Google account for that call.
