# gogcli-mcp

[![CI](https://github.com/chrischall/gogcli-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/gogcli-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/gogcli-mcp)](https://www.npmjs.com/package/gogcli-mcp)
[![coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](packages/gogcli-mcp/vitest.config.ts)
[![license](https://img.shields.io/npm/l/gogcli-mcp)](https://www.npmjs.com/package/gogcli-mcp)

A monorepo of [Model Context Protocol](https://modelcontextprotocol.io) servers that give Claude natural-language access to Google Workspace via [gogcli](https://github.com/openclaw/gogcli).

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by Claude. Review all code and tool permissions before use.

## Packages

| Package | Tools | Description |
|---------|-------|-------------|
| [gogcli-mcp](packages/gogcli-mcp) | 52 | All services — Sheets, Docs, Gmail, Calendar, Drive, Tasks, Contacts, Auth |
| [gogcli-mcp-sheets](packages/gogcli-mcp-sheets) | 35 | Auth + full Sheets (base + 22 extra: tabs, formatting, named ranges, etc.) |
| [gogcli-mcp-docs](packages/gogcli-mcp-docs) | 26 | Auth + full Docs (base + 14 extra: insert, export, sed, comments, etc.) |

Each package is a **standalone** MCP server. Install whichever one fits your needs — you don't need to install more than one.

## Prerequisites

### Acknowledgement of Terms

By using this MCP server, you acknowledge and agree to the following:

**1. This server accesses your own Google Workspace data via Google's official APIs** (Gmail, Calendar, Drive, Sheets, Docs, Contacts). Auth happens via OAuth, with your explicit consent at each scope. It does not — and cannot — access anyone else's Google account or shared content you don't have permission to read.

**2. [Google's APIs Terms of Service](https://developers.google.com/terms) govern your use of this server**, in addition to any [Google Workspace Acceptable Use Policy](https://workspace.google.com/terms/use_policy.html) your domain admin enforces. The clauses most relevant here:

> Google sets and enforces limits on your use of the APIs (e.g. limiting the number of API requests that you may make or the number of users you may serve), in our sole discretion.

And on credentials, which is the most-tripped-on clause for open-source projects:

> You will keep your credentials confidential and make reasonable efforts to prevent and discourage other API Clients from using your credentials. **Developer credentials may not be embedded in open source projects.**

You are agreeing to those terms — read by the maintainer 2026-05-23 — every time you invoke a tool in this server.

**3. You must configure your own OAuth client.** This MCP does **not** ship an embedded `client_secret.json`. You register your own OAuth client at https://console.cloud.google.com/, scope it to your own user/project, and authorize it for the Workspace APIs you want to use. Do not check `client_secret.json`, `credentials.json`, or any refresh tokens into git — these are credentials and Google's ToS explicitly prohibits embedding them in OSS.

**4. Personal, single-user use only.** This project is not affiliated with, endorsed by, sponsored by, or in partnership with Google LLC. It is a personal automation tool for one Google account holder to read and write their own Workspace content. Do not use it to bulk-extract Workspace data from your org, automate against other users' accounts, or build a multi-tenant SaaS on top of it. If you want to do those things, you need a verified app, a domain-wide-delegation service account, and a Workspace admin's blessing — none of which this MCP provides.

**5. Your domain admin's policy may add restrictions.** If you're using a corporate Google Workspace account, your admin may restrict third-party OAuth apps, prohibit data exfiltration, or require app verification. **Check with your IT admin** before authorizing this MCP against a corporate domain.

**6. You accept full responsibility** for any consequences of using this server in connection with your Google account — quota exhaustion (Gmail and Drive APIs have aggressive per-user quotas), token revocation, account warnings, your domain admin emailing you, or any enforcement action. If Google or your domain admin objects to your use, stop using this server.

This section is the maintainer's good-faith summary of the terms — it is not legal advice and does not modify or supersede Google's actual APIs ToS or your domain's policies.

## Install gogcli

[gogcli](https://github.com/openclaw/gogcli) is the CLI that these MCP servers wrap. Install it for your platform:

**macOS (Homebrew):**
```bash
brew install steipete/tap/gogcli
```

**macOS / Linux (binary):**
```bash
curl -fsSL https://github.com/openclaw/gogcli/releases/latest/download/gog-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') -o /usr/local/bin/gog
chmod +x /usr/local/bin/gog
```

**Windows (Scoop):**
```powershell
scoop bucket add steipete https://github.com/steipete/scoop-bucket
scoop install gogcli
```

**Windows (manual):**

Download `gog-windows-amd64.exe` from the [latest release](https://github.com/openclaw/gogcli/releases/latest), rename to `gog.exe`, and add to your PATH.

### Authenticate

```bash
gog auth add your@gmail.com
```

This opens a browser for Google OAuth. For specific services only:

```bash
gog auth add your@gmail.com --services sheets,docs,drive
```

### Install Node.js

Node.js 22 or later is required. Install via [nodejs.org](https://nodejs.org) or:

```bash
brew install node        # macOS
```

## Quick Start

```bash
# Install the package you want
npm install -g gogcli-mcp          # base
npm install -g gogcli-mcp-sheets   # extended sheets
npm install -g gogcli-mcp-docs     # extended docs
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

Replace `gogcli-mcp` with `gogcli-mcp-sheets` or `gogcli-mcp-docs` for extended packages.

### Claude Code

```bash
claude mcp add gogcli -- gogcli-mcp
```

## What you can do

Ask Claude things like:

- *"Read the data in Sheet1!A1:D20 of my budget spreadsheet"*
- *"Append this week's expenses to my tracking sheet"*
- *"Search my Gmail for invoices from last month"*
- *"Create a calendar event for tomorrow at 3pm"*
- *"List comments on my project doc"*
- *"Export my doc as a PDF"*

## Multiple Accounts

All tools accept an optional `account` parameter:

```
Read Sheet1!A1:D10 from spreadsheet abc123 using my work account work@company.com
```

## Local files

Tools that read or write files on the machine gog runs on (`attach`, `localPath`, `file`, `out`, export and
download paths) only accept paths inside the directories listed in `GOG_FILE_ROOTS` — a `:`-separated list
(`;` on Windows). Unset, it defaults to `~/gogcli-mcp-files`: put files you want to attach or upload there, and
point exports and downloads there. Widen it deliberately (for example to your home directory) if you need to:

```json
"env": { "GOG_ACCOUNT": "you@gmail.com", "GOG_FILE_ROOTS": "/Users/you/Documents:/Users/you/Downloads" }
```

`attachInline` / `content` carry file bytes with the request and are not affected.

The escape hatches are bound by the same roots: a path flag passed through `gog_<service>_run` (`--out`,
`--out-dir`, `--attach`, `--file`, any `--*-file`, an `@file` JSON input) must be inside `GOG_FILE_ROOTS`, and
`gog_api_call`'s `@file` body likewise. Subcommands that take a local path positionally (`drive upload`,
`drive sync`, `gmail import`, `appscript pull`, `slides add-slide` / `insert-image` / `replace-slide`) are refused
there — use their dedicated tools.

## Confirmation prompts, and clients without them

Tools that reach another person, grant access, run code, bill a project or delete for good ask the user to confirm a
preview first, through an MCP elicitation prompt. The preview names what is acted on — the file, event, class,
student, spreadsheet or messages — rather than an opaque id:

| Service | Tools | Asks when |
|---|---|---|
| Gmail | `gog_gmail_send`, `_reply`, `_reply_all`, `_forward`, `_autoreply`, `_drafts_send` | always |
| Chat | `gog_chat_messages_send`, `gog_chat_dm_send` | always |
| Drive | `gog_drive_share` | always (granting access is the risk; gog sends no share email by default) |
| Classroom | `gog_classroom_announcements_create` | unless `state` is `DRAFT` (students cannot see drafts) |
| Classroom | `gog_classroom_invitations_create` | always |
| Calendar | `gog_calendar_create` | only with attendees (the event lands on their calendars; no invitation email is sent) |
| Calendar | `gog_calendar_update` | only for a change guests can see, on an event that has or gains guests (reminder-only changes never ask) |
| Calendar | `gog_calendar_respond` | always (the organizer sees it) |
| Calendar | `gog_calendar_delete` | only when the event has guests or recurs (gog deletes the whole series by default) |
| Calendar | `gog_calendar_move` | only with `sendUpdates` `all` or `externalOnly` (Google emails the guests) |
| Calendar | `gog_calendar_out_of_office` | unless `autoDecline` is `none` (gog's default declines every conflicting meeting and notifies its organizer) |
| Calendar | `gog_calendar_delete_calendar` | always (the calendar and every event on it) |
| Chat | `gog_chat_spaces_create` | only with `members` (they are added and notified) |
| Classroom | `gog_classroom_students_add` | unless `userId` is `me` |
| Classroom | `gog_classroom_teachers_add` | always (a co-teacher sees every student's work) |
| Classroom | `gog_classroom_coursework_create` | unless `state` is `DRAFT` |
| Classroom | `gog_classroom_submissions_return` | always (the student is notified and sees the grade) |
| Classroom | `gog_classroom_courses_delete`, `gog_classroom_coursework_delete` | always (submissions go with them) |
| Drive / Docs | `gog_drive_comments_add`, `_reply`, `gog_docs_comments_add`, `_reply` | always (the owner, the thread and anyone +mentioned are notified) |
| Drive | `gog_drive_delete` | only with `permanent: true` (moving to trash never asks) |
| Gmail | `gog_gmail_batch_delete` | only with `force: true` (the messages bypass Trash) |
| Gmail | `gog_gmail_vacation_update` | only with `enable` (the auto-reply goes to every sender in scope) |
| Gmail | `gog_gmail_sendas_create` | always (Google emails the address; the account gains a sending identity) |
| Sheets | `gog_sheets_datasource_add`, `_update`, `_refresh` | always (each starts a BigQuery job billed to the billing project) |
| Apps Script | `gog_appscript_run_function` | always (arbitrary code with the account's authority) |
| Classroom | `gog_classroom_announcements_update`, `gog_classroom_coursework_update` | only when publishing: `state` `PUBLISHED` or a `scheduled` time |
| API | `gog_api_call` | every write that is sent (`allowWrite` without `dryRun`); the prompt shows the exact api/version/method/params/body |

A Gmail forwarding filter (`gog_gmail_filters_create` with `forward`) asks too, but never takes the fallback below.

Some clients, claude.ai chat and Claude Desktop among them, cannot show the prompt. There, by default, these
tools use a two-step flow instead. `MCP_CONFIRM_MODE` (the same setting every chrischall MCP server uses) decides
what happens:

| `MCP_CONFIRM_MODE` | On a client that cannot show a prompt |
|---|---|
| `ask-user` (**default**) | Two steps (below). The first call returns the preview and a token, and tells the model to show it to you and continue only after you approve in chat. |
| `auto` | The same two steps, but the model may use the token after reviewing the preview itself. |
| `refuse` | Refused (`"reason": "confirmation-unsupported"`). |

A client that can show prompts (Claude Code) always gets the real prompt, whatever the mode. An unrecognised
value is treated as `refuse`.

1. **Phase 1**: the tool is called without `confirmToken`. Nothing is sent or changed. It returns
   `"status": "confirmation-required"`, the full preview, a `confirmToken`, and the instruction to show the preview
   to the user verbatim and go ahead only after they approve in chat. For mail the preview has from, to, cc, bcc,
   subject, the complete body, attachment names and sizes, threadId and In-Reply-To (a draft also shows its draftId
   and messageId). A share names the file, grantee and role. An announcement or invitation names the class. A
   calendar change shows the event as it stands and what changes.
2. **Phase 2**: the tool is called again with the same arguments plus `confirmToken`. It re-reads the draft,
   message, file, course or event, and acts only if that still matches what the token was issued for.

A token is an HMAC-SHA256 over the tool, account, target, the target's version (a draft's messageId, an event's
etag) and a SHA-256 of the payload. For mail the payload is the recipients, subject, text and HTML body, attachment
names and sizes (plus a content hash for files you pass in), and In-Reply-To/References. The token is single-use and expires after 10 minutes. Anything else
sends nothing and returns an error:

| error | meaning |
|---|---|
| `DRAFT_CHANGED` | what would happen changed: a draft was edited or re-saved (its messageId rotated, which mail clients such as Apple Mail do on every save), an event was edited elsewhere (its etag rotated), or the payload differs. The result carries the new preview and a fresh token for the user to re-approve. |
| `TOKEN_EXPIRED` | older than the TTL |
| `TOKEN_REUSED` | already used: one approval acts once |
| `TOKEN_INVALID` | tampered, issued for a different tool, account or target, or issued before a server restart |

| variable | default | |
|---|---|---|
| `MCP_CONFIRM_MODE` | `ask-user` | see the table above |
| `MCP_CONFIRM_TTL_SECONDS` | `600` | token lifetime |
| `MCP_CONFIRM_SECRET` | random per process | HMAC key; set it only if tokens must survive a server restart. Used tokens are remembered in memory, per process, so with a fixed secret a token that was already used is accepted again after a restart (or by another instance with the same secret) until it expires. Leave it unset unless you need that. |

**What this does not do.** With elicitation, the host asks the user and the model never sees the approval. With
the fallback, the approval is a tool argument, so the check that the user really approved is the model following
the instruction. The token makes sure what happens is exactly what was previewed, and that it happens once, for
that one tool, account and target. It cannot prove a human said yes. That is why the fallback is opt-in.

## Development

```bash
npm install        # install all workspace dependencies
npm run build      # build all packages
npm test           # test all packages (267 tests, 100% coverage)
npm run typecheck  # typecheck all packages
```

## Security

- No credentials are stored or passed by these servers — authentication is handled by gogcli's keyring
- All gogcli invocations use `--no-input` to prevent interactive prompts
- All arguments are passed as arrays to `child_process.spawn` — no shell injection risk
- `GOG_ACCESS_TOKEN` is stripped from the child process environment to prevent stale token auth
- Server-side paths are confined to `GOG_FILE_ROOTS` (resolved through symlinks), in the structured tools and the escape hatches alike, so a prompt-injected agent cannot attach `~/.ssh` or gog's own credentials to an email, or write attachment bytes over `~/.zshrc`; escape-hatch flags that make gog run a local command (`--on-change`, `--on-new`, `--mmdc`) are refused
- Escape-hatch tools (`gog_<service>_run`, `gog_api_call`) refuse args that would override safety flags (`--readonly=false`, `--disable-commands=`, `--account`, a bare `--`, …); `gog_auth_run` cannot export tokens
- The escape hatches cannot skip a confirmation: every action a dedicated tool asks about (see [the table](#confirmation-prompts-and-clients-without-them)) is refused by `gog_<service>_run` under each of gog's aliases and flag spellings for it — `gog_docs_run`, `gog_sheets_run` and `gog_appscript_run` included — and the ones that notify, grant access or run code are refused by `gog_api_call` as the raw API method. `gog_<service>_run` also refuses changes it cannot preview (`drive bulk` permission rewrites, `drive unshare`, calendar decline via `propose-time`, auto-declining focus time, guardian invitations, publishing Classroom materials, widening assignees), and every other `gog_api_call` write asks the user to confirm the exact method and payload first
- The Gmail dispatch audit line on stderr names external recipient *domains* and counts, never addresses; tool errors list the configured accounts only when the failure is an auth failure
- Every tool that reaches another person, grants access, runs code, bills a project or deletes for good asks the user to confirm a preview first: every Gmail send path and a forwarding filter, Chat posts, DMs and member-seeded spaces, Drive shares and comments, Classroom posts, invitations, roster adds, returns and publishing a draft announcement or coursework, Calendar changes that guests will see, Apps Script runs, billed Connected Sheets queries, permanent deletes, and every `gog_api_call` write ([the full list](#confirmation-prompts-and-clients-without-them)). On a client without elicitation, a two-step preview and a single-use token take the place of that prompt (`MCP_CONFIRM_MODE`: `ask-user` by default, `auto` or `refuse`) ([details](#confirmation-prompts-and-clients-without-them)). A forwarding filter never takes that path
- Attachment downloads land in a private per-user temp directory (mode 0700) and are deleted after delivery or swept after 24 hours

## License

MIT
