# gogcli-mcp-docs

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Extended Google Docs [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/openclaw/gogcli). Includes auth tools plus 18 additional dedicated Docs tools for editing, exporting, comments, and more.

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated
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

## Extra Docs Tools (18)

Plus 5 auth tools and 7 base Docs tools (info, cat, create, write, find-replace, structure, run).

| Tool | Description |
|------|-------------|
| `gog_docs_append` | Append text or markdown to the end of a doc |
| `gog_docs_copy` | Copy a document |
| `gog_docs_delete` | Delete content by character index range |
| `gog_docs_edit` | Find and replace with case-sensitivity control |
| `gog_docs_export` | Export as PDF, TXT, HTML, DOCX, RTF, ODT, or EPUB |
| `gog_docs_format` | Apply character / paragraph formatting (bold, color, alignment, …) |
| `gog_docs_insert` | Insert text at a specific position |
| `gog_docs_list_tabs` | List all document tabs |
| `gog_docs_read` | Read doc as plain text or raw JSON |
| `gog_docs_sed` | Stream-edit with sed-like regex expressions |
| `gog_docs_trash` | Move a doc to Drive trash |
| `gog_docs_update` | Update document content at a specific position |
| `gog_docs_comments_list` | List comments (open or resolved) |
| `gog_docs_comments_get` | Get a comment with its replies |
| `gog_docs_comments_add` | Add a comment with optional quoted text |
| `gog_docs_comments_reply` | Reply to a comment |
| `gog_docs_comments_resolve` | Resolve a comment |
| `gog_docs_comments_delete` | Delete a comment |

## Known limitations: `gog_docs_append` with `markdown: true`

These bugs live in gogcli's upstream markdown → Docs converter; the wrapper just passes `--markdown` through. Tracked upstream:

| Symptom | Workaround | Upstream |
|---------|-----------|----------|
| 3+ tables in one call reorders the trailing punctuation of the paragraph before the 3rd table | Split into multiple calls with ≤2 tables each | [openclaw/gogcli#607](https://github.com/openclaw/gogcli/issues/607) |
| Inline `**bold**` / `*italic*` / `` `code` `` inside table cells renders as literal characters | Insert plain cell text, then apply formatting via `gog_docs_format` | [openclaw/gogcli#608](https://github.com/openclaw/gogcli/issues/608) |
| Tables with an empty header row leak the last data row as literal pipe text | Always supply a non-empty header row | [openclaw/gogcli#609](https://github.com/openclaw/gogcli/issues/609) |

## License

MIT
