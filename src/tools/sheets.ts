import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';

const accountParam = z.string().optional().describe(
  'Google account email to use (overrides GOG_ACCOUNT env var)',
);

function toText(output: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: output }] };
}

// On failure, appends `gog auth list` output so Claude can see which accounts
// are configured and suggest the right one.
async function runOrDiagnose(
  args: string[],
  options: { account?: string },
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  try {
    return toText(await run(args, options));
  } catch (err) {
    const errorText = err instanceof Error ? `Error: ${err.message}` : String(err);
    try {
      const accounts = await run(['auth', 'list']);
      return toText(`${errorText}\n\nConfigured accounts:\n${accounts}`);
    } catch {
      return toText(errorText);
    }
  }
}

export function registerSheetsTools(server: McpServer): void {
  server.registerTool('gog_sheets_get', {
    description: 'Read values from a Google Sheets range. Returns a JSON object with a "values" array of rows. Run `gog sheets get --help` for all available flags.',
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
    description: 'Write values to a Google Sheets range, overwriting existing content. Run `gog sheets update --help` for all available flags.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Top-left cell or range in A1 notation, e.g. Sheet1!A1'),
      values: z.array(z.array(z.string())).describe('2D array of values: outer array is rows, inner is columns'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account }) => {
    return runOrDiagnose(
      ['sheets', 'update', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`],
      { account },
    );
  });

  server.registerTool('gog_sheets_append', {
    description: 'Append rows to a Google Sheet after the last row with data in the given range. Run `gog sheets append --help` for all available flags.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID (from the URL)'),
      range: z.string().describe('Range indicating which sheet/columns to append to, e.g. Sheet1!A:C'),
      values: z.array(z.array(z.string())).describe('2D array of rows to append'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, values, account }) => {
    return runOrDiagnose(
      ['sheets', 'append', spreadsheetId, range, `--values-json=${JSON.stringify(values)}`],
      { account },
    );
  });

  server.registerTool('gog_sheets_clear', {
    description: 'Clear all values in a Google Sheets range (formatting is preserved). Run `gog sheets clear --help` for all available flags.',
    annotations: { destructiveHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      range: z.string().describe('Range in A1 notation to clear'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, range, account }) => {
    return runOrDiagnose(['sheets', 'clear', spreadsheetId, range], { account });
  });

  server.registerTool('gog_sheets_metadata', {
    description: 'Get spreadsheet metadata: title, sheet tabs, named ranges, and other properties. Run `gog sheets metadata --help` for all available flags.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      spreadsheetId: z.string().describe('Spreadsheet ID'),
      account: accountParam,
    },
  }, async ({ spreadsheetId, account }) => {
    return runOrDiagnose(['sheets', 'metadata', spreadsheetId], { account });
  });

  server.registerTool('gog_sheets_create', {
    description: 'Create a new Google Spreadsheet. Returns JSON with the new spreadsheetId and URL. Run `gog sheets create --help` for all available flags.',
    inputSchema: {
      title: z.string().describe('Title for the new spreadsheet'),
      account: accountParam,
    },
  }, async ({ title, account }) => {
    return runOrDiagnose(['sheets', 'create', title], { account });
  });

  server.registerTool('gog_sheets_find_replace', {
    description: 'Find and replace text across an entire Google Spreadsheet. Run `gog sheets find-replace --help` for all available flags.',
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

  server.registerTool('gog_sheets_run', {
    description: 'Run any gog sheets subcommand not covered by the other tools. Run `gog sheets --help` for the full list of subcommands, or `gog sheets <subcommand> --help` for flags on a specific subcommand.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog sheets subcommand to run, e.g. "freeze", "add-tab", "rename-tab"'),
      args: z.array(z.string()).describe('Additional positional args and flags, e.g. ["<spreadsheetId>", "--rows=1"]'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['sheets', subcommand, ...args], { account });
  });
}
