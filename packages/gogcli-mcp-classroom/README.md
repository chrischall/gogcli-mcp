# gogcli-mcp-classroom

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Extended Google Classroom [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/steipete/gogcli). Includes auth tools plus dedicated Classroom tools covering courses, rosters, coursework, submissions (grading), announcements, topics, invitations, and profiles.

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com --services classroom
```

## Installation

```bash
npm install -g gogcli-mcp-classroom
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-classroom": {
      "command": "gogcli-mcp-classroom",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-classroom -- gogcli-mcp-classroom
```

## Dedicated Classroom Tools (44)

Plus 5 auth tools. Dedicated tools cover the common Classroom operations; anything not listed runs via the escape hatch.

| Namespace | Tools |
|-----------|-------|
| Courses | `gog_classroom_courses_list`, `_get`, `_create`, `_update`, `_delete`, `_archive`, `_unarchive` |
| Students | `gog_classroom_students_list`, `_get`, `_add`, `_remove` |
| Teachers | `gog_classroom_teachers_list`, `_get`, `_add`, `_remove` |
| Roster | `gog_classroom_roster` (combined students + teachers) |
| Coursework | `gog_classroom_coursework_list`, `_get`, `_create`, `_update`, `_delete` |
| Submissions | `gog_classroom_submissions_list`, `_get`, `_grade`, `_return`, `_turn_in`, `_reclaim` |
| Announcements | `gog_classroom_announcements_list`, `_get`, `_create`, `_update`, `_delete` |
| Topics | `gog_classroom_topics_list`, `_get`, `_create`, `_update`, `_delete` |
| Invitations | `gog_classroom_invitations_list`, `_get`, `_create`, `_accept`, `_delete` |
| Profile | `gog_classroom_profile_get` |

### Escape hatch

`gog_classroom_run` runs any Classroom subcommand not covered above, including:

- `guardians` (list/get/delete)
- `guardian-invitations` (create/list/cancel)
- `materials` (course materials)
- `coursework assignees` (individualized assignment targeting)
- `announcement assignees` (individualized announcement targeting)

Example: `{ "subcommand": "guardians", "args": ["list", "<studentUserId>"] }`.

## License

MIT
