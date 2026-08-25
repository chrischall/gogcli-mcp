# gogcli-mcp

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Base [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude access to Google Workspace via [gogcli](https://github.com/openclaw/gogcli). Includes 112 tools across 13 services: Sheets, Docs, Gmail, Calendar, Drive, Slides, Classroom, Chat, Apps Script, Tasks, Contacts, the generic Discovery API escape hatch, and Auth.

For extended Sheets or Docs support, see [gogcli-mcp-sheets](https://www.npmjs.com/package/gogcli-mcp-sheets) and [gogcli-mcp-docs](https://www.npmjs.com/package/gogcli-mcp-docs).

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated
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
| **Drive** | 11 | ls, search, get, mkdir, rename, move, delete, share, extract-text, read-bytes, run |
| **Slides** | 7 | export, info, create, copy, list-slides, read-slide, run |
| **Classroom** | 25 | courses, students, teachers, roster, coursework, submissions (grade/return/turn-in/reclaim), announcements, topics, invitations, profile, run |
| **Chat** | 12 | spaces list/find/create, threads list, messages list/send, dm send/space, reactions list/create/delete, run |
| **Apps Script** | 8 | get, content, pull, create, deployments, versions, run-function, run |
| **Tasks** | 7 | lists, list, get, add, done, delete, run |
| **Contacts** | 5 | search, list, get, create, run |
| **API** | 3 | list, describe, call |
| **Auth** | 8 | list, status, health, services, add, add-url, add-complete, run |

All tools accept an optional `account` parameter to target a specific Google account.

## License

MIT
