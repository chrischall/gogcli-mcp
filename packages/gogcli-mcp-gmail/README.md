# gogcli-mcp-gmail

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Extended Gmail [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/openclaw/gogcli). Includes auth tools plus 23 additional dedicated Gmail tools for threads, labels, drafts, attachments, forwarding, autoreply, and bulk operations.

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com --services gmail
```

## Installation

```bash
npm install -g gogcli-mcp-gmail
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-gmail": {
      "command": "gogcli-mcp-gmail",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-gmail -- gogcli-mcp-gmail
```

## Extra Gmail Tools (23)

Plus 5 auth tools and 4 base Gmail tools (search, get, send, run).

### Read

| Tool | Description |
|------|-------------|
| `gog_gmail_raw` | Dump the raw Gmail API JSON for a message (lossless, for scripting) |
| `gog_gmail_attachment` | Download an attachment and deliver its contents — inline (base64 image/resource) when ≤3 MiB, otherwise uploaded to Google Drive with a shareable link (`deliver`: auto/inline/drive/off) |
| `gog_gmail_url` | Print Gmail web URLs for one or more threads |
| `gog_gmail_history` | List Gmail history events since a given historyId |

### Threads

| Tool | Description |
|------|-------------|
| `gog_gmail_thread_get` | Get a thread with all messages, optionally with sanitized content and attachments |
| `gog_gmail_thread_modify` | Modify labels on all messages in a thread |
| `gog_gmail_thread_attachments` | List or download all attachments in a thread |

### Labels

| Tool | Description |
|------|-------------|
| `gog_gmail_labels_list` | List all labels |
| `gog_gmail_labels_get` | Get label details and counts |
| `gog_gmail_labels_create` | Create a new label |
| `gog_gmail_labels_rename` | Rename a label |
| `gog_gmail_labels_delete` | Delete a label |
| `gog_gmail_labels_modify` | Modify labels on one or more threads |

### Bulk Operations

| Tool | Description |
|------|-------------|
| `gog_gmail_archive` | Archive messages by ID or by query |
| `gog_gmail_mark_read` | Mark messages as read by ID or by query |
| `gog_gmail_mark_unread` | Mark messages as unread by ID or by query |
| `gog_gmail_trash` | Move messages to trash by ID or by query |
| `gog_gmail_message_modify` | Modify labels on a single message |
| `gog_gmail_batch_delete` | Permanently delete multiple messages (irreversible) |
| `gog_gmail_batch_modify` | Modify labels on multiple messages at once |

### Drafts

| Tool | Description |
|------|-------------|
| `gog_gmail_drafts_list` | List drafts |
| `gog_gmail_drafts_get` | Get a draft by ID |
| `gog_gmail_drafts_create` | Create a new draft |
| `gog_gmail_drafts_update` | Update an existing draft |
| `gog_gmail_drafts_delete` | Delete a draft |
| `gog_gmail_drafts_send` | Send an existing draft |

### Write

| Tool | Description |
|------|-------------|
| `gog_gmail_forward` | Forward a message to new recipients (with optional note) |
| `gog_gmail_autoreply` | Reply once to all messages matching a query (with dedupe label) |

Track and admin settings (`track`, `settings filters`, `delegates`, `forwarding`, `sendas`, `vacation`, `watch`) are available via the base `gog_gmail_run` escape hatch.

## License

MIT
