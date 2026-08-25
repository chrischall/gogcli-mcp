---
name: gogcli-mcp
description: Use when the user asks to interact with Google Workspace services. Triggers for requests involving Google Sheets, Docs, Gmail, Calendar, Drive, Slides, Classroom, Chat, Apps Script, Tasks, or Contacts — such as "read my spreadsheet", "search my email", "create a calendar event", "list my drive files", or "add a contact". For extended Sheets or Docs support, see gogcli-mcp-sheets and gogcli-mcp-docs.
---

# gogcli-mcp

MCP server wrapping [gogcli](https://github.com/openclaw/gogcli) — provides Claude with access to Google Sheets, Docs, Gmail, Calendar, Drive, Slides, Classroom, Chat, Apps Script, Tasks, Contacts, and Auth.

- **Source:** [github.com/chrischall/gogcli-mcp](https://github.com/chrischall/gogcli-mcp)

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated
- Node.js 18 or later

## Setup

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

`GOG_ACCOUNT` is optional — omit it to use gogcli's configured default account.

## Tools (52)

| Service | Tools |
|---------|-------|
| **Sheets** (8) | get, update, append, clear, metadata, create, find-replace, run |
| **Docs** (7) | info, cat, create, write, find-replace, structure, run |
| **Gmail** (4) | search, get, send, run |
| **Calendar** (7) | events, get, create, update, delete, respond, run |
| **Drive** (11) | ls, search, get, mkdir, rename, move, delete, share, extract-text, read-bytes, run |
| **Slides** (7) | export, info, create, copy, list-slides, read-slide, run |
| **Classroom** (25) | courses, students, teachers, roster, coursework, submissions (grade/return/turn-in/reclaim), announcements, topics, invitations, profile, run |
| **Chat** (12) | spaces list/find/create, threads list, messages list/send, dm send/space, reactions list/create/delete, run |
| **Apps Script** (8) | get, content, pull, create, deployments, versions, run-function, run |
| **Tasks** (7) | lists, list, get, add, done, delete, run |
| **Contacts** (5) | search, list, get, create, run |
| **API** (3) | list, describe, call |
| **Auth** (8) | list, status, health, services, add, add-url, add-complete, run |

All tools accept an optional `account` parameter to override the default Google account for that call.
