import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSheetsTools } from '../../src/tools/sheets.js';
import * as runner from '../../src/runner.js';

vi.mock('../../src/runner.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerSheetsTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_sheets_get', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"values":[["a","b"]]}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:B2' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'Sheet1!A1:B2'], { account: undefined });
    expect(result.content[0].text).toBe('{"values":[["a","b"]]}');
  });

  it('forwards account override', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_get')!({ spreadsheetId: 'sid', range: 'A1', account: 'other@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'A1'], { account: 'other@gmail.com' });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Spreadsheet not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Spreadsheet not found');
  });
});

describe('gog_sheets_update', () => {
  it('passes values via --values-json flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"updatedCells":2}');
    const handlers = setupHandlers();
    const values = [['hello', 'world']];
    await handlers.get('gog_sheets_update')!({ spreadsheetId: 'sid', range: 'A1:B1', values });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'update', 'sid', 'A1:B1', `--values-json=${JSON.stringify(values)}`],
      { account: undefined },
    );
  });
});

describe('gog_sheets_append', () => {
  it('passes values via --values-json flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"updates":{}}');
    const handlers = setupHandlers();
    const values = [['r1c1', 'r1c2'], ['r2c1', 'r2c2']];
    await handlers.get('gog_sheets_append')!({ spreadsheetId: 'sid', range: 'Sheet1!A:B', values });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'append', 'sid', 'Sheet1!A:B', `--values-json=${JSON.stringify(values)}`],
      { account: undefined },
    );
  });
});

describe('gog_sheets_clear', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_clear')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:Z100' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'clear', 'sid', 'Sheet1!A1:Z100'], { account: undefined });
  });
});

describe('gog_sheets_metadata', () => {
  it('calls run with spreadsheetId only', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"title":"My Sheet","sheets":[{"title":"Sheet1"}]}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_metadata')!({ spreadsheetId: 'sid' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'metadata', 'sid'], { account: undefined });
    expect(result.content[0].text).toContain('My Sheet');
  });
});

describe('gog_sheets_create', () => {
  it('calls run with title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"spreadsheetId":"newid","title":"Budget 2026"}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_create')!({ title: 'Budget 2026' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'create', 'Budget 2026'], { account: undefined });
  });
});

describe('gog_sheets_find_replace', () => {
  it('calls run with find and replace args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"occurrencesChanged":3}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_find_replace')!({ spreadsheetId: 'sid', find: 'foo', replace: 'bar' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'find-replace', 'sid', 'foo', 'bar'], { account: undefined });
  });
});

describe('gog_sheets_run', () => {
  it('passes raw subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_run')!({
      subcommand: 'freeze',
      args: ['sid', '--rows=1'],
    });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'freeze', 'sid', '--rows=1'], { account: undefined });
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_run')!({ subcommand: 'metadata', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'metadata'], { account: undefined });
  });
});
