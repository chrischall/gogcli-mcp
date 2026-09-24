import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerExtraSheetsTools, dataSourceSnapshot, spreadsheetTitle } from '../../src/tools/sheets-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult } from '@chrischall/mcp-utils';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import { pos } from '../../../gogcli-mcp/src/argv.js';
import { resetConfirmTokenState } from '../../../gogcli-mcp/src/send-confirm-token.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return { ...actual, runOrDiagnose: vi.fn() };
});

// Fleet audit 2026-09-24 SEC-6: datasource add / update / refresh each start a
// BigQuery job billed to a project, so each asks first — naming the spreadsheet,
// what is queried and who pays.

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_CONFIRM_MODE;
  resetConfirmTokenState();
});
afterEach(() => { process.env = ORIGINAL_ENV; });

const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);
async function prompted(answer: ElicitResult = { action: 'accept', content: { confirmed: true } }) {
  const seen: ElicitRequest[] = [];
  const harness = await createTestHarness(registerExtraSheetsTools, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const unprompted = () => createTestHarness(registerExtraSheetsTools);

const META = JSON.stringify({ properties: { title: 'Sales dashboard' } });
const DESCRIBE = JSON.stringify({ dataSource: { dataSourceId: 'ds1', spec: { bigQuery: { projectId: 'billing-1', querySpec: { rawQuery: 'SELECT 1' } } } } });
function stub(failing?: string) {
  vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
    const key = args.filter((a): a is string => typeof a === 'string' && !a.startsWith('--')).join(' ');
    if (failing && key.startsWith(failing)) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
    if (key === 'sheets metadata') return rawTextResult(META);
    if (key === 'sheets datasource describe') return rawTextResult(DESCRIBE);
    return rawTextResult('{"ok":true}');
  });
}
const callsTo = (...words: string[]) => vi.mocked(lib.runOrDiagnose).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));

const SHEET = { id: 'sid', title: 'Sales dashboard' };
const CASES = [
  {
    tool: 'gog_sheets_datasource_add',
    args: { spreadsheetId: 'sid', billingProject: 'billing-1', dataset: 'sales', table: 'orders' },
    action: 'sheets.datasource-add',
    details: { spreadsheet: SHEET, billingProject: 'billing-1', table: 'billing-1.sales.orders' },
    write: 'add',
    reads: ['sheets metadata'],
    changed: { table: 'refunds' },
  },
  {
    tool: 'gog_sheets_datasource_update',
    args: { spreadsheetId: 'sid', dataSourceId: 'ds1', query: 'SELECT 2', billingProject: 'billing-2' },
    action: 'sheets.datasource-update',
    details: { spreadsheet: SHEET, dataSourceId: 'ds1', changes: { billingProject: 'billing-2', query: 'SELECT 2' } },
    write: 'update',
    reads: ['sheets metadata'],
    changed: { query: 'SELECT 3' },
  },
  {
    tool: 'gog_sheets_datasource_refresh',
    args: { spreadsheetId: 'sid', dataSourceId: 'ds1', forceRefresh: true },
    action: 'sheets.datasource-refresh',
    details: { spreadsheet: SHEET, dataSourceId: 'ds1', billingProject: 'billing-1', query: 'SELECT 1', forceRefresh: true },
    write: 'refresh',
    reads: ['sheets datasource describe', 'sheets metadata'],
    changed: { forceRefresh: false },
  },
];

describe.each(CASES)('$tool', (c) => {
  it('asks naming the spreadsheet, the source and who pays; runs once accepted', async () => {
    stub();
    const { harness, details, seen } = await prompted();
    await harness.callTool(c.tool, c.args);
    expect(seen[0]!.params.message).toMatch(/billed/);
    expect(details()).toEqual(c.details);
    expect(callsTo('sheets', 'metadata')[0]![0]).toEqual(['sheets', 'metadata', pos('sid'), '--select=properties.title']);
    expect(callsTo('sheets', 'datasource', c.write)).toHaveLength(1);
  });

  it('runs nothing when the user declines', async () => {
    stub();
    expect(json(await (await prompted({ action: 'decline' })).harness.callTool(c.tool, c.args)))
      .toMatchObject({ cancelled: true, action: c.action });
    expect(callsTo('sheets', 'datasource', c.write)).toHaveLength(0);
  });

  it.each(c.reads)('returns a failed read (%s) without asking or running', async (failing) => {
    stub(failing);
    const { harness, seen } = await prompted();
    expect((await harness.callTool(c.tool, c.args)).isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(callsTo('sheets', 'datasource', c.write)).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stub();
    const r = json(await (await unprompted()).callTool(c.tool, c.args));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: c.action });
    expect(r.note).toMatch(/Data connectors/);
  });

  it('token fallback: changed arguments are refused, the same call runs', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub();
    const harness = await unprompted();
    const p1 = json(await harness.callTool(c.tool, c.args));
    expect(p1.preview).toEqual(c.details);
    expect(json(await harness.callTool(c.tool, { ...c.args, ...c.changed, confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    await harness.callTool(c.tool, { ...c.args, confirmToken: p1.confirmToken });
    expect(callsTo('sheets', 'datasource', c.write)).toHaveLength(1);
  });
});

it('a query-backed add previews the SQL', async () => {
  stub();
  const { harness, details } = await prompted({ action: 'decline' });
  await harness.callTool('gog_sheets_datasource_add', { spreadsheetId: 'sid', billingProject: 'b', query: 'SELECT 9', });
  expect(details()).toEqual({ spreadsheet: SHEET, billingProject: 'b', query: 'SELECT 9' });
});

it('a table in another project names that project', async () => {
  stub();
  const { harness, details } = await prompted({ action: 'decline' });
  await harness.callTool('gog_sheets_datasource_add', { spreadsheetId: 'sid', billingProject: 'b', tableProject: 'p', dataset: 'd', table: 't' });
  expect(details().table).toBe('p.d.t');
});

describe('parsers', () => {
  it('spreadsheetTitle reads either shape and tolerates unreadable output', () => {
    expect(spreadsheetTitle(JSON.stringify({ spreadsheet: { properties: { title: 'A' } } }))).toBe('A');
    expect(spreadsheetTitle(JSON.stringify({ properties: { title: 7 } }))).toBeUndefined();
    expect(spreadsheetTitle('null')).toBeUndefined();
    expect(spreadsheetTitle(undefined)).toBeUndefined();
  });

  it('dataSourceSnapshot names a table source, a bare spec, and nothing for unreadable output', () => {
    expect(dataSourceSnapshot(JSON.stringify({ spec: { bigQuery: { tableSpec: { tableProjectId: 'p', datasetId: 'd', tableId: 't' } } } })))
      .toEqual({ table: 'p.d.t' });
    expect(dataSourceSnapshot(JSON.stringify({ dataSource: { spec: { bigQuery: { projectId: 7 } } } }))).toEqual({});
    expect(dataSourceSnapshot('null')).toEqual({});
    expect(dataSourceSnapshot('nope')).toEqual({});
  });
});
