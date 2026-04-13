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

  it('appends auth list on failure when auth list succeeds', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Spreadsheet not found'))
      .mockResolvedValueOnce('user@gmail.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Spreadsheet not found\n\nConfigured accounts:\nuser@gmail.com');
  });

  it('returns plain error text when auth list also fails', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Spreadsheet not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Spreadsheet not found');
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce('raw error string')
      .mockRejectedValueOnce(new Error('auth list failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_get')!({ spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('raw error string');
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

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_update')!({ spreadsheetId: 'bad', range: 'A1', values: [['x']] });
    expect(result.content[0].text).toBe('Error: Update failed');
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

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Append failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_append')!({ spreadsheetId: 'bad', range: 'A1', values: [['x']] });
    expect(result.content[0].text).toBe('Error: Append failed');
  });
});

describe('gog_sheets_clear', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_clear')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:Z100' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'clear', 'sid', 'Sheet1!A1:Z100'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Clear failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_clear')!({ spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Clear failed');
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

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_metadata')!({ spreadsheetId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_sheets_create', () => {
  it('calls run with title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"spreadsheetId":"newid","title":"Budget 2026"}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_create')!({ title: 'Budget 2026' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'create', 'Budget 2026'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_create')!({ title: 'Bad' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_sheets_find_replace', () => {
  it('calls run with find and replace args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"occurrencesChanged":3}');
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_find_replace')!({ spreadsheetId: 'sid', find: 'foo', replace: 'bar' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'find-replace', 'sid', 'foo', 'bar'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Replace failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_find_replace')!({ spreadsheetId: 'bad', find: 'x', replace: 'y' });
    expect(result.content[0].text).toBe('Error: Replace failed');
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

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_sheets_run')!({ subcommand: 'freeze', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
