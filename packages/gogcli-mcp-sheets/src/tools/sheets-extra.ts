import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rawTextResult } from '@chrischall/mcp-utils';
import { accountParam, runOrDiagnose, run, diagnose, errorText, payloadArg } from '../../../gogcli-mcp/src/lib.js';

// Pull the text out of a single-text-block tool result; undefined for any
// other shape (error results are still text blocks, so they parse below).
function resultText(result: CallToolResult): string | undefined {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : undefined;
}

// Convert a CSS-style hex color ("#FFF5D9", "#FD9", "FFF5D9") to the
// {red, green, blue} 0-1 float triple that Sheets API CellFormat expects.
// Returns null on unparseable input — caller decides whether to fall back
// or error.
export function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return {
    red: ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff) / 255,
    blue: (n & 0xff) / 255,
  };
}

// Issue #43: peek the target range before applying DATE / DATE_TIME number
// formatting. If every numeric cell is a small integer (< 10000), Sheets will
// render them as day-serials near 1899-12-30 — almost certainly not what the
// caller intended. Return a warning string in that case, otherwise null.
//
// Returns null (no warning) when:
//   - the peek fails / response isn't parseable JSON
//   - the range is empty
//   - any value is a non-integer number or a number >= 10000
//   - any value is a string (other than empty), boolean, etc.
// Nulls and empty strings are ignored.
async function checkDateFormatTarget(
  spreadsheetId: string,
  range: string,
  account: string | undefined,
): Promise<string | null> {
  const peek = await runOrDiagnose(
    ['sheets', 'get', spreadsheetId, range, '--render=UNFORMATTED_VALUE'],
    { account },
  );
  let parsed: { values?: unknown[][] };
  try {
    parsed = JSON.parse(resultText(peek) ?? '') as { values?: unknown[][] };
  } catch {
    return null;
  }
  const rows = parsed.values;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let sawSmallInt = false;
  for (const row of rows) {
    for (const cell of row) {
      if (cell === null || cell === undefined || cell === '') continue;
      if (typeof cell !== 'number') return null;
      if (!Number.isInteger(cell)) return null;
      if (cell < 0) return null;
      if (cell >= 10000) return null;
      sawSmallInt = true;
    }
  }
  if (!sawSmallInt) return null;
  return (
    'Warning: applying DATE/DATE_TIME format to cells holding small integers (< 10000) ' +
    'will render them as dates near 1899-12-30 because Sheets interprets numeric values as ' +
    'day-serials from that epoch. If those integers are ordinals (1, 2, 3, ...) and not ' +
    'day offsets, this is almost certainly not what you want. Pass force:true to suppress ' +
    'this warning, or convert the cells to real dates / strings first.'
  );
}

export function registerExtraSheetsTools(server: McpServer): void {

  server.registerTool('gog_sheets_list_tabs', {
    description: 'List tabs (sheets) in a spreadsheet with their titles, sheetIds, and indices. A friendlier view than gog_sheets_metadata when you only need the tab list — useful for restructuring a workbook over a long agent session without losing track of names.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    // jq projection keeps the response compact: sheetId, title, index, gridProperties only.
    return runOrDiagnose(
      ['sheets', 'metadata', spreadsheetId, '--select=sheets.properties.sheetId,sheets.properties.title,sheets.properties.index,sheets.properties.gridProperties'],
      { account },
    );
  });

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

  server.registerTool('gog_sheets_delete_tab', {
    description: 'Delete a sheet tab from a spreadsheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tabName: z.string().describe('Name of the tab to delete'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tabName, account }) => {
    return runOrDiagnose(['sheets', 'delete-tab', spreadsheetId, tabName, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

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

  server.registerTool('gog_sheets_export', {
    description: 'Export a spreadsheet as CSV, TSV, or PDF.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      format: z.string().optional().describe('Export format: csv, tsv, pdf (default: csv)'),
      out: z.string().optional().describe('Output file path'),
      overwrite: z.boolean().optional().describe('Overwrite the output file if it already exists (gog refuses otherwise)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, format, out, overwrite, account }) => {
    const args = ['sheets', 'export', spreadsheetId];
    if (format) args.push(`--format=${format}`);
    if (out) args.push(`--out=${out}`);
    if (overwrite) args.push('--overwrite');
    return runOrDiagnose(args, { account });
  });

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

  server.registerTool('gog_sheets_insert', {
    description: 'Insert rows or columns into a sheet. With after:false (default), the new dimension lands at start. With after:true, the new dimension lands at start+1 (the existing dimension at start is preserved).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      sheet: z.string().describe('Sheet tab name'),
      dimension: z.string().describe('Dimension to insert: ROWS or COLUMNS'),
      start: z.number().describe('Start index (0-based)'),
      count: z.number().optional().describe('Number of rows/columns to insert (default: 1)'),
      after: z.boolean().optional().describe('Insert after the start index instead of before. With after:true the new dimension lands at start+1, leaving the existing dimension at start untouched.'),
      inheritFromBefore: z.boolean().optional().describe('Inherit number format / styling from the row/column before the insertion. Defaults to true with after:true, false otherwise; pass false to inherit from the row/column after the insertion instead. Cannot inherit from before when inserting at the first row/column.'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, sheet, dimension, start, count, after, inheritFromBefore, account }) => {
    // gog's positional `<start>` is 1-based, and it rejects 0 ("start must be >= 1").
    // Without --after it inserts *before* the position, so API start_index = positional - 1;
    // with --after it inserts *after*, so API start_index = positional. Our `start` is 0-based,
    // and the contract is: after:false lands at start_index=start, after:true at start_index=start+1.
    // Both cases reduce to sending positional = start + 1 (issue #42 + the off-by-one this fixes).
    const effectiveStart = start + 1;
    const args = ['sheets', 'insert', spreadsheetId, sheet, dimension, String(effectiveStart)];
    if (count !== undefined) args.push(`--count=${count}`);
    if (after) args.push('--after');
    if (inheritFromBefore !== undefined) args.push(`--inherit-from-before=${inheritFromBefore}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_copy_paste', {
    description: 'Copy a source range\'s values/formulas/format to a destination range via the Sheets CopyPasteRequest. A destination larger than the source tiles the source to fill it — the canonical way to fill formulas down or across with relative references adjusted (aliases: fill, copy-range). Use type to control what is pasted (NORMAL pastes everything; FORMULA fills formulas with adjusted references; VALUES/FORMAT/etc. paste only that aspect).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      source: z.string().describe('Source range (e.g. Sheet1!A2:H71)'),
      dest: z.string().describe('Destination range (e.g. Sheet1!A2:H120). Larger than the source tiles/fills it.'),
      type: z.enum(['NORMAL', 'VALUES', 'FORMAT', 'FORMULA', 'NO_BORDERS', 'DATA_VALIDATION', 'CONDITIONAL_FORMATTING']).optional().describe('Paste type (default: NORMAL pastes everything)'),
      transpose: z.boolean().optional().describe('Paste transposed (swap rows and columns)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, source, dest, type, transpose, account }) => {
    const args = ['sheets', 'copy-paste', spreadsheetId, source, dest];
    if (type) args.push(`--type=${type}`);
    if (transpose) args.push('--transpose');
    return runOrDiagnose(args, { account });
  });

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

  server.registerTool('gog_sheets_format', {
    description: 'Apply cell formatting to a range. The named flags (bold, italic, backgroundColor, etc.) compose into a Sheets API CellFormat — use them for the 90% case. For full API control, pass formatJson + formatFields (Sheets CellFormat + field mask) directly.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to format (e.g. Sheet1!A1:C3)'),
      bold: z.boolean().optional().describe('Set bold'),
      italic: z.boolean().optional().describe('Set italic'),
      underline: z.boolean().optional().describe('Set underline'),
      strikethrough: z.boolean().optional().describe('Set strikethrough'),
      fontSize: z.number().optional().describe('Font size in points'),
      fontFamily: z.string().optional().describe('Font family (e.g. Arial)'),
      textColor: z.string().optional().describe('Text color as #RRGGBB or #RGB'),
      backgroundColor: z.string().optional().describe('Cell background color as #RRGGBB or #RGB'),
      horizontalAlignment: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional().describe('Horizontal alignment'),
      verticalAlignment: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional().describe('Vertical alignment'),
      wrapStrategy: z.enum(['OVERFLOW_CELL', 'LEGACY_WRAP', 'CLIP', 'WRAP']).optional().describe('Text wrap strategy'),
      formatJson: z.string().optional().describe('Escape hatch: raw CellFormat JSON. When provided, named flags above are ignored and formatJson is sent as-is.'),
      formatFields: z.string().optional().describe('Comma-separated field mask (e.g. textFormat.bold,backgroundColor). Required when using formatJson; auto-computed when using named flags.'),
      account: accountParam,
    },
  }, async (rawArgs) => {
    const a = rawArgs as {
      spreadsheetId: string;
      range: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
      fontSize?: number;
      fontFamily?: string;
      textColor?: string;
      backgroundColor?: string;
      horizontalAlignment?: string;
      verticalAlignment?: string;
      wrapStrategy?: string;
      formatJson?: string;
      formatFields?: string;
      account?: string;
    };
    let formatJson = a.formatJson;
    let formatFields = a.formatFields;
    // If the caller didn't pass raw JSON, compose it from the named flags.
    if (!formatJson) {
      const cellFormat: Record<string, unknown> = {};
      const textFormat: Record<string, unknown> = {};
      const fields: string[] = [];
      if (a.bold !== undefined) { textFormat.bold = a.bold; fields.push('textFormat.bold'); }
      if (a.italic !== undefined) { textFormat.italic = a.italic; fields.push('textFormat.italic'); }
      if (a.underline !== undefined) { textFormat.underline = a.underline; fields.push('textFormat.underline'); }
      if (a.strikethrough !== undefined) { textFormat.strikethrough = a.strikethrough; fields.push('textFormat.strikethrough'); }
      if (a.fontSize !== undefined) { textFormat.fontSize = a.fontSize; fields.push('textFormat.fontSize'); }
      if (a.fontFamily !== undefined) { textFormat.fontFamily = a.fontFamily; fields.push('textFormat.fontFamily'); }
      if (a.textColor !== undefined) {
        const rgb = hexToRgb(a.textColor);
        if (!rgb) throw new Error(`Invalid textColor: ${a.textColor} (expected #RRGGBB or #RGB)`);
        textFormat.foregroundColor = rgb;
        fields.push('textFormat.foregroundColor');
      }
      if (Object.keys(textFormat).length > 0) cellFormat.textFormat = textFormat;
      if (a.backgroundColor !== undefined) {
        const rgb = hexToRgb(a.backgroundColor);
        if (!rgb) throw new Error(`Invalid backgroundColor: ${a.backgroundColor} (expected #RRGGBB or #RGB)`);
        cellFormat.backgroundColor = rgb;
        fields.push('backgroundColor');
      }
      if (a.horizontalAlignment !== undefined) {
        cellFormat.horizontalAlignment = a.horizontalAlignment;
        fields.push('horizontalAlignment');
      }
      if (a.verticalAlignment !== undefined) {
        cellFormat.verticalAlignment = a.verticalAlignment;
        fields.push('verticalAlignment');
      }
      if (a.wrapStrategy !== undefined) {
        cellFormat.wrapStrategy = a.wrapStrategy;
        fields.push('wrapStrategy');
      }
      if (Object.keys(cellFormat).length === 0) {
        throw new Error('gog_sheets_format requires at least one named flag or a formatJson value');
      }
      formatJson = JSON.stringify(cellFormat);
      if (!formatFields) formatFields = fields.join(',');
    }
    const args = ['sheets', 'format', a.spreadsheetId, a.range, `--format-json=${formatJson}`];
    if (formatFields) args.push(`--format-fields=${formatFields}`);
    return runOrDiagnose(args, { account: a.account });
  });

  server.registerTool('gog_sheets_number_format', {
    description: 'Set number format on a range (currency, percentage, date, etc.). When type is DATE or DATE_TIME, the target range is peeked first; if every numeric cell is a small integer (< 10000), a warning is prepended to the response because Sheets will render those as 1899/1900 day-serials. Pass force:true to skip the check.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to format (e.g. Sheet1!A1:A10)'),
      type: z.string().optional().describe('Format type: NUMBER, CURRENCY, PERCENT, DATE, DATE_TIME, TIME, SCIENTIFIC, etc.'),
      pattern: z.string().optional().describe('Custom format pattern (e.g. "#,##0.00", "yyyy-mm-dd")'),
      force: z.boolean().optional().describe('Skip the DATE/DATE_TIME small-integer warning check'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, type, pattern, force, account }) => {
    const isDateType = type === 'DATE' || type === 'DATE_TIME';
    const warning = isDateType && !force
      ? await checkDateFormatTarget(spreadsheetId, range, account)
      : null;
    const args = ['sheets', 'number-format', spreadsheetId, range];
    if (type) args.push(`--type=${type}`);
    if (pattern) args.push(`--pattern=${pattern}`);
    const result = await runOrDiagnose(args, { account });
    if (warning) {
      return { ...result, content: [{ type: 'text' as const, text: `${warning}\n\n${resultText(result) ?? ''}` }] };
    }
    return result;
  });

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

  server.registerTool('gog_sheets_update_note', {
    description: 'Add, update, or clear a cell note. Pass an empty string to clear the note.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Cell or range to set the note on (e.g. Sheet1!A1)'),
      note: z.string().describe('Note text (empty string clears the note). Large notes are written to a temp file and passed to gog as --note-file automatically.'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, note, account }) => {
    // payloadArg keeps normal notes on `--note=` and spills a large one to a
    // temp file passed as `--note-file`, so it can't blow the argv size cap.
    // The wrapper exposes no noteFile param, so there is no both-flags case to
    // guard here (gog would accept both anyway, letting the file win).
    return runOrDiagnose(
      ['sheets', 'update-note', spreadsheetId, range, payloadArg('note', 'note-file', note)],
      { account },
    );
  });

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

  server.registerTool('gog_sheets_links_set', {
    description:
      'Set cell hyperlinks in a Google Sheet. Three modes: (1) single link — pass cell + url (+ optional text); ' +
      '(2) multi-link cell — pass cell + runsJson, a JSON array of rich-text runs (a run with an empty uri is plain text); ' +
      '(3) batch — pass cellsJson, a JSON array of {cell,url,text} or {cell,runs:[...]} objects written in one request.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      cell: z.string().optional().describe('Target cell in A1 notation (e.g. Sheet1!B2). Used by single-link and runsJson modes; omit for batch (cellsJson).'),
      url: z.string().optional().describe('Hyperlink URL for single-link mode'),
      text: z.string().optional().describe('Display text for single-link mode (defaults to the URL when omitted)'),
      runsJson: z.string().optional().describe('Multi-link cell: JSON array of runs, e.g. [{"text":"Act A","uri":"https://a"},{"text":" / "},{"text":"Act B","uri":"https://b"}]. A run with an empty uri is plain text.'),
      cellsJson: z.string().optional().describe('Batch: JSON array of {cell,url,text} or {cell,runs:[{text,uri}]} objects, written in one request.'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, cell, url, text, runsJson, cellsJson, account }) => {
    const args = ['sheets', 'links', 'set', spreadsheetId];
    if (cell) args.push(cell);
    if (url) args.push(url);
    if (text) args.push(text);
    if (runsJson) args.push(`--runs-json=${runsJson}`);
    if (cellsJson) args.push(`--cells-json=${cellsJson}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_validation_get', {
    description: 'Read the data-validation rules (dropdowns, checkboxes, number/date conditions, custom formulas) applied to a range.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to inspect (e.g. Sheet1!A1:A10)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    return runOrDiagnose(['sheets', 'validation', 'get', spreadsheetId, range], { account });
  });

  server.registerTool('gog_sheets_validation_set', {
    description: 'Set a data-validation rule on a range — dropdowns (ONE_OF_LIST / ONE_OF_RANGE), checkboxes (BOOLEAN), number/date conditions, or custom formulas. Overwrites any existing rule on the range. Repeat values for list entries or between-bounds.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to apply the rule to (e.g. Sheet1!A1:A10)'),
      type: z.string().describe('Condition type, e.g. ONE_OF_LIST, ONE_OF_RANGE, NUMBER_BETWEEN, NUMBER_GREATER, DATE_AFTER, BOOLEAN, CUSTOM_FORMULA'),
      values: z.array(z.string()).optional().describe('Condition values (repeatable): list entries for ONE_OF_LIST, two bounds for *_BETWEEN, a range for ONE_OF_RANGE, a formula for CUSTOM_FORMULA'),
      strict: z.boolean().optional().describe('Reject invalid input instead of showing a warning'),
      inputMessage: z.string().optional().describe('Message shown when the cell is selected'),
      showCustomUi: z.boolean().optional().describe('Show dropdown or checkbox UI where supported'),
      filteredRowsIncluded: z.boolean().optional().describe('Apply the rule to filtered rows too; required for table-managed dropdown columns'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, type, values, strict, inputMessage, showCustomUi, filteredRowsIncluded, account }) => {
    const args = ['sheets', 'validation', 'set', spreadsheetId, range, `--type=${type}`];
    if (values) for (const v of values) args.push(`--value=${v}`);
    if (strict) args.push('--strict');
    if (inputMessage) args.push(`--input-message=${inputMessage}`);
    if (showCustomUi) args.push('--show-custom-ui');
    if (filteredRowsIncluded) args.push('--filtered-rows-included');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_validation_clear', {
    description: 'Remove all data-validation rules from a range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to clear (e.g. Sheet1!A1:A10)'),
      filteredRowsIncluded: z.boolean().optional().describe('Clear rules from filtered rows too; required for table-managed dropdown columns'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, filteredRowsIncluded, account }) => {
    const args = ['sheets', 'validation', 'clear', spreadsheetId, range];
    if (filteredRowsIncluded) args.push('--filtered-rows-included');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_delete_dimension', {
    description: 'Delete a span of rows or columns, table-aware: intersecting table objects are preserved (shrunk) along with their remaining data, instead of being corrupted as with a raw DeleteDimension batch update. Target by A1 range (e.g. Sheet1!5:7 or Sheet1!C:D) or by sheet name plus start/end.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      rangeOrSheet: z.string().describe('A1 range covering the rows/columns to delete, or a sheet name (then start/end are required)'),
      dimension: z.enum(['ROWS', 'COLUMNS']).describe('Dimension to delete'),
      start: z.number().int().optional().describe('First row/column to delete (1-based, inclusive; required with a sheet-name target)'),
      end: z.number().int().optional().describe('Last row/column to delete (1-based, inclusive; required with a sheet-name target)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, rangeOrSheet, dimension, start, end, account }) => {
    const args = ['sheets', 'delete-dimension', spreadsheetId, rangeOrSheet, `--dimension=${dimension}`];
    if (start !== undefined) args.push(`--start=${start}`);
    if (end !== undefined) args.push(`--end=${end}`);
    args.push('--force'); // gog gates this op; without --force the runner's --no-input makes it refuse
    return runOrDiagnose(args, { account });
  });

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

  server.registerTool('gog_sheets_batch_update', {
    description: 'Update values in multiple ranges with one Sheets API request. dataJson is a JSON array of {range, values} objects — pass it inline as a literal JSON string. Atomic — either all ranges update or none do. (The CLI also accepts "@/path/to/file.json", but that file is read on the gog server\'s filesystem, not the caller\'s, so inline JSON is the right form for remote MCP callers.)',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      dataJson: z.string().describe('Value ranges as an inline JSON array, e.g. [{"range":"Sheet1!A1:B2","values":[["a","b"]]}]. (An "@/path" form is read on the gog server filesystem, not yours — inline the JSON instead.)'),
      input: z.enum(['RAW', 'USER_ENTERED']).optional().describe('Value input option (default: USER_ENTERED)'),
      includeValuesInResponse: z.boolean().optional().describe('Include updated values in the response'),
      responseRender: z.enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA']).optional().describe('Response value render option'),
      responseDateTimeRender: z.enum(['SERIAL_NUMBER', 'FORMATTED_STRING']).optional().describe('Response date/time render option'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, dataJson, input, includeValuesInResponse, responseRender, responseDateTimeRender, account }) => {
    const args = ['sheets', 'batch-update', spreadsheetId, `--data-json=${dataJson}`];
    if (input) args.push(`--input=${input}`);
    if (includeValuesInResponse) args.push('--include-values-in-response');
    if (responseRender) args.push(`--response-render=${responseRender}`);
    if (responseDateTimeRender) args.push(`--response-date-time-render=${responseDateTimeRender}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_reorder_tab', {
    description: 'Move a tab to a specific 0-based position. `tab` is the tab name or numeric sheetId; `to=0` is the leftmost slot.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tab: z.string().describe('Target tab by name or numeric sheet ID'),
      to: z.number().int().min(0).describe('Destination final 0-based tab index'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tab, to, account }) => {
    return runOrDiagnose(
      ['sheets', 'reorder-tab', spreadsheetId, `--tab=${tab}`, `--to=${to}`],
      { account },
    );
  });

  // ---- Charts (gog 0.19.0) ----

  server.registerTool('gog_sheets_chart_list', {
    description: 'List embedded charts in a spreadsheet (chartId, type, position).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    return runOrDiagnose(['sheets', 'chart', 'list', spreadsheetId], { account });
  });

  server.registerTool('gog_sheets_chart_get', {
    description: 'Get the full definition (spec + position) of a single chart by its numeric chart ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      chartId: z.string().describe('Numeric chart ID (from gog_sheets_chart_list)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, chartId, account }) => {
    return runOrDiagnose(['sheets', 'chart', 'get', spreadsheetId, chartId], { account });
  });

  server.registerTool('gog_sheets_chart_create', {
    description: 'Create an embedded chart from a JSON spec. specJson is a Sheets API ChartSpec (or full EmbeddedChart) — inline or @/path/to/file.json. Anchor the chart with sheet + anchor (A1 cell), and optionally size it with width/height pixels.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      specJson: z.string().describe('ChartSpec or EmbeddedChart JSON (inline or @file)'),
      sheet: z.string().optional().describe('Sheet name for the anchor (resolved to sheetId)'),
      anchor: z.string().optional().describe('Anchor cell in A1 notation (e.g. A1, E10)'),
      width: z.number().optional().describe('Chart width in pixels (default: 600)'),
      height: z.number().optional().describe('Chart height in pixels (default: 371)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, specJson, sheet, anchor, width, height, account }) => {
    const args = ['sheets', 'chart', 'create', spreadsheetId, `--spec-json=${specJson}`];
    if (sheet) args.push(`--sheet=${sheet}`);
    if (anchor) args.push(`--anchor=${anchor}`);
    if (width !== undefined) args.push(`--width=${width}`);
    if (height !== undefined) args.push(`--height=${height}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_chart_update', {
    description: 'Replace a chart spec by chart ID. specJson is a Sheets API ChartSpec (or full EmbeddedChart) — inline or @/path/to/file.json.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      chartId: z.string().describe('Numeric chart ID to update'),
      specJson: z.string().describe('ChartSpec or EmbeddedChart JSON (inline or @file)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, chartId, specJson, account }) => {
    return runOrDiagnose(
      ['sheets', 'chart', 'update', spreadsheetId, chartId, `--spec-json=${specJson}`],
      { account },
    );
  });

  server.registerTool('gog_sheets_chart_delete', {
    description: 'Delete a chart by its numeric chart ID.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      chartId: z.string().describe('Numeric chart ID to delete'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, chartId, account }) => {
    return runOrDiagnose(['sheets', 'chart', 'delete', spreadsheetId, chartId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  // ---- Tables (gog 0.19.0) ----

  server.registerTool('gog_sheets_table_list', {
    description: 'List Google Sheets tables in a spreadsheet (tableId, name, range).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    return runOrDiagnose(['sheets', 'table', 'list', spreadsheetId], { account });
  });

  server.registerTool('gog_sheets_table_get', {
    description: 'Get a single Google Sheets table (definition + columns) by its table ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tableId: z.string().describe('Table ID (from gog_sheets_table_list)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tableId, account }) => {
    return runOrDiagnose(['sheets', 'table', 'get', spreadsheetId, tableId], { account });
  });

  server.registerTool('gog_sheets_table_create', {
    description: 'Create a Google Sheets table over a range. columnsJson is a JSON array of column definitions (each {columnName, columnType?}); valid columnType values: TEXT, DOUBLE, BOOLEAN, DATE, DROPDOWN. Inline JSON or @/path/to/file.json.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range the table covers (e.g. Sheet1!A1:D20)'),
      name: z.string().describe('Table name'),
      columnsJson: z.string().describe('Column definitions as JSON array or @file (columnName + optional columnType)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, name, columnsJson, account }) => {
    return runOrDiagnose(
      ['sheets', 'table', 'create', spreadsheetId, range, `--name=${name}`, `--columns-json=${columnsJson}`],
      { account },
    );
  });

  server.registerTool('gog_sheets_table_append', {
    description: 'Append data rows to a table. valuesJson is a JSON 2D array of row values.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tableId: z.string().describe('Table ID to append to'),
      valuesJson: z.string().describe('Values as JSON 2D array (e.g. [["a",1],["b",2]])'),
      input: z.enum(['RAW', 'USER_ENTERED']).optional().describe('Value input option (default: USER_ENTERED)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tableId, valuesJson, input, account }) => {
    const args = ['sheets', 'table', 'append', spreadsheetId, tableId, `--values-json=${valuesJson}`];
    if (input) args.push(`--input=${input}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_table_clear', {
    description: 'Clear all data rows from a table (keeps the table and its columns).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tableId: z.string().describe('Table ID to clear'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tableId, account }) => {
    return runOrDiagnose(['sheets', 'table', 'clear', spreadsheetId, tableId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_sheets_table_delete', {
    description:
      'Delete a Google Sheets table. WARNING: the underlying `gog`/Sheets behaviour is that deleting a table also DESTROYS every cell value in the table range — not just the table styling/columns. ' +
      'By default this tool prevents that data loss by emulating the Sheets UI\'s "Convert to range": it reads the table\'s cells (values AND formulas) first, deletes the table, then restores the data into the now-plain range. ' +
      'Formatting and banding are still lost; data-validation dropdowns are also not restored automatically, but you can snapshot them first with gog_sheets_validation_get and re-apply with gog_sheets_validation_set. ' +
      'Set keep_data=false to delete the table AND wipe its cell data (the raw destructive behaviour). To preserve everything, snapshot the whole spreadsheet first with gog_sheets_snapshot.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      tableId: z.string().describe('Table ID to delete'),
      keep_data: z.boolean().optional().describe(
        'Default true: preserve the table\'s cell values and formulas (read → delete → restore), emulating "Convert to range". Set false to delete the table AND its data.',
      ),
      account: accountParam,
    },
  }, async ({ spreadsheetId, tableId, keep_data = true, account }) => {
    if (!keep_data) {
      // Raw destructive delete: removes the table and its cell data. gog ≥ 0.23
      // requires --discard-data to confirm the cell wipe (--force only skips the
      // interactive confirmation; it does not authorize the data loss).
      return runOrDiagnose(['sheets', 'table', 'delete', spreadsheetId, tableId, '--discard-data', '--force'], { account });
    }

    // keep_data: emulate "Convert to range". Read the full table range with
    // formulas intact, then delete, then write the data back. If we can't read
    // the data first, refuse to delete — losing the backup is the whole risk.
    let range: string;
    let values: unknown[][];
    try {
      // `gog sheets table get` wraps the table under a top-level "table" key.
      const parsed = JSON.parse(await run(['sheets', 'table', 'get', spreadsheetId, tableId], { account }));
      range = parsed.table?.a1;
      if (!range) throw new Error(`could not determine the table's range (no "a1" in table get output) for table ${tableId}`);
      const read = JSON.parse(await run(['sheets', 'get', spreadsheetId, range, '--render=FORMULA'], { account }));
      values = read.values ?? [];
    } catch (err) {
      return diagnose(err);
    }

    try {
      // We have already backed up the cells above, so --discard-data (required
      // by gog ≥ 0.23) is the intended path here — we re-write the data right
      // after.
      await run(['sheets', 'table', 'delete', spreadsheetId, tableId, '--discard-data', '--force'], { account });
    } catch (err) {
      // Table not deleted; cell data is untouched.
      return diagnose(err);
    }

    if (values.length > 0) {
      try {
        await run(['sheets', 'update', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`], { account });
      } catch (err) {
        // The table is already gone but the restore write failed. Hand the
        // read-back data straight back so it can be re-applied manually rather
        // than silently lost.
        return rawTextResult(
          `Table ${tableId} was deleted, but restoring its data FAILED — re-apply the values below manually.\n\n` +
          `Range: ${range}\nValues: ${JSON.stringify(values)}\n\n` +
          `${errorText(err)}`,
        );
      }
    }

    return rawTextResult(`Deleted table ${tableId} and preserved ${values.length} row(s) of data (values + formulas) in ${range}.`);
  });

  // ---- Banding / alternating colors (gog 0.19.0) ----

  server.registerTool('gog_sheets_banding_list', {
    description: 'List alternating-color banded ranges. Optionally scope to a single sheet.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      sheet: z.string().optional().describe('Only list banding from this sheet'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, sheet, account }) => {
    const args = ['sheets', 'banding', 'list', spreadsheetId];
    if (sheet) args.push(`--sheet=${sheet}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_banding_set', {
    description: 'Apply alternating colors to a range. Provide rowPropertiesJson and/or columnPropertiesJson — each a Sheets API BandingProperties JSON object ({headerColor, firstBandColor, secondBandColor, footerColor}). At least one is required.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to band (e.g. Sheet1!A1:D20)'),
      rowPropertiesJson: z.string().optional().describe('BandingProperties JSON for row colors'),
      columnPropertiesJson: z.string().optional().describe('BandingProperties JSON for column colors'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, rowPropertiesJson, columnPropertiesJson, account }) => {
    const args = ['sheets', 'banding', 'set', spreadsheetId, range];
    if (rowPropertiesJson) args.push(`--row-properties-json=${rowPropertiesJson}`);
    if (columnPropertiesJson) args.push(`--column-properties-json=${columnPropertiesJson}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_banding_clear', {
    description: 'Remove alternating-color banding. Pass id to remove a single banded range, or all:true with sheet to remove every banding on that sheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      id: z.number().optional().describe('Banded range ID to remove'),
      all: z.boolean().optional().describe('Remove all banding from the sheet (requires sheet)'),
      sheet: z.string().optional().describe('Sheet name (used with all:true)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, id, all, sheet, account }) => {
    const args = ['sheets', 'banding', 'clear', spreadsheetId];
    if (id !== undefined) args.push(`--id=${id}`);
    if (all) args.push('--all');
    if (sheet) args.push(`--sheet=${sheet}`);
    args.push('--force'); // gog gates this op; without --force the runner's --no-input makes it refuse
    return runOrDiagnose(args, { account });
  });

  // ---- Basic filters (gog 0.33.0) ----

  server.registerTool('gog_sheets_filter_set', {
    description: 'Set a basic filter on a range (the filter/sort header Sheets shows on a data range). A sheet can hold one basic filter; replacing an existing one requires replace=true — without it, gog refuses rather than silently overwriting.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range to filter (A1 notation with sheet name, e.g. Sheet1!A1:C100, or a named range name)'),
      replace: z.boolean().optional().describe('Replace the sheet\'s existing basic filter if one is set (appends --force)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, replace, account }) => {
    const args = ['sheets', 'filter', 'set', spreadsheetId, range];
    if (replace) args.push('--force');
    return runOrDiagnose(args, { account });
  });

  // ---- Conditional formatting (gog 0.19.0) ----

  server.registerTool('gog_sheets_conditional_format_list', {
    description: 'List conditional formatting rules. Optionally scope to a single sheet.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      sheet: z.string().optional().describe('Only list rules from this sheet'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, sheet, account }) => {
    const args = ['sheets', 'conditional-format', 'list', spreadsheetId];
    if (sheet) args.push(`--sheet=${sheet}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_conditional_format_add', {
    description: 'Add a conditional formatting rule to a range. Boolean rules: type picks the condition, expr is its value/formula (omit for blank/not-blank), formatJson is the CellFormat to apply when the condition matches (inline or @file); use formatFields to force-send zero/false fields (e.g. backgroundColor,textFormat.bold). Gradient rules (color scales): pass gradientRuleJson instead — a GradientRule JSON with minpoint/maxpoint (and optional midpoint), each {"color":{...},"type":"MIN|MAX|NUMBER|PERCENT|PERCENTILE","value":"..."}. The two modes are mutually exclusive.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range the rule applies to (e.g. Sheet1!A1:A100)'),
      type: z.enum([
        'text-eq', 'text-contains', 'text-starts-with', 'text-ends-with',
        'number-eq', 'number-gt', 'number-gte', 'number-lt', 'number-lte',
        'blank', 'not-blank', 'custom-formula',
      ]).optional().describe('Boolean rule type (required unless gradientRuleJson is used)'),
      formatJson: z.string().optional().describe('CellFormat JSON to apply when a boolean rule matches (inline or @file; required with type)'),
      expr: z.string().optional().describe('Expression value or custom formula (omit for blank/not-blank)'),
      formatFields: z.string().optional().describe('Format field mask for force-sending zero/false fields (e.g. backgroundColor,textFormat.bold)'),
      gradientRuleJson: z.string().optional().describe('GradientRule JSON for gradient conditional formats (inline or @file; must include minpoint and maxpoint)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, type, formatJson, expr, formatFields, gradientRuleJson, account }) => {
    const args = ['sheets', 'conditional-format', 'add', spreadsheetId, range];
    if (type) args.push(`--type=${type}`);
    if (formatJson !== undefined) args.push(`--format-json=${formatJson}`);
    if (expr !== undefined) args.push(`--expr=${expr}`);
    if (formatFields) args.push(`--format-fields=${formatFields}`);
    if (gradientRuleJson !== undefined) args.push(`--gradient-rule-json=${gradientRuleJson}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_conditional_format_clear', {
    description: 'Remove conditional formatting rules from a sheet. Pass index to remove a single rule by its 0-based index, or all:true to remove every rule on the sheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      sheet: z.string().describe('Sheet name to clear rules from'),
      index: z.number().optional().describe('0-based rule index to remove'),
      all: z.boolean().optional().describe('Remove all conditional formatting rules from the sheet'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, sheet, index, all, account }) => {
    const args = ['sheets', 'conditional-format', 'clear', spreadsheetId, `--sheet=${sheet}`];
    if (index !== undefined) args.push(`--index=${index}`);
    if (all) args.push('--all');
    args.push('--force'); // gog gates this op; without --force the runner's --no-input makes it refuse
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_snapshot', {
    description:
      'Make a backup copy of an entire spreadsheet — a one-call safety snapshot to take BEFORE a risky or destructive edit (table delete, bulk clear, large rewrite). ' +
      'Returns the new copy\'s file ID and URL; if the edit goes wrong, restore by copying the backup back or sharing it. The copy is independent — later edits to the original do not affect it.',
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID to back up'),
      name: z.string().describe('Name for the backup copy, e.g. "Budget — backup before table delete"'),
      parent: z.string().optional().describe('Destination folder ID for the copy (default: same location as the original)'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, name, parent, account }) => {
    const args = ['drive', 'copy', spreadsheetId, name];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

}
