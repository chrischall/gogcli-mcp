# gogcli-mcp-slides

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Extended Google Slides [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/steipete/gogcli). Includes auth tools plus 12 dedicated Slides tools for creating, editing, and exporting presentations (markdown-driven creation, template substitution, speaker notes, slide images, and more).

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com --services slides
```

## Installation

```bash
npm install -g gogcli-mcp-slides
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-slides": {
      "command": "gogcli-mcp-slides",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-slides -- gogcli-mcp-slides
```

## Slides Tools (12)

Plus 5 auth tools and 1 `gog_slides_run` escape hatch for a total of 18 tools.

| Tool | Description |
|------|-------------|
| `gog_slides_export` | Export a presentation to a local file (pdf or pptx) |
| `gog_slides_info` | Get metadata for a presentation |
| `gog_slides_create` | Create a new presentation, optionally from a template |
| `gog_slides_create_from_markdown` | Create a new presentation from markdown content |
| `gog_slides_create_from_template` | Create from a template with placeholder replacements |
| `gog_slides_copy` | Copy a presentation |
| `gog_slides_add_slide` | Add a new slide from a local image |
| `gog_slides_list_slides` | List slides in a presentation |
| `gog_slides_delete_slide` | Delete a slide |
| `gog_slides_read_slide` | Read the content of a slide |
| `gog_slides_update_notes` | Update speaker notes on a slide |
| `gog_slides_replace_slide` | Replace the image content of an existing slide |

## License

MIT
