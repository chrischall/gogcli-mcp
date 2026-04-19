# gogcli-mcp-drive

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Extended Google Drive [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/steipete/gogcli). Includes auth tools plus 13 additional dedicated Drive tools for upload/download, permissions, comments, shared drives, and more.

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com --services drive
```

## Installation

```bash
npm install -g gogcli-mcp-drive
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-drive": {
      "command": "gogcli-mcp-drive",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-drive -- gogcli-mcp-drive
```

## Extra Drive Tools (13)

Plus 5 auth tools and 9 base Drive tools (ls, search, get, mkdir, rename, move, delete, share, run). Base `gog_drive_delete` accepts `permanent=true` for irreversible deletes.

| Tool | Description |
|------|-------------|
| `gog_drive_download` | Download a file (exports Google Docs formats: pdf, docx, xlsx, etc.) |
| `gog_drive_upload` | Upload a local file, optionally replacing an existing file or converting to Google format |
| `gog_drive_copy` | Copy a file to a new file with the given name |
| `gog_drive_url` | Print shareable web URLs for one or more files |
| `gog_drive_permissions` | List permissions on a file |
| `gog_drive_unshare` | Remove a permission from a file |
| `gog_drive_drives_list` | List shared drives (Team Drives) |
| `gog_drive_comments_list` | List comments on a file |
| `gog_drive_comments_get` | Get a single comment by ID |
| `gog_drive_comments_add` | Add a new comment to a file |
| `gog_drive_comments_update` | Update a comment's text |
| `gog_drive_comments_delete` | Delete a comment |
| `gog_drive_comments_reply` | Reply to an existing comment |

## License

MIT
