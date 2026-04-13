# gogcli-mcp

A monorepo of [Model Context Protocol](https://modelcontextprotocol.io) servers that give Claude natural-language access to Google Workspace via [gogcli](https://github.com/steipete/gogcli).

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by Claude. Review all code and tool permissions before use.

## Packages

| Package | Tools | Description |
|---------|-------|-------------|
| [gogcli-mcp](packages/gogcli-mcp) | 53 | Base — Sheets, Docs, Gmail, Calendar, Drive, Tasks, Contacts, Auth |
| [gogcli-mcp-sheets](packages/gogcli-mcp-sheets) | 75 | Base + 22 extra Sheets tools (tabs, formatting, named ranges, etc.) |
| [gogcli-mcp-docs](packages/gogcli-mcp-docs) | 67 | Base + 14 extra Docs tools (insert, export, sed, comments, etc.) |

Each package is a **standalone** MCP server. Install whichever one fits your needs — you don't need to install more than one.

## Quick Start

```bash
# Install gogcli
brew install gogcli
gog auth add your@gmail.com

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
