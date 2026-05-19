import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraSheetsTools } from '../../src/tools/sheets-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupHandlers as setupHandlersBase, toText } from '../../../gogcli-mcp/tests/helpers/test-harness.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

const setupHandlers = () => setupHandlersBase(registerExtraSheetsTools);

beforeEach(() => vi.clearAllMocks());

// 1. add-tab
describe('gog_sheets_add_tab', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_add_tab')!({ spreadsheetId: 'sid', tabName: 'NewTab' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'add-tab', 'sid', 'NewTab'], { account: undefined });
  });

  it('forwards account', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_add_tab')!({ spreadsheetId: 'sid', tabName: 'T', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'add-tab', 'sid', 'T'], { account: 'a@b.com' });
  });
});

// 2. delete-tab
describe('gog_sheets_delete_tab', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_delete_tab')!({ spreadsheetId: 'sid', tabName: 'OldTab' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'delete-tab', 'sid', 'OldTab'], { account: undefined });
  });
});

// 3. rename-tab
describe('gog_sheets_rename_tab', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_rename_tab')!({ spreadsheetId: 'sid', oldName: 'Old', newName: 'New' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'rename-tab', 'sid', 'Old', 'New'], { account: undefined });
  });
});

// 4. copy
describe('gog_sheets_copy', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_copy')!({ spreadsheetId: 'sid', title: 'Copy' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'copy', 'sid', 'Copy'], { account: undefined });
  });

  it('includes --parent when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_copy')!({ spreadsheetId: 'sid', title: 'Copy', parent: 'folderId' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'copy', 'sid', 'Copy', '--parent=folderId'], { account: undefined });
  });
});

// 5. export
describe('gog_sheets_export', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_export')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'export', 'sid'], { account: undefined });
  });

  it('includes --format and --out when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_export')!({ spreadsheetId: 'sid', format: 'pdf', out: '/tmp/out.pdf' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'export', 'sid', '--format=pdf', '--out=/tmp/out.pdf'], { account: undefined });
  });
});

// 6. freeze
describe('gog_sheets_freeze', () => {
  it('calls runOrDiagnose with no optional flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_freeze')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'freeze', 'sid'], { account: undefined });
  });

  it('includes --rows, --cols, --sheet when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_freeze')!({ spreadsheetId: 'sid', rows: 1, cols: 2, sheet: 'Data' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'freeze', 'sid', '--rows=1', '--cols=2', '--sheet=Data'], { account: undefined });
  });

  it('includes --rows=0 when rows is 0', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_freeze')!({ spreadsheetId: 'sid', rows: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'freeze', 'sid', '--rows=0'], { account: undefined });
  });
});

// 7. insert
describe('gog_sheets_insert', () => {
  it('calls runOrDiagnose with required args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'Sheet1', dimension: 'ROWS', start: 5 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'Sheet1', 'ROWS', '5'], { account: undefined });
  });

  it('includes --count and --after when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'COLUMNS', start: 0, count: 3, after: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'COLUMNS', '0', '--count=3', '--after'], { account: undefined });
  });

  it('includes --count=0 when count is 0', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'ROWS', start: 0, count: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'ROWS', '0', '--count=0'], { account: undefined });
  });

  it('omits --after when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'ROWS', start: 0, after: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'ROWS', '0'], { account: undefined });
  });
});

// 8. merge
describe('gog_sheets_merge', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_merge')!({ spreadsheetId: 'sid', range: 'A1:C3' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'merge', 'sid', 'A1:C3'], { account: undefined });
  });

  it('includes --type when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_merge')!({ spreadsheetId: 'sid', range: 'A1:C3', type: 'MERGE_COLUMNS' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'merge', 'sid', 'A1:C3', '--type=MERGE_COLUMNS'], { account: undefined });
  });
});

// 9. unmerge
describe('gog_sheets_unmerge', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_unmerge')!({ spreadsheetId: 'sid', range: 'A1:C3' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'unmerge', 'sid', 'A1:C3'], { account: undefined });
  });
});

// 10. format
describe('gog_sheets_format', () => {
  it('passes raw formatJson + formatFields through unchanged (escape hatch)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    const fj = '{"textFormat":{"bold":true}}';
    await handlers.get('gog_sheets_format')!({ spreadsheetId: 'sid', range: 'A1:B2', formatJson: fj, formatFields: 'textFormat.bold' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'format', 'sid', 'A1:B2', `--format-json=${fj}`, '--format-fields=textFormat.bold'],
      { account: undefined },
    );
  });

  it('passes raw formatJson without formatFields', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_format')!({ spreadsheetId: 'sid', range: 'A1', formatJson: '{}' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'format', 'sid', 'A1', '--format-json={}'],
      { account: undefined },
    );
  });

  it('composes named flags into CellFormat JSON + auto-computed fields', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_format')!({
      spreadsheetId: 'sid', range: 'A1:C3',
      bold: true,
      backgroundColor: '#FFF5D9',
      wrapStrategy: 'WRAP',
      verticalAlignment: 'TOP',
    });
    const call = vi.mocked(lib.runOrDiagnose).mock.calls[0]!;
    const argv = call[0];
    expect(argv[0]).toBe('sheets');
    expect(argv[1]).toBe('format');
    expect(argv[2]).toBe('sid');
    expect(argv[3]).toBe('A1:C3');
    const fmtArg = (argv[4] as string).replace(/^--format-json=/, '');
    const parsed = JSON.parse(fmtArg);
    expect(parsed.textFormat.bold).toBe(true);
    expect(parsed.backgroundColor.red).toBeCloseTo(1.0);
    expect(parsed.backgroundColor.green).toBeCloseTo(245 / 255);
    expect(parsed.backgroundColor.blue).toBeCloseTo(217 / 255);
    expect(parsed.wrapStrategy).toBe('WRAP');
    expect(parsed.verticalAlignment).toBe('TOP');
    const fieldsArg = argv[5] as string;
    expect(fieldsArg).toMatch(/^--format-fields=/);
    expect(fieldsArg).toContain('textFormat.bold');
    expect(fieldsArg).toContain('backgroundColor');
    expect(fieldsArg).toContain('wrapStrategy');
    expect(fieldsArg).toContain('verticalAlignment');
  });

  it('composes all named flags including textColor + alignment', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_format')!({
      spreadsheetId: 'sid', range: 'A1',
      italic: true,
      underline: true,
      strikethrough: true,
      fontSize: 14,
      fontFamily: 'Inter',
      textColor: '#FFF',
      horizontalAlignment: 'CENTER',
    });
    const call = vi.mocked(lib.runOrDiagnose).mock.calls[0]!;
    const fmtArg = (call[0][4] as string).replace(/^--format-json=/, '');
    const parsed = JSON.parse(fmtArg);
    expect(parsed.textFormat.italic).toBe(true);
    expect(parsed.textFormat.underline).toBe(true);
    expect(parsed.textFormat.strikethrough).toBe(true);
    expect(parsed.textFormat.fontSize).toBe(14);
    expect(parsed.textFormat.fontFamily).toBe('Inter');
    expect(parsed.textFormat.foregroundColor.red).toBeCloseTo(1);
    expect(parsed.textFormat.foregroundColor.green).toBeCloseTo(1);
    expect(parsed.textFormat.foregroundColor.blue).toBeCloseTo(1);
    expect(parsed.horizontalAlignment).toBe('CENTER');
  });

  it('rejects bad hex in textColor', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await expect(
      handlers.get('gog_sheets_format')!({ spreadsheetId: 'sid', range: 'A1', textColor: 'not-a-hex' }),
    ).rejects.toThrow(/Invalid textColor/);
  });

  it('rejects bad hex in backgroundColor', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await expect(
      handlers.get('gog_sheets_format')!({ spreadsheetId: 'sid', range: 'A1', backgroundColor: 'orange' }),
    ).rejects.toThrow(/Invalid backgroundColor/);
  });

  it('rejects no-op calls with neither flags nor formatJson', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await expect(
      handlers.get('gog_sheets_format')!({ spreadsheetId: 'sid', range: 'A1' }),
    ).rejects.toThrow(/requires at least one named flag/);
  });

  it('honors caller-provided formatFields when also using named flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_format')!({
      spreadsheetId: 'sid', range: 'A1',
      bold: true,
      formatFields: 'textFormat.bold,textFormat.italic',
    });
    const call = vi.mocked(lib.runOrDiagnose).mock.calls[0]!;
    expect(call[0][5]).toBe('--format-fields=textFormat.bold,textFormat.italic');
  });
});

describe('gog_sheets_list_tabs', () => {
  it('uses metadata with a --select projection', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_list_tabs')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'metadata', 'sid', '--select=sheets.properties.sheetId,sheets.properties.title,sheets.properties.index,sheets.properties.gridProperties'],
      { account: undefined },
    );
  });
});

// 11. number-format
describe('gog_sheets_number_format', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A10' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'number-format', 'sid', 'A1:A10'], { account: undefined });
  });

  it('includes --type and --pattern when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1', type: 'CURRENCY', pattern: '#,##0.00' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'number-format', 'sid', 'A1', '--type=CURRENCY', '--pattern=#,##0.00'], { account: undefined });
  });
});

// 12. read-format
describe('gog_sheets_read_format', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_read_format')!({ spreadsheetId: 'sid', range: 'A1:B2' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'read-format', 'sid', 'A1:B2'], { account: undefined });
  });

  it('includes --effective when true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_read_format')!({ spreadsheetId: 'sid', range: 'A1', effective: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'read-format', 'sid', 'A1', '--effective'], { account: undefined });
  });

  it('omits --effective when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_read_format')!({ spreadsheetId: 'sid', range: 'A1', effective: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'read-format', 'sid', 'A1'], { account: undefined });
  });
});

// 13. resize-columns
describe('gog_sheets_resize_columns', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_resize_columns')!({ spreadsheetId: 'sid', columns: 'A:C' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'resize-columns', 'sid', 'A:C'], { account: undefined });
  });

  it('includes --width and --auto when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_resize_columns')!({ spreadsheetId: 'sid', columns: 'A:C', width: 200, auto: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'resize-columns', 'sid', 'A:C', '--width=200', '--auto'], { account: undefined });
  });

  it('includes --width=0 when width is 0', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_resize_columns')!({ spreadsheetId: 'sid', columns: 'A:A', width: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'resize-columns', 'sid', 'A:A', '--width=0'], { account: undefined });
  });
});

// 14. resize-rows
describe('gog_sheets_resize_rows', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_resize_rows')!({ spreadsheetId: 'sid', rows: '1:10' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'resize-rows', 'sid', '1:10'], { account: undefined });
  });

  it('includes --height and --auto when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_resize_rows')!({ spreadsheetId: 'sid', rows: '1:5', height: 40, auto: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'resize-rows', 'sid', '1:5', '--height=40', '--auto'], { account: undefined });
  });

  it('includes --height=0 when height is 0', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_resize_rows')!({ spreadsheetId: 'sid', rows: '1:1', height: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'resize-rows', 'sid', '1:1', '--height=0'], { account: undefined });
  });
});

// 15. notes
describe('gog_sheets_notes', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_notes')!({ spreadsheetId: 'sid', range: 'A1:B5' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'notes', 'sid', 'A1:B5'], { account: undefined });
  });
});

// 16. update-note
describe('gog_sheets_update_note', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_update_note')!({ spreadsheetId: 'sid', range: 'A1', note: 'Hello' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'update-note', 'sid', 'A1', '--note=Hello'], { account: undefined });
  });

  it('passes empty string to clear note', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_update_note')!({ spreadsheetId: 'sid', range: 'A1', note: '' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'update-note', 'sid', 'A1', '--note='], { account: undefined });
  });
});

// 17. links
describe('gog_sheets_links', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_links')!({ spreadsheetId: 'sid', range: 'A1:Z100' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'links', 'sid', 'A1:Z100'], { account: undefined });
  });
});

// 18. named-ranges list
describe('gog_sheets_named_ranges_list', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_named_ranges_list')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'named-ranges', 'list', 'sid'], { account: undefined });
  });
});

// 19. named-ranges get
describe('gog_sheets_named_ranges_get', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_named_ranges_get')!({ spreadsheetId: 'sid', nameOrId: 'MyRange' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'named-ranges', 'get', 'sid', 'MyRange'], { account: undefined });
  });
});

// 20. named-ranges add
describe('gog_sheets_named_ranges_add', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_named_ranges_add')!({ spreadsheetId: 'sid', name: 'Totals', range: 'Sheet1!A1:B10' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'named-ranges', 'add', 'sid', 'Totals', 'Sheet1!A1:B10'], { account: undefined });
  });
});

// 21. named-ranges update
describe('gog_sheets_named_ranges_update', () => {
  it('calls runOrDiagnose with no optional flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_named_ranges_update')!({ spreadsheetId: 'sid', nameOrId: 'MyRange' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'named-ranges', 'update', 'sid', 'MyRange'], { account: undefined });
  });

  it('includes --name and --range when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_named_ranges_update')!({ spreadsheetId: 'sid', nameOrId: 'MyRange', name: 'NewName', range: 'Sheet1!C1:D5' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'named-ranges', 'update', 'sid', 'MyRange', '--name=NewName', '--range=Sheet1!C1:D5'], { account: undefined });
  });
});

// 22. named-ranges delete
describe('gog_sheets_named_ranges_delete', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_named_ranges_delete')!({ spreadsheetId: 'sid', nameOrId: 'OldRange' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'named-ranges', 'delete', 'sid', 'OldRange'], { account: undefined });
  });
});
