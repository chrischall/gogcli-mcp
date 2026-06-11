[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/chrischall-gogcli-mcp-badge.png)](https://mseep.ai/app/chrischall-gogcli-mcp)

# gogcli-mcp

A monorepo of [Model Context Protocol](https://modelcontextprotocol.io) servers that give Claude natural-language access to Google Workspace via [gogcli](https://github.com/openclaw/gogcli).

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

### Acknowledgement of Terms

By using this MCP server, you acknowledge and agree to the following:

**1. This server accesses your own Google Workspace data via Google's official APIs** (Gmail, Calendar, Drive, Sheets, Docs, Contacts). Auth happens via OAuth, with your explicit consent at each scope. It does not — and cannot — access anyone else's Google account or shared content you don't have permission to read.

**2. [Google's APIs Terms of Service](https://developers.google.com/terms) govern your use of this server**, in addition to any [Google Workspace Acceptable Use Policy](https://workspace.google.com/terms/use_policy.html) your domain admin enforces. The clauses most relevant here:

> Google sets and enforces limits on your use of the APIs (e.g. limiting the number of API requests that you may make or the number of users you may serve), in our sole discretion.

And on credentials, which is the most-tripped-on clause for open-source projects:

> You will keep your credentials confidential and make reasonable efforts to prevent and discourage other API Clients from using your credentials. **Developer credentials may not be embedded in open source projects.**

You are agreeing to those terms — read by the maintainer 2026-05-23 — every time you invoke a tool in this server.

**3. You must configure your own OAuth client.** This MCP does **not** ship an embedded `client_secret.json`. You register your own OAuth client at https://console.cloud.google.com/, scope it to your own user/project, and authorize it for the Workspace APIs you want to use. Do not check `client_secret.json`, `credentials.json`, or any refresh tokens into git — these are credentials and Google's ToS explicitly prohibits embedding them in OSS.

**4. Personal, single-user use only.** This project is not affiliated with, endorsed by, sponsored by, or in partnership with Google LLC. It is a personal automation tool for one Google account holder to read and write their own Workspace content. Do not use it to bulk-extract Workspace data from your org, automate against other users' accounts, or build a multi-tenant SaaS on top of it. If you want to do those things, you need a verified app, a domain-wide-delegation service account, and a Workspace admin's blessing — none of which this MCP provides.

**5. Your domain admin's policy may add restrictions.** If you're using a corporate Google Workspace account, your admin may restrict third-party OAuth apps, prohibit data exfiltration, or require app verification. **Check with your IT admin** before authorizing this MCP against a corporate domain.

**6. You accept full responsibility** for any consequences of using this server in connection with your Google account — quota exhaustion (Gmail and Drive APIs have aggressive per-user quotas), token revocation, account warnings, your domain admin emailing you, or any enforcement action. If Google or your domain admin objects to your use, stop using this server.

This section is the maintainer's good-faith summary of the terms — it is not legal advice and does not modify or supersede Google's actual APIs ToS or your domain's policies.

## Install gogcli

[gogcli](https://github.com/openclaw/gogcli) is the CLI that these MCP servers wrap. Install it for your platform:

**macOS (Homebrew):**
```bash
brew install steipete/tap/gogcli
```

**macOS / Linux (binary):**
```bash
curl -fsSL https://github.com/openclaw/gogcli/releases/latest/download/gog-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') -o /usr/local/bin/gog
chmod +x /usr/local/bin/gog
```

**Windows (Scoop):**
```powershell
scoop bucket add steipete https://github.com/steipete/scoop-bucket
scoop install gogcli
```

**Windows (manual):**

Download `gog-windows-amd64.exe` from the [latest release](https://github.com/openclaw/gogcli/releases/latest), rename to `gog.exe`, and add to your PATH.

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
