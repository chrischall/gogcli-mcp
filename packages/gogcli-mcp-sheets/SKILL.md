---
name: gogcli-mcp-sheets
description: Use when the user asks to read, write, format, or manage Google Sheets. Triggers for requests involving spreadsheet data, cell formatting, tab management, named ranges, merging cells, freezing rows/columns, exporting spreadsheets, or any Sheets operation. Includes auth and Sheets tools only.
---

# gogcli-mcp-sheets

Extended Google Sheets MCP server via [gogcli](https://github.com/openclaw/gogcli) — 71 tools: 8 auth + 8 base Sheets + 55 extra dedicated Sheets tools.

- **Source:** [github.com/chrischall/gogcli-mcp](https://github.com/chrischall/gogcli-mcp)

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated
- Node.js 18 or later

## Setup

```json
{
  "mcpServers": {
    "gogcli-sheets": {
      "command": "npx",
      "args": ["-y", "gogcli-mcp-sheets"],
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

## Extra Sheets Tools

| Tool | What it does |
|------|-------------|
| `gog_sheets_add_tab` | Add a new sheet tab |
| `gog_sheets_delete_tab` | Delete a sheet tab |
| `gog_sheets_rename_tab` | Rename a sheet tab |
| `gog_sheets_copy` | Copy a sheet to another spreadsheet |
| `gog_sheets_export` | Export as CSV, TSV, XLSX, PDF |
| `gog_sheets_freeze` | Freeze rows and/or columns |
| `gog_sheets_insert` | Insert rows or columns |
| `gog_sheets_merge` | Merge cells |
| `gog_sheets_unmerge` | Unmerge cells |
| `gog_sheets_format` | Apply cell formatting |
| `gog_sheets_number_format` | Set number format |
| `gog_sheets_read_format` | Read cell formatting |
| `gog_sheets_resize_columns` | Resize column widths |
| `gog_sheets_resize_rows` | Resize row heights |
| `gog_sheets_notes` | Read cell notes |
| `gog_sheets_update_note` | Add or update cell notes |
| `gog_sheets_links` | List hyperlinks in a range |
| `gog_sheets_links_set` | Set =HYPERLINK() cells in one call (batch) |
| `gog_sheets_snapshot` | Back up a whole spreadsheet before a risky edit |
| `gog_sheets_datasource_list` | List Connected Sheets data sources (BigQuery / Looker) with sheet + execution status |
| `gog_sheets_datasource_describe` | Full data-source spec, including its query, status and refresh schedules |
| `gog_sheets_datasource_table_list` | List anchored data-source tables (extracts) and their A1 anchors |
| `gog_sheets_datasource_table_describe` | Describe the extract anchored at an A1 cell |
| `gog_sheets_datasource_table_read` | Read a bounded number of rows out of an extract |
| `gog_sheets_datasource_add` | Add a BigQuery Connected Sheets data source (custom SQL or a native table) |
| `gog_sheets_datasource_update` | Repoint a data source's SQL, table or billing project |
| `gog_sheets_datasource_refresh` | Re-run a data source so its sheet and extracts pick up current data |
| `gog_sheets_datasource_delete` | Delete a data source, its linked sheet, and unlink dependent objects |
| `gog_sheets_named_ranges_list` | List named ranges |
| `gog_sheets_named_ranges_get` | Get a named range |
| `gog_sheets_named_ranges_add` | Create a named range |
| `gog_sheets_named_ranges_update` | Update a named range |
| `gog_sheets_named_ranges_delete` | Delete a named range |
| `gog_sheets_list_tabs` | List tabs in a spreadsheet (sheetId, title, index, gridProperties) |
| `gog_sheets_copy_paste` | Copy a range's values/formulas/format to another range (tiles to fill down/across). |
| `gog_sheets_validation_get` | Read data-validation rules (dropdowns, checkboxes, conditions) on a range. |
| `gog_sheets_validation_set` | Set a data-validation rule on a range: dropdowns, checkboxes, number/date conditions, or custom formulas. |
| `gog_sheets_validation_clear` | Remove all data-validation rules from a range. |
| `gog_sheets_delete_dimension` | Delete a row or column span, table-aware: intersecting tables are shrunk and their remaining data preserved. |
| `gog_sheets_batch_update` | Update values in multiple ranges atomically with one Sheets API request. |
| `gog_sheets_reorder_tab` | Move a tab to a specific 0-based position. |
| `gog_sheets_chart_list` | List embedded charts in a spreadsheet. |
| `gog_sheets_chart_get` | Get a chart's full definition (spec + position) by chart ID. |
| `gog_sheets_chart_create` | Create an embedded chart from a JSON ChartSpec. |
| `gog_sheets_chart_update` | Replace a chart's spec by chart ID. |
| `gog_sheets_chart_delete` | Delete a chart by chart ID. |
| `gog_sheets_table_list` | List Google Sheets tables in a spreadsheet. |
| `gog_sheets_table_get` | Get a Google Sheets table by table ID. |
| `gog_sheets_table_create` | Create a Google Sheets table over a range with typed columns. |
| `gog_sheets_table_append` | Append data rows to a table. |
| `gog_sheets_table_clear` | Clear all data rows from a table. |
| `gog_sheets_table_delete` | Delete a Google Sheets table. By default preserves the table's cell values and formulas (emulates "Convert to range"); set keep_data=false to also wipe the data. |
| `gog_sheets_banding_list` | List alternating-color banded ranges. |
| `gog_sheets_banding_set` | Apply alternating colors to a range. |
| `gog_sheets_banding_clear` | Remove alternating-color banding by ID or for a whole sheet. |
| `gog_sheets_filter_set` | Set a basic filter on a range; replacing an existing filter requires replace=true. |
| `gog_sheets_conditional_format_list` | List conditional formatting rules. |
| `gog_sheets_conditional_format_add` | Add a conditional formatting rule to a range (boolean or gradient). |
| `gog_sheets_conditional_format_clear` | Remove conditional formatting rules from a sheet. |

Plus 8 auth tools and 8 base Sheets tools.
