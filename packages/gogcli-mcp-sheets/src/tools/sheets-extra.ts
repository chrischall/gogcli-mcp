import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraSheetsTools(server: McpServer): void {
  // 1. Add tab
  server.registerTool('gog_sheets_add_tab', {
    description: 'Add a new sheet tab to a spreadsheet.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      tabName: z.string().describe('Name for the new tab'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tabName, account }) => {
    return runOrDiagnose(['sheets', 'add-tab', spreadsheetId, tabName], { account });
  });

  // 2. Delete tab
  server.registerTool('gog_sheets_delete_tab', {
    description: 'Delete a sheet tab from a spreadsheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tabName: z.string().describe('Name of the tab to delete'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tabName, account }) => {
    return runOrDiagnose(['sheets', 'delete-tab', spreadsheetId, tabName], { account });
  });

  // 3. Rename tab
  server.registerTool('gog_sheets_rename_tab', {
    description: 'Rename a sheet tab.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      oldName: z.string().describe('Current tab name'),
      newName: z.string().describe('New tab name'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, oldName, newName, account }) => {
    return runOrDiagnose(['sheets', 'rename-tab', spreadsheetId, oldName, newName], { account });
  });

  // 4. Copy spreadsheet
  server.registerTool('gog_sheets_copy', {
    description: 'Copy a spreadsheet to a new spreadsheet with the given title.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID to copy'),
      title: z.string().describe('Title for the new copy'),
      parent: z.string().optional().describe('Parent folder ID to place the copy in'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, title, parent, account }) => {
    const args = ['sheets', 'copy', spreadsheetId, title];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

  // 5. Export spreadsheet
  server.registerTool('gog_sheets_export', {
    description: 'Export a spreadsheet as CSV, TSV, or PDF.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      format: z.string().optional().describe('Export format: csv, tsv, pdf (default: csv)'),
      out: z.string().optional().describe('Output file path'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, format, out, account }) => {
    const args = ['sheets', 'export', spreadsheetId];
    if (format) args.push(`--format=${format}`);
    if (out) args.push(`--out=${out}`);
    return runOrDiagnose(args, { account });
  });

  // 6. Freeze rows/columns
  server.registerTool('gog_sheets_freeze', {
    description: 'Freeze rows and/or columns in a sheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      rows: z.number().optional().describe('Number of rows to freeze'),
      cols: z.number().optional().describe('Number of columns to freeze'),
      sheet: z.string().optional().describe('Sheet tab name (default: first sheet)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, rows, cols, sheet, account }) => {
    const args = ['sheets', 'freeze', spreadsheetId];
    if (rows !== undefined) args.push(`--rows=${rows}`);
    if (cols !== undefined) args.push(`--cols=${cols}`);
    if (sheet) args.push(`--sheet=${sheet}`);
    return runOrDiagnose(args, { account });
  });

  // 7. Insert rows/columns
  server.registerTool('gog_sheets_insert', {
    description: 'Insert rows or columns into a sheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      sheet: z.string().describe('Sheet tab name'),
      dimension: z.string().describe('Dimension to insert: ROWS or COLUMNS'),
      start: z.number().describe('Start index (0-based)'),
      count: z.number().optional().describe('Number of rows/columns to insert (default: 1)'),
      after: z.boolean().optional().describe('Insert after the start index instead of before'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, sheet, dimension, start, count, after, account }) => {
    const args = ['sheets', 'insert', spreadsheetId, sheet, dimension, String(start)];
    if (count !== undefined) args.push(`--count=${count}`);
    if (after) args.push('--after');
    return runOrDiagnose(args, { account });
  });

  // 8. Merge cells
  server.registerTool('gog_sheets_merge', {
    description: 'Merge cells in a range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to merge (e.g. Sheet1!A1:C3)'),
      type: z.string().optional().describe('Merge type: MERGE_ALL, MERGE_COLUMNS, MERGE_ROWS'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, type, account }) => {
    const args = ['sheets', 'merge', spreadsheetId, range];
    if (type) args.push(`--type=${type}`);
    return runOrDiagnose(args, { account });
  });

  // 9. Unmerge cells
  server.registerTool('gog_sheets_unmerge', {
    description: 'Unmerge previously merged cells in a range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to unmerge (e.g. Sheet1!A1:C3)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    return runOrDiagnose(['sheets', 'unmerge', spreadsheetId, range], { account });
  });

  // 10. Format cells
  server.registerTool('gog_sheets_format', {
    description: 'Apply cell formatting (bold, colors, alignment, etc.) to a range. Pass format as a JSON CellFormat object.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to format (e.g. Sheet1!A1:C3)'),
      formatJson: z.string().describe('JSON CellFormat object (e.g. {"textFormat":{"bold":true}})'),
      formatFields: z.string().optional().describe('Comma-separated field mask (e.g. textFormat.bold,backgroundColor)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, formatJson, formatFields, account }) => {
    const args = ['sheets', 'format', spreadsheetId, range, `--format-json=${formatJson}`];
    if (formatFields) args.push(`--format-fields=${formatFields}`);
    return runOrDiagnose(args, { account });
  });

  // 11. Number format
  server.registerTool('gog_sheets_number_format', {
    description: 'Set number format on a range (currency, percentage, date, etc.).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to format (e.g. Sheet1!A1:A10)'),
      type: z.string().optional().describe('Format type: NUMBER, CURRENCY, PERCENT, DATE, TIME, SCIENTIFIC, etc.'),
      pattern: z.string().optional().describe('Custom format pattern (e.g. "#,##0.00", "yyyy-mm-dd")'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, type, pattern, account }) => {
    const args = ['sheets', 'number-format', spreadsheetId, range];
    if (type) args.push(`--type=${type}`);
    if (pattern) args.push(`--pattern=${pattern}`);
    return runOrDiagnose(args, { account });
  });

  // 12. Read format
  server.registerTool('gog_sheets_read_format', {
    description: 'Read cell formatting for a range.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to read formatting from'),
      effective: z.boolean().optional().describe('Return effective (computed) format including inherited styles'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, effective, account }) => {
    const args = ['sheets', 'read-format', spreadsheetId, range];
    if (effective) args.push('--effective');
    return runOrDiagnose(args, { account });
  });

  // 13. Resize columns
  server.registerTool('gog_sheets_resize_columns', {
    description: 'Resize column widths. Use --auto for auto-fit or --width for a specific pixel width.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      columns: z.string().describe('Column range (e.g. A:C, or Sheet1!A:C)'),
      width: z.number().optional().describe('Width in pixels'),
      auto: z.boolean().optional().describe('Auto-fit column width to content'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, columns, width, auto, account }) => {
    const args = ['sheets', 'resize-columns', spreadsheetId, columns];
    if (width !== undefined) args.push(`--width=${width}`);
    if (auto) args.push('--auto');
    return runOrDiagnose(args, { account });
  });

  // 14. Resize rows
  server.registerTool('gog_sheets_resize_rows', {
    description: 'Resize row heights. Use --auto for auto-fit or --height for a specific pixel height.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      rows: z.string().describe('Row range (e.g. 1:10, or Sheet1!1:10)'),
      height: z.number().optional().describe('Height in pixels'),
      auto: z.boolean().optional().describe('Auto-fit row height to content'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, rows, height, auto, account }) => {
    const args = ['sheets', 'resize-rows', spreadsheetId, rows];
    if (height !== undefined) args.push(`--height=${height}`);
    if (auto) args.push('--auto');
    return runOrDiagnose(args, { account });
  });

  // 15. Notes (read)
  server.registerTool('gog_sheets_notes', {
    description: 'Read cell notes in a range.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to read notes from (e.g. Sheet1!A1:B5)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    return runOrDiagnose(['sheets', 'notes', spreadsheetId, range], { account });
  });

  // 16. Update note
  server.registerTool('gog_sheets_update_note', {
    description: 'Add, update, or clear a cell note. Pass an empty string to clear the note.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Cell or range to set the note on (e.g. Sheet1!A1)'),
      note: z.string().describe('Note text (empty string clears the note)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, note, account }) => {
    return runOrDiagnose(['sheets', 'update-note', spreadsheetId, range, `--note=${note}`], { account });
  });

  // 17. Links
  server.registerTool('gog_sheets_links', {
    description: 'List hyperlinks in a range.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to scan for hyperlinks (e.g. Sheet1!A1:Z100)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    return runOrDiagnose(['sheets', 'links', spreadsheetId, range], { account });
  });

  // 18. Named ranges list
  server.registerTool('gog_sheets_named_ranges_list', {
    description: 'List all named ranges in a spreadsheet.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    return runOrDiagnose(['sheets', 'named-ranges', 'list', spreadsheetId], { account });
  });

  // 19. Named ranges get
  server.registerTool('gog_sheets_named_ranges_get', {
    description: 'Get a named range by name or ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      nameOrId: z.string().describe('Named range name or ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, nameOrId, account }) => {
    return runOrDiagnose(['sheets', 'named-ranges', 'get', spreadsheetId, nameOrId], { account });
  });

  // 20. Named ranges add
  server.registerTool('gog_sheets_named_ranges_add', {
    description: 'Create a new named range.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      name: z.string().describe('Name for the range'),
      range: z.string().describe('Cell range (e.g. Sheet1!A1:B10)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, name, range, account }) => {
    return runOrDiagnose(['sheets', 'named-ranges', 'add', spreadsheetId, name, range], { account });
  });

  // 21. Named ranges update
  server.registerTool('gog_sheets_named_ranges_update', {
    description: 'Update a named range (change its name, range, or both).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      nameOrId: z.string().describe('Current named range name or ID'),
      name: z.string().optional().describe('New name'),
      range: z.string().optional().describe('New cell range'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, nameOrId, name, range, account }) => {
    const args = ['sheets', 'named-ranges', 'update', spreadsheetId, nameOrId];
    if (name) args.push(`--name=${name}`);
    if (range) args.push(`--range=${range}`);
    return runOrDiagnose(args, { account });
  });

  // 22. Named ranges delete
  server.registerTool('gog_sheets_named_ranges_delete', {
    description: 'Delete a named range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      nameOrId: z.string().describe('Named range name or ID to delete'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, nameOrId, account }) => {
    return runOrDiagnose(['sheets', 'named-ranges', 'delete', spreadsheetId, nameOrId], { account });
  });
}
