import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';
import { accountParam, runOrDiagnose, registerRunTool, toText, diagnose } from './utils.js';
import { expandAnchorRange, countNonEmptyCells } from './sheets-a1.js';

// Cell value type: matches what gog sheets --values-json accepts (passed
// straight to the Sheets API as userEnteredValue). Strings starting with
// "=" are treated as formulas by gog's default --input=USER_ENTERED.
const cellValueParam = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// gog sheets update/append/clear all support -n/--dry-run ("Do not make
// changes; print intended actions and exit successfully"). Exposing it gives
// agents a no-op preview before committing a write to a live sheet.
const dryRunParam = z.boolean().optional().describe(
  'Preview the operation without modifying the sheet (gog --dry-run): reports the intended actions and exits without writing.',
);

const failIfNotEmptyParam = z.boolean().optional().describe(
  'Safety guard against silent overwrites: before writing, read the target range and refuse the write if any target cell already holds data. Costs one extra read. Anchor ranges (e.g. "Sheet1!A1") are expanded to the full area your values will cover; explicit and named ranges are checked as-is.',
);

export function registerSheetsTools(server: McpServer): void {
  server.registerTool('gog_sheets_get', {
    description: 'Read values from a Google Sheets range. Returns a JSON object with a "values" array of rows.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Range in A1 notation, e.g. Sheet1!A1:B10 or a named range'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    return runOrDiagnose(['sheets', 'get', spreadsheetId, range], { account });
  });

  server.registerTool('gog_sheets_update', {
    description: 'Write values to a Google Sheets range, overwriting existing content. Values may be strings, numbers, booleans, or null. Strings starting with "=" are interpreted as formulas (e.g. "=SUM(A1:A10)").',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Top-left cell or range in A1 notation, e.g. Sheet1!A1'),
      values: z.array(z.array(cellValueParam)).describe('2D array of values (rows of columns). Cells may be string/number/boolean/null; strings starting with "=" are formulas.'),
      dry_run: dryRunParam,
      fail_if_not_empty: failIfNotEmptyParam,
      fail_on_formula_error: z.boolean().optional().describe('After writing, read the range back and fail if any cell holds a Sheets formula error (#REF!, #DIV/0!, etc.).'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account, dry_run, fail_if_not_empty, fail_on_formula_error }) => {
    const cols = values.reduce((max, row) => Math.max(max, row.length), 0);
    if (fail_if_not_empty && values.length > 0 && cols > 0) {
      const readRange = expandAnchorRange(range, values.length, cols);
      let existing: string;
      try {
        existing = await run(['sheets', 'get', spreadsheetId, readRange], { account });
      } catch (err) {
        // Couldn't read the target — refuse to write rather than risk an
        // overwrite, and diagnose the read failure (auth/transient/etc.) the
        // same way runOrDiagnose would, since this path bypasses it.
        return diagnose(err);
      }
      const occupied = countNonEmptyCells(existing);
      if (occupied !== 0) {
        const detail = occupied < 0
          ? 'could not be verified as empty'
          : `already contains data in ${occupied} cell(s)`;
        return toText(
          `Write aborted (fail_if_not_empty): target range ${readRange} ${detail}. ` +
          'Re-run without fail_if_not_empty to overwrite, or clear it first with gog_sheets_clear.',
        );
      }
    }
    const args = ['sheets', 'update', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`];
    if (dry_run) args.push('--dry-run');
    if (fail_on_formula_error) args.push('--fail-on-formula-error');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_append', {
    description: 'Append rows to a Google Sheet after the last row with data in the given range. Values may be strings, numbers, booleans, or null. Strings starting with "=" are interpreted as formulas.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Range indicating which sheet/columns to append to, e.g. Sheet1!A:C'),
      values: z.array(z.array(cellValueParam)).describe('2D array of rows to append. Cells may be string/number/boolean/null; strings starting with "=" are formulas.'),
      dry_run: dryRunParam,
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account, dry_run }) => {
    const args = ['sheets', 'append', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`];
    if (dry_run) args.push('--dry-run');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_clear', {
    description: 'Clear all values in a Google Sheets range (formatting is preserved).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range in A1 notation to clear'),
      dry_run: dryRunParam,
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account, dry_run }) => {
    const args = ['sheets', 'clear', spreadsheetId, range];
    if (dry_run) args.push('--dry-run');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_sheets_metadata', {
    description: 'Get spreadsheet metadata: title, named ranges, and per-tab properties including grid dimensions (gridProperties.rowCount / columnCount). Use this to learn a sheet\'s current size before writing — a write outside the grid fails.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    return runOrDiagnose(['sheets', 'metadata', spreadsheetId], { account });
  });

  server.registerTool('gog_sheets_create', {
    description: 'Create a new Google Spreadsheet. Returns JSON with the new spreadsheetId and URL.',
    annotations: { destructiveHint: false },
    inputSchema: {
      title: z.string().describe('Title for the new spreadsheet'),
      account: accountParam,
    },
  }, async ({ title, account }) => {
    return runOrDiagnose(['sheets', 'create', title], { account });
  });

  server.registerTool('gog_sheets_find_replace', {
    description: 'Find and replace text across an entire Google Spreadsheet.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      find: z.string().describe('Text to find'),
      replace: z.string().describe('Replacement text'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, find, replace, account }) => {
    return runOrDiagnose(['sheets', 'find-replace', spreadsheetId, find, replace], { account });
  });

  registerRunTool(server, { service: 'sheets', examples: '"freeze", "add-tab", "rename-tab"' });
}
