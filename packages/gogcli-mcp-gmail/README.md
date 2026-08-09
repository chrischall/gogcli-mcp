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

## Extra Gmail Tools (45)

Plus 8 auth tools and 4 base Gmail tools (search, get, send, run) — 57 in all.

### Read

| Tool | Description |
|------|-------------|
| `gog_gmail_raw` | Dump the raw Gmail API JSON for a message (lossless, for scripting) |
| `gog_gmail_attachment` | Download an attachment (by `attachmentIndex`, or the legacy opaque `attachmentId`) and deliver its contents — inline (base64 image/resource) when within the inline limit (3 MiB by default, `inlineMaxBytes`), otherwise uploaded to Google Drive with a shareable link (`deliver`: auto/inline/drive/off) |
| `gog_gmail_url` | Print Gmail web URLs for one or more threads |
| `gog_gmail_history` | List Gmail history events since a given historyId |
| `gog_gmail_messages_search` | Search individual messages rather than threads — one result per matching message |

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
| `gog_gmail_labels_style` | Change a user label's color or visibility |

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
| `gog_gmail_import` | Import an RFC822/EML message into the mailbox, keeping its original headers and date (does not send) |
| `gog_gmail_forward` | Forward a message to new recipients (with optional note) |
| `gog_gmail_reply` | Reply to a message (original sender only) |
| `gog_gmail_reply_all` | Reply to every participant (sender plus all To/Cc recipients) |
| `gog_gmail_autoreply` | Reply once to all messages matching a query (with dedupe label) |

### Settings

| Tool | Description |
|------|-------------|
| `gog_gmail_vacation_get` | Get the vacation responder (auto-reply) settings |
| `gog_gmail_vacation_update` | Enable or disable the vacation responder, with optional start/end and audience limits |
| `gog_gmail_filters_list` | List all Gmail filters |
| `gog_gmail_filters_get` | Get a filter's criteria and actions by ID |
| `gog_gmail_filters_create` | Create a filter from match criteria plus one or more actions |
| `gog_gmail_filters_delete` | Delete a filter by ID |
| `gog_gmail_sendas_list` | List all send-as aliases |
| `gog_gmail_sendas_get` | Get one send-as alias by address |
| `gog_gmail_sendas_create` | Create a send-as alias (usually needs verification before use) |
| `gog_gmail_sendas_update` | Update an alias (display name, reply-to, signature, default) |
| `gog_gmail_sendas_delete` | Delete a send-as alias |
| `gog_gmail_sendas_verify` | Resend the verification email for a pending alias |

Email tracking (`track`) and the remaining admin settings (`delegates`, `forwarding`, `watch`) have no dedicated tool — reach them through the base `gog_gmail_run` escape hatch.

## License

MIT
