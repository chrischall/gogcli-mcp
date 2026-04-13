# gogcli-mcp-docs

Extended Google Docs [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/steipete/gogcli). Includes auth tools plus 14 additional dedicated Docs tools for editing, exporting, comments, and more.

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com --services docs,drive
```

## Installation

```bash
npm install -g gogcli-mcp-docs
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-docs": {
      "command": "gogcli-mcp-docs",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-docs -- gogcli-mcp-docs
```

## Extra Docs Tools (14)

Plus 5 auth tools and 7 base Docs tools (info, cat, create, write, find-replace, structure, run).

| Tool | Description |
|------|-------------|
| `gog_docs_copy` | Copy a document |
| `gog_docs_delete` | Delete content by character index range |
| `gog_docs_edit` | Find and replace with case-sensitivity control |
| `gog_docs_export` | Export as PDF, TXT, HTML, DOCX, RTF, ODT, or EPUB |
| `gog_docs_insert` | Insert text at a specific position |
| `gog_docs_list_tabs` | List all document tabs |
| `gog_docs_sed` | Stream-edit with sed-like regex expressions |
| `gog_docs_update` | Update document content at a specific position |
| `gog_docs_comments_list` | List comments (open or resolved) |
| `gog_docs_comments_get` | Get a comment with its replies |
| `gog_docs_comments_add` | Add a comment with optional quoted text |
| `gog_docs_comments_reply` | Reply to a comment |
| `gog_docs_comments_resolve` | Resolve a comment |
| `gog_docs_comments_delete` | Delete a comment |

## License

MIT
