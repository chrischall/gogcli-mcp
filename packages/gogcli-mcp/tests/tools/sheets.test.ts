import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSheetsTools } from '../../src/tools/sheets.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerSheetsTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_sheets_get', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"values":[["a","b"]]}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_get', { spreadsheetId: 'sid', range: 'Sheet1!A1:B2' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'Sheet1!A1:B2'], { account: undefined });
    expect(result.content[0].text).toBe('{"values":[["a","b"]]}');
  });

  it('forwards account override', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_get', { spreadsheetId: 'sid', range: 'A1', account: 'other@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'A1'], { account: 'other@gmail.com' });
  });

  it('appends auth list on failure when auth list succeeds', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Spreadsheet not found'))
      .mockResolvedValueOnce('user@gmail.com');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_get', { spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Spreadsheet not found\n\nConfigured accounts:\nuser@gmail.com');
  });

  it('returns plain error text when auth list also fails', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Spreadsheet not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_get', { spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Spreadsheet not found');
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce('raw error string')
      .mockRejectedValueOnce(new Error('auth list failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_get', { spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('raw error string');
  });
});

describe('gog_sheets_update', () => {
  it('passes values via --values-json flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"updatedCells":2}');
    const harness = await setupHandlers();
    const values = [['hello', 'world']];
    await harness.callTool('gog_sheets_update', { spreadsheetId: 'sid', range: 'A1:B1', values });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'update', 'sid', 'A1:B1', `--values-json=${JSON.stringify(values)}`],
      { account: undefined },
    );
  });

  it('preserves non-string cell types (numbers, booleans, nulls, formulas) in --values-json', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const values = [['Sheet', 'A', 'B', 'C'], ['Row', 1, 2.5, '=A2+B2'], ['Bool', true, false, null]];
    await harness.callTool('gog_sheets_update', { spreadsheetId: 'sid', range: 'A1:D3', values });
    const call = vi.mocked(runner.run).mock.calls[0]!;
    expect(call[0][4]).toBe(`--values-json=${JSON.stringify(values)}`);
    // Spot-check the serialized JSON keeps non-string primitives intact (no stringification)
    expect(call[0][4]).toContain('"=A2+B2"');
    expect(call[0][4]).toContain(',1,');
    expect(call[0][4]).toContain('2.5');
    expect(call[0][4]).toContain('true');
    expect(call[0][4]).toContain('null');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_update', { spreadsheetId: 'bad', range: 'A1', values: [['x']] });
    expect(result.content[0].text).toBe('Error: Update failed');
  });

  it('appends --dry-run when dry_run is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"dryRun":true}');
    const harness = await setupHandlers();
    const values = [['x']];
    await harness.callTool('gog_sheets_update', { spreadsheetId: 'sid', range: 'A1', values, dry_run: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'update', 'sid', 'A1', `--values-json=${JSON.stringify(values)}`, '--dry-run'],
      { account: undefined },
    );
  });

  it('omits --dry-run when dry_run is false or unset', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_update', { spreadsheetId: 'sid', range: 'A1', values: [['x']], dry_run: false });
    expect(vi.mocked(runner.run).mock.calls[0]![0]).not.toContain('--dry-run');
  });

  it('appends --fail-on-formula-error when fail_on_formula_error is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const values = [['=1+1']];
    await harness.callTool('gog_sheets_update', { spreadsheetId: 'sid', range: 'A1', values, fail_on_formula_error: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'update', 'sid', 'A1', `--values-json=${JSON.stringify(values)}`, '--fail-on-formula-error'],
      { account: undefined },
    );
  });
});

describe('gog_sheets_update fail_if_not_empty guard', () => {
  it('aborts the write when the target range already holds data', async () => {
    vi.mocked(runner.run).mockResolvedValueOnce('{"values":[["existing"]]}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [['new']], fail_if_not_empty: true,
    });
    // Only the read happened — no update call.
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'get', 'sid', 'A1:A1'], { account: undefined });
    expect(result.content[0].text).toContain('Write aborted');
    expect(result.content[0].text).toContain('A1:A1');
    expect(result.content[0].text).toContain('1 cell');
  });

  it('proceeds with the write when the target range is empty', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('{"updatedCells":1}');
    const harness = await setupHandlers();
    const values = [['new']];
    const result = await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values, fail_if_not_empty: true,
    });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runner.run).mock.calls[1]![0]).toEqual(
      ['sheets', 'update', 'sid', 'A1', `--values-json=${JSON.stringify(values)}`],
    );
    expect(result.content[0].text).toBe('{"updatedCells":1}');
  });

  it('expands an anchor cell to the full written area before reading', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'Sheet1!A1',
      values: [['a', 'b'], ['c', 'd'], ['e', 'f']], fail_if_not_empty: true,
    });
    expect(vi.mocked(runner.run).mock.calls[0]![0]).toEqual(['sheets', 'get', 'sid', 'Sheet1!A1:B3']);
  });

  it('aborts without writing and diagnoses the error when the verification read fails', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('read boom')) // the verification get
      .mockResolvedValueOnce('{"accounts":[{"email":"u@x.com"}]}'); // diagnose -> auth list
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [['new']], fail_if_not_empty: true,
    });
    // get + auth list (for diagnosis), but the update is never attempted
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runner.run).mock.calls.some((c) => c[0][1] === 'update')).toBe(false);
    expect(result.content[0].text).toContain('Error: read boom');
    expect(result.content[0].text).toContain('Configured accounts:');
  });

  it('surfaces the re-auth hint when the verification read fails with an auth error', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Request failed with status 401'))
      .mockResolvedValueOnce('{"accounts":[{"email":"u@x.com"}]}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [['x']], fail_if_not_empty: true,
    });
    expect(result.content[0].text).toContain('gog_auth_add');
  });

  it('aborts when emptiness cannot be verified from unparseable output', async () => {
    vi.mocked(runner.run).mockResolvedValueOnce('not json');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [['new']], fail_if_not_empty: true,
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('could not be verified');
  });

  it('still honors dry_run after the guard passes', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('{"dryRun":true}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [['new']], fail_if_not_empty: true, dry_run: true,
    });
    expect(vi.mocked(runner.run).mock.calls[1]![0]).toContain('--dry-run');
  });

  it('skips the guard read when values has no rows', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [], fail_if_not_empty: true,
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runner.run).mock.calls[0]![0]![1]).toBe('update');
  });

  it('skips the guard read when rows have no columns', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_update', {
      spreadsheetId: 'sid', range: 'A1', values: [[]], fail_if_not_empty: true,
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runner.run).mock.calls[0]![0]![1]).toBe('update');
  });
});

describe('gog_sheets_append', () => {
  it('passes values via --values-json flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"updates":{}}');
    const harness = await setupHandlers();
    const values = [['r1c1', 'r1c2'], ['r2c1', 'r2c2']];
    await harness.callTool('gog_sheets_append', { spreadsheetId: 'sid', range: 'Sheet1!A:B', values });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'append', 'sid', 'Sheet1!A:B', `--values-json=${JSON.stringify(values)}`],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Append failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_append', { spreadsheetId: 'bad', range: 'A1', values: [['x']] });
    expect(result.content[0].text).toBe('Error: Append failed');
  });

  it('appends --dry-run when dry_run is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"dryRun":true}');
    const harness = await setupHandlers();
    const values = [['x']];
    await harness.callTool('gog_sheets_append', { spreadsheetId: 'sid', range: 'Sheet1!A:A', values, dry_run: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'append', 'sid', 'Sheet1!A:A', `--values-json=${JSON.stringify(values)}`, '--dry-run'],
      { account: undefined },
    );
  });
});

describe('gog_sheets_clear', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_clear', { spreadsheetId: 'sid', range: 'Sheet1!A1:Z100' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'clear', 'sid', 'Sheet1!A1:Z100'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Clear failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_clear', { spreadsheetId: 'bad', range: 'A1' });
    expect(result.content[0].text).toBe('Error: Clear failed');
  });

  it('appends --dry-run when dry_run is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"dryRun":true}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_clear', { spreadsheetId: 'sid', range: 'Sheet1!A1:Z100', dry_run: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['sheets', 'clear', 'sid', 'Sheet1!A1:Z100', '--dry-run'],
      { account: undefined },
    );
  });
});

describe('gog_sheets_metadata', () => {
  it('advertises grid dimensions in its description', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const configs = new Map<string, { description?: string }>();
    vi.spyOn(server, 'registerTool').mockImplementation((name, config) => {
      configs.set(name, config as { description?: string });
      return undefined as never;
    });
    registerSheetsTools(server);
    expect(configs.get('gog_sheets_metadata')!.description).toMatch(/grid dimensions|rowCount|columnCount/i);
  });

  it('calls run with spreadsheetId only', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"title":"My Sheet","sheets":[{"title":"Sheet1"}]}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_metadata', { spreadsheetId: 'sid' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'metadata', 'sid'], { account: undefined });
    expect(result.content[0].text).toContain('My Sheet');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_metadata', { spreadsheetId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_sheets_create', () => {
  it('calls run with title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"spreadsheetId":"newid","title":"Budget 2026"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_create', { title: 'Budget 2026' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'create', 'Budget 2026'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_create', { title: 'Bad' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_sheets_find_replace', () => {
  it('calls run with find and replace args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"occurrencesChanged":3}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_find_replace', { spreadsheetId: 'sid', find: 'foo', replace: 'bar' });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'find-replace', 'sid', 'foo', 'bar'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Replace failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_find_replace', { spreadsheetId: 'bad', find: 'x', replace: 'y' });
    expect(result.content[0].text).toBe('Error: Replace failed');
  });
});

describe('gog_sheets_run', () => {
  it('passes raw subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_run', {
      subcommand: 'freeze',
      args: ['sid', '--rows=1'],
    });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'freeze', 'sid', '--rows=1'], { account: undefined });
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_sheets_run', { subcommand: 'metadata', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['sheets', 'metadata'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_sheets_run', { subcommand: 'freeze', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
