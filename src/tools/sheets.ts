import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';

const accountParam = z.string().optional().describe(
  'Google account email to use (overrides GOG_ACCOUNT env var)',
);

function toText(output: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: output }] };
}

function toError(err: unknown): { content: [{ type: 'text'; text: string }] } {
  return toText(err instanceof Error ? `Error: ${err.message}` : String(err));
}

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
    try {
      return toText(await run(['sheets', 'get', spreadsheetId, range], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_update', {
    description: 'Write values to a Google Sheets range, overwriting existing content.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Top-left cell or range in A1 notation, e.g. Sheet1!A1'),
      values: z.array(z.array(z.string())).describe('2D array of values: outer array is rows, inner is columns'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account }) => {
    try {
      return toText(await run(
        ['sheets', 'update', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`],
        { account },
      ));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_append', {
    description: 'Append rows to a Google Sheet after the last row with data in the given range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Range indicating which sheet/columns to append to, e.g. Sheet1!A:C'),
      values: z.array(z.array(z.string())).describe('2D array of rows to append'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account }) => {
    try {
      return toText(await run(
        ['sheets', 'append', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`],
        { account },
      ));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_clear', {
    description: 'Clear all values in a Google Sheets range (formatting is preserved).',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range in A1 notation to clear'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    try {
      return toText(await run(['sheets', 'clear', spreadsheetId, range], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_metadata', {
    description: 'Get spreadsheet metadata: title, sheet tabs, named ranges, and other properties.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    try {
      return toText(await run(['sheets', 'metadata', spreadsheetId], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_create', {
    description: 'Create a new Google Spreadsheet. Returns JSON with the new spreadsheetId and URL.',
    annotations: { destructiveHint: true },
    inputSchema: {
      title: z.string().describe('Title for the new spreadsheet'),
      account: accountParam,
    },
  }, async ({ title, account }) => {
    try {
      return toText(await run(['sheets', 'create', title], { account }));
    } catch (err) {
      return toError(err);
    }
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
    try {
      return toText(await run(['sheets', 'find-replace', spreadsheetId, find, replace], { account }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_sheets_run', {
    description: 'Run any gog sheets subcommand not covered by the other tools. See `gog sheets --help` for the full list of subcommands and their flags.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog sheets subcommand to run, e.g. "freeze", "add-tab", "rename-tab"'),
      args: z.array(z.string()).describe('Additional positional args and flags, e.g. ["<spreadsheetId>", "--rows=1"]'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    try {
      return toText(await run(['sheets', subcommand, ...args], { account }));
    } catch (err) {
      return toError(err);
    }
  });
}
