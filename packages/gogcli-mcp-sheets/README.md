# gogcli-mcp-sheets

Extended Google Sheets [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/steipete/gogcli). Includes auth tools plus 22 additional dedicated Sheets tools for tab management, formatting, named ranges, and more.

## Requirements

- [gogcli](https://github.com/steipete/gogcli) installed and authenticated
- Node.js 18+

```bash
brew install gogcli
gog auth add your@gmail.com --services sheets
```

## Installation

```bash
npm install -g gogcli-mcp-sheets
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-sheets": {
      "command": "gogcli-mcp-sheets",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-sheets -- gogcli-mcp-sheets
```

## Extra Sheets Tools (22)

Plus 5 auth tools and 8 base Sheets tools (get, update, append, clear, metadata, create, find-replace, run).

| Tool | Description |
|------|-------------|
| `gog_sheets_add_tab` | Add a new sheet tab |
| `gog_sheets_delete_tab` | Delete a sheet tab |
| `gog_sheets_rename_tab` | Rename a sheet tab |
| `gog_sheets_copy` | Copy a sheet to another spreadsheet |
| `gog_sheets_export` | Export as CSV, TSV, XLSX, PDF, ODS, or HTML |
| `gog_sheets_freeze` | Freeze rows and/or columns |
| `gog_sheets_insert` | Insert rows or columns |
| `gog_sheets_merge` | Merge cells |
| `gog_sheets_unmerge` | Unmerge cells |
| `gog_sheets_format` | Apply cell formatting (bold, color, etc.) |
| `gog_sheets_number_format` | Set number format (currency, percent, date, etc.) |
| `gog_sheets_read_format` | Read cell formatting |
| `gog_sheets_resize_columns` | Resize column widths or auto-fit |
| `gog_sheets_resize_rows` | Resize row heights or auto-fit |
| `gog_sheets_named_ranges_list` | List named ranges |
| `gog_sheets_named_ranges_get` | Get a named range by name or ID |
| `gog_sheets_named_ranges_add` | Create a named range |
| `gog_sheets_named_ranges_update` | Update a named range |
| `gog_sheets_named_ranges_delete` | Delete a named range |
| `gog_sheets_notes` | Read cell notes |
| `gog_sheets_update_note` | Add or update cell notes |
| `gog_sheets_links` | List hyperlinks in a range |

## License

MIT
