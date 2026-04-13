---
name: gogcli-mcp-docs
description: Use when the user asks to read, write, edit, export, or comment on Google Docs. Triggers for requests involving document editing, inserting text, exporting as PDF/HTML/DOCX, sed-like find-replace, managing document tabs, or working with comments and replies. Also includes Gmail, Calendar, Drive, Sheets, Tasks, and Contacts tools.
---

# gogcli-mcp-docs

Extended Google Docs MCP server via [gogcli](https://github.com/steipete/gogcli) — includes all base tools (Gmail, Calendar, Drive, Sheets, Tasks, Contacts) plus 14 additional dedicated Docs tools.

- **Source:** [github.com/chrischall/gogcli-mcp](https://github.com/chrischall/gogcli-mcp)

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18 or later

## Setup

```json
{
  "mcpServers": {
    "gogcli-docs": {
      "command": "npx",
      "args": ["-y", "gogcli-mcp-docs"],
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

## Extra Docs Tools

| Tool | What it does |
|------|-------------|
| `gog_docs_copy` | Copy a document |
| `gog_docs_delete` | Delete content by character index range |
| `gog_docs_edit` | Find and replace with case-sensitivity |
| `gog_docs_export` | Export as PDF, TXT, HTML, DOCX, RTF |
| `gog_docs_insert` | Insert text at a specific position |
| `gog_docs_list_tabs` | List all document tabs |
| `gog_docs_sed` | Stream-edit with sed-like regex |
| `gog_docs_update` | Update content at a specific position |
| `gog_docs_comments_list` | List comments (open or resolved) |
| `gog_docs_comments_get` | Get a comment with replies |
| `gog_docs_comments_add` | Add a comment with optional quoted text |
| `gog_docs_comments_reply` | Reply to a comment |
| `gog_docs_comments_resolve` | Resolve a comment |
| `gog_docs_comments_delete` | Delete a comment |

These are in addition to the 52 base tools (Docs basics, Sheets, Gmail, Calendar, Drive, Tasks, Contacts, Auth).
