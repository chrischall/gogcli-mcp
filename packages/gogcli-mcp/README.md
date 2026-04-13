# gogcli-mcp

Base [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude access to Google Workspace via [gogcli](https://github.com/steipete/gogcli). Includes 52 tools across 8 services: Sheets, Docs, Gmail, Calendar, Drive, Tasks, Contacts, and Auth.

For extended Sheets or Docs support, see [gogcli-mcp-sheets](https://www.npmjs.com/package/gogcli-mcp-sheets) and [gogcli-mcp-docs](https://www.npmjs.com/package/gogcli-mcp-docs).

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com
```

## Installation

```bash
npm install -g gogcli-mcp
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

### Claude Code

```bash
claude mcp add gogcli-mcp -- gogcli-mcp
```

## Tools (52)

| Service | Tools | Includes |
|---------|-------|----------|
| **Sheets** | 8 | get, update, append, clear, metadata, create, find-replace, run |
| **Docs** | 7 | info, cat, create, write, find-replace, structure, run |
| **Gmail** | 4 | search, get, send, run |
| **Calendar** | 7 | events, get, create, update, delete, respond, run |
| **Drive** | 9 | ls, search, get, mkdir, rename, move, delete, share, run |
| **Tasks** | 7 | lists, list, get, add, done, delete, run |
| **Contacts** | 5 | search, list, get, create, run |
| **Auth** | 5 | list, status, services, add, run |

All tools accept an optional `account` parameter to target a specific Google account.

## License

MIT
