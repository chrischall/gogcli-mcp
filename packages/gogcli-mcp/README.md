# gogcli-mcp

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Base [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude access to Google Workspace via [gogcli](https://github.com/openclaw/gogcli). Includes 116 tools across 13 services: Sheets, Docs, Gmail, Calendar, Drive, Slides, Classroom, Chat, Apps Script, Tasks, Contacts, the generic Discovery API escape hatch, and Auth — plus hosted file uploads.

For extended Sheets or Docs support, see [gogcli-mcp-sheets](https://www.npmjs.com/package/gogcli-mcp-sheets) and [gogcli-mcp-docs](https://www.npmjs.com/package/gogcli-mcp-docs).

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated
- Node.js 22+

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

## Tools (116)

| Service | Tools | Includes |
|---------|-------|----------|
| **Sheets** | 8 | get, update, append, clear, metadata, create, find-replace, run |
| **Docs** | 7 | info, cat, create, write, find-replace, structure, run |
| **Gmail** | 6 | search, get, send, reply, reply-all, run |
| **Calendar** | 7 | events, get, create, update, delete, respond, run |
| **Drive** | 11 | ls, search, get, mkdir, rename, move, delete, share, extract-text, read-bytes, run |
| **Slides** | 7 | export, info, create, copy, list-slides, read-slide, run |
| **Classroom** | 25 | courses, students, teachers, roster, coursework, submissions (grade/return/turn-in/reclaim), announcements, topics, invitations, profile, run |
| **Chat** | 13 | spaces list/find/create, threads list, messages list/search/send, dm send/space, reactions list/create/delete, run |
| **Apps Script** | 8 | get, content, pull, create, deployments, versions, run-function, run |
| **Tasks** | 7 | lists, list, get, add, done, delete, run |
| **Contacts** | 5 | search, list, get, create, run |
| **API** | 3 | list, describe, call |
| **Auth** | 8 | list, status, health, services, add, add-url, add-complete, run |
| **Upload** | 1 | slots — signed upload URLs so a hosted caller can hand over a file (see [Hosted file uploads](#hosted-file-uploads)) |

All tools accept an optional `account` parameter to target a specific Google account.

## Hosted file uploads

On a hosted deployment (mcp-host) the server shares no filesystem with you, so a
path like `attach`, `localPath`, `file` or `image` names a file on the *server*
and is refused with an explanation. To hand the server a file you hold:

1. Call `gog_upload_slots` with `files: [{ filename: "photo.jpg" }]` (up to 10).
   It returns one signed upload slot per file, each with a ready `curl` command.
2. `PUT` each file to its `uploadUrl` (the `Content-Type` must be the slot's
   `mimeType`; the URL expires after 30 minutes).
3. Pass the slots' `blobKeys` to the tool that takes the file.

Each file is held to 25 MiB. It is deleted from the upload store once that call
succeeds, and kept if the call fails so a retry can reuse the same keys. On a
gated send (`gog_gmail_send`, `gog_gmail_reply`, `gog_gmail_reply_all`,
`gog_chat_messages_send`) the confirmation preview reads the file without
deleting it and binds its SHA-256, so a file re-uploaded between the preview and
the approval is refused rather than sent unseen.

`blobKeys` is accepted by `gog_gmail_send`, `gog_gmail_reply`,
`gog_gmail_reply_all` and `gog_chat_messages_send` here, and by the Gmail drafts
tools and `gog_gmail_import` (gogcli-mcp-gmail), `gog_drive_upload`
(gogcli-mcp-drive), the Slides image tools (gogcli-mcp-slides) and the Docs image
tools (gogcli-mcp-docs). For a small file, `attachInline` (base64 in the call, up
to 8 MiB) still works on any deployment. On a local install `gog_upload_slots`
refuses: pass a path instead.

## License

MIT
