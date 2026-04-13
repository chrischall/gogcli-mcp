# gogcli-mcp

A monorepo of [Model Context Protocol](https://modelcontextprotocol.io) servers that give Claude natural-language access to Google Workspace via [gogcli](https://github.com/steipete/gogcli).

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by Claude. Review all code and tool permissions before use.

## Packages

| Package | Tools | Description |
|---------|-------|-------------|
| [gogcli-mcp](packages/gogcli-mcp) | 52 | All services — Sheets, Docs, Gmail, Calendar, Drive, Tasks, Contacts, Auth |
| [gogcli-mcp-sheets](packages/gogcli-mcp-sheets) | 35 | Auth + full Sheets (base + 22 extra: tabs, formatting, named ranges, etc.) |
| [gogcli-mcp-docs](packages/gogcli-mcp-docs) | 26 | Auth + full Docs (base + 14 extra: insert, export, sed, comments, etc.) |

Each package is a **standalone** MCP server. Install whichever one fits your needs — you don't need to install more than one.

## Prerequisites

### Install gogcli

[gogcli](https://github.com/steipete/gogcli) is the CLI that these MCP servers wrap. Install it for your platform:

**macOS (Homebrew):**
```bash
brew install steipete/tap/gogcli
```

**macOS / Linux (binary):**
```bash
curl -fsSL https://github.com/steipete/gogcli/releases/latest/download/gog-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') -o /usr/local/bin/gog
chmod +x /usr/local/bin/gog
```

**Windows (Scoop):**
```powershell
scoop bucket add steipete https://github.com/steipete/scoop-bucket
scoop install gogcli
```

**Windows (manual):**

Download `gog-windows-amd64.exe` from the [latest release](https://github.com/steipete/gogcli/releases/latest), rename to `gog.exe`, and add to your PATH.

### Authenticate

```bash
gog auth add your@gmail.com
```

This opens a browser for Google OAuth. For specific services only:

```bash
gog auth add your@gmail.com --services sheets,docs,drive
```

### Install Node.js

Node.js 18 or later is required. Install via [nodejs.org](https://nodejs.org) or:

```bash
brew install node        # macOS
```

## Quick Start

```bash
# Install the package you want
npm install -g gogcli-mcp          # base
npm install -g gogcli-mcp-sheets   # extended sheets
npm install -g gogcli-mcp-docs     # extended docs
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli": {
      "command": "gogcli-mcp",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

Replace `gogcli-mcp` with `gogcli-mcp-sheets` or `gogcli-mcp-docs` for extended packages.

### Claude Code

```bash
claude mcp add gogcli -- gogcli-mcp
```

## What you can do

Ask Claude things like:

- *"Read the data in Sheet1!A1:D20 of my budget spreadsheet"*
- *"Append this week's expenses to my tracking sheet"*
- *"Search my Gmail for invoices from last month"*
- *"Create a calendar event for tomorrow at 3pm"*
- *"List comments on my project doc"*
- *"Export my doc as a PDF"*

## Multiple Accounts

All tools accept an optional `account` parameter:

```
Read Sheet1!A1:D10 from spreadsheet abc123 using my work account work@company.com
```

## Development

```bash
npm install        # install all workspace dependencies
npm run build      # build all packages
npm test           # test all packages (267 tests, 100% coverage)
npm run typecheck  # typecheck all packages
```

## Security

- No credentials are stored or passed by these servers — authentication is handled by gogcli's keyring
- All gogcli invocations use `--no-input` to prevent interactive prompts
- All arguments are passed as arrays to `child_process.spawn` — no shell injection risk
- `GOG_ACCESS_TOKEN` is stripped from the child process environment to prevent stale token auth

## License

MIT
