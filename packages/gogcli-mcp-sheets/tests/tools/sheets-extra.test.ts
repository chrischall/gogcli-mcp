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

  it('shifts start by +1 when after:true so the new dimension lands AFTER start', async () => {
    // Issue #42: with after:true, start=0 means "insert after index 0" — i.e. land at index 1.
    // The MCP must compensate for the CLI's 1-based interpretation by passing start+1.
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'COLUMNS', start: 0, count: 3, after: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'COLUMNS', '1', '--count=3', '--after'], { account: undefined });
  });

  it('issue #42 acceptance: start=28, after:true leaves column 28 untouched (insertion lands at 29)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'COLUMNS', start: 28, after: true, count: 1 });
    // CLI is 1-based; with --after CLI uses startIndex = c.Start, so passing 29 → API startIndex=29.
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'COLUMNS', '29', '--count=1', '--after'], { account: undefined });
  });

  it('includes --count=0 when count is 0', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'ROWS', start: 0, count: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'ROWS', '0', '--count=0'], { account: undefined });
  });

  it('omits --after and does not shift start when after:false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'ROWS', start: 0, after: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'ROWS', '0'], { account: undefined });
  });

  it('passes --inherit-from-before=true when set', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'ROWS', start: 5, after: true, inheritFromBefore: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'ROWS', '6', '--after', '--inherit-from-before=true'], { account: undefined });
  });

  it('passes --inherit-from-before=false to inherit from the following neighbor', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_insert')!({ spreadsheetId: 'sid', sheet: 'S1', dimension: 'ROWS', start: 5, after: true, inheritFromBefore: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'insert', 'sid', 'S1', 'ROWS', '6', '--after', '--inherit-from-before=false'], { account: undefined });
  });
});

describe('gog_sheets_copy_paste', () => {
  it('calls runOrDiagnose with required source/dest', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_copy_paste')!({ spreadsheetId: 'sid', source: 'Sheet1!A2:H71', dest: 'Sheet1!A2:H120' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'copy-paste', 'sid', 'Sheet1!A2:H71', 'Sheet1!A2:H120'], { account: undefined });
  });

  it('appends --type and --transpose when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_copy_paste')!({ spreadsheetId: 'sid', source: 'A1:B2', dest: 'D1:E2', type: 'FORMULA', transpose: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'copy-paste', 'sid', 'A1:B2', 'D1:E2', '--type=FORMULA', '--transpose'], { account: undefined });
  });

  it('forwards account', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_copy_paste')!({ spreadsheetId: 'sid', source: 'A1', dest: 'B1', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'copy-paste', 'sid', 'A1', 'B1'], { account: 'a@b.com' });
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

  // Issue #43: warn when DATE/DATE_TIME format applied to small integers (silent 1899/1900 render).
  describe('DATE/DATE_TIME small-integer warning', () => {
    it('emits a warning when DATE applied to a range of small integers', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'Sheet1!A1:A3', values: [[1], [2], [3]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:A3', type: 'DATE' });
      // Peek call goes out first.
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'get', 'sid', 'Sheet1!A1:A3', '--render=UNFORMATTED_VALUE'],
        { account: undefined },
      );
      // The format call still happens (warning is non-blocking).
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'number-format', 'sid', 'Sheet1!A1:A3', '--type=DATE'],
        { account: undefined },
      );
      const text = result.content[0].text;
      expect(text).toMatch(/warning/i);
      expect(text).toMatch(/1899|1900|day-serial|small integer/i);
      expect(text).toMatch(/force/);
    });

    it('also warns for DATE_TIME', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'Sheet1!A1:A2', values: [[5], [7]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:A2', type: 'DATE_TIME' });
      expect(result.content[0].text).toMatch(/warning/i);
    });

    it('does not peek or warn when force:true', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{"ok":true}'));
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:A3', type: 'DATE', force: true });
      // Only the format call should fire — no peek.
      expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'number-format', 'sid', 'Sheet1!A1:A3', '--type=DATE'],
        { account: undefined },
      );
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('peeks and warns when force:false is passed explicitly (round-trips the no-force path)', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A3', values: [[1], [2], [3]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'DATE', force: false });
      expect(lib.runOrDiagnose).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toMatch(/warning/i);
    });

    it('does not peek when type is not DATE/DATE_TIME', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{"ok":true}'));
      await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'CURRENCY' });
      expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'number-format', 'sid', 'A1:A3', '--type=CURRENCY'],
        { account: undefined },
      );
    });

    it('does not warn when values include a large integer (>=10000)', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          // 45000 is a real day-serial (year ~2023) — legitimate date value.
          return toText(JSON.stringify({ range: 'A1:A2', values: [[1], [45000]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A2', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('does not warn when values include a negative integer (deltas/error codes, not day-serials)', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A3', values: [[1], [-5], [3]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('does not warn when values include non-integer numbers', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A2', values: [[1], [2.5]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A2', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('does not warn when range has no values (missing values key)', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A3' }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('does not warn when range has empty values array', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A3', values: [] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('does not warn when values are strings', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A2', values: [['hello'], ['world']] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A2', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('ignores null and empty cells when deciding to warn', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          // Real-world: nulls/empty strings interspersed with the ordinal ints.
          return toText(JSON.stringify({ range: 'A1:A4', values: [[1], [null], [''], [3]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A4', type: 'DATE' });
      expect(result.content[0].text).toMatch(/warning/i);
    });

    it('does not warn when every cell is null or empty (no small integers seen)', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1:A3', values: [[null], [''], [null]] }));
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'DATE' });
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('proceeds with format when peek fails (does not block)', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText('Error: something went wrong');
        }
        return toText('{"ok":true}');
      });
      const result = await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1:A3', type: 'DATE' });
      // Format call should still happen.
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'number-format', 'sid', 'A1:A3', '--type=DATE'],
        { account: undefined },
      );
      // No warning emitted when peek didn't yield clear evidence.
      expect(result.content[0].text).not.toMatch(/warning/i);
    });

    it('forwards account on both peek and format calls', async () => {
      const handlers = setupHandlers();
      vi.mocked(lib.runOrDiagnose).mockImplementation(async (args: string[]) => {
        if (args[1] === 'get') {
          return toText(JSON.stringify({ range: 'A1', values: [[1]] }));
        }
        return toText('{}');
      });
      await handlers.get('gog_sheets_number_format')!({ spreadsheetId: 'sid', range: 'A1', type: 'DATE', account: 'a@b.com' });
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'get', 'sid', 'A1', '--render=UNFORMATTED_VALUE'],
        { account: 'a@b.com' },
      );
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['sheets', 'number-format', 'sid', 'A1', '--type=DATE'],
        { account: 'a@b.com' },
      );
    });
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

// 23. batch-update (gog 0.18.0)
describe('gog_sheets_batch_update', () => {
  it('passes --data-json and required spreadsheetId', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    const data = '[{"range":"Sheet1!A1:B1","values":[["a","b"]]}]';
    await handlers.get('gog_sheets_batch_update')!({ spreadsheetId: 'sid', dataJson: data });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'batch-update', 'sid', `--data-json=${data}`],
      { account: undefined },
    );
  });

  it('passes optional --input, --include-values-in-response, --response-render, --response-date-time-render', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_batch_update')!({
      spreadsheetId: 'sid',
      dataJson: '[]',
      input: 'RAW',
      includeValuesInResponse: true,
      responseRender: 'FORMULA',
      responseDateTimeRender: 'FORMATTED_STRING',
      account: 'a@b.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'sheets', 'batch-update', 'sid',
        '--data-json=[]',
        '--input=RAW',
        '--include-values-in-response',
        '--response-render=FORMULA',
        '--response-date-time-render=FORMATTED_STRING',
      ],
      { account: 'a@b.com' },
    );
  });

  it('omits --include-values-in-response when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_batch_update')!({
      spreadsheetId: 'sid', dataJson: '[]', includeValuesInResponse: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'batch-update', 'sid', '--data-json=[]'],
      { account: undefined },
    );
  });
});

// 24. reorder-tab (gog 0.18.0)
describe('gog_sheets_reorder_tab', () => {
  it('passes --tab and --to', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_reorder_tab')!({ spreadsheetId: 'sid', tab: 'Data', to: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'reorder-tab', 'sid', '--tab=Data', '--to=2'],
      { account: undefined },
    );
  });

  it('sends --to=0 explicitly to reach the leftmost position', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_reorder_tab')!({ spreadsheetId: 'sid', tab: '123', to: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'reorder-tab', 'sid', '--tab=123', '--to=0'],
      { account: undefined },
    );
  });

  it('forwards account', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_reorder_tab')!({ spreadsheetId: 'sid', tab: 'Data', to: 1, account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'reorder-tab', 'sid', '--tab=Data', '--to=1'],
      { account: 'a@b.com' },
    );
  });
});

// 25. chart list (gog 0.19.0)
describe('gog_sheets_chart_list', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_list')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'chart', 'list', 'sid'], { account: undefined });
  });

  it('forwards account', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_list')!({ spreadsheetId: 'sid', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'chart', 'list', 'sid'], { account: 'a@b.com' });
  });
});

// 26. chart get
describe('gog_sheets_chart_get', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_get')!({ spreadsheetId: 'sid', chartId: '12345' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'chart', 'get', 'sid', '12345'], { account: undefined });
  });
});

// 27. chart create
describe('gog_sheets_chart_create', () => {
  it('calls runOrDiagnose with only --spec-json', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    const spec = '{"basicChart":{"chartType":"COLUMN"}}';
    await handlers.get('gog_sheets_chart_create')!({ spreadsheetId: 'sid', specJson: spec });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'chart', 'create', 'sid', `--spec-json=${spec}`],
      { account: undefined },
    );
  });

  it('includes --sheet, --anchor, --width, --height when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_create')!({
      spreadsheetId: 'sid', specJson: '{}', sheet: 'Data', anchor: 'E10', width: 800, height: 400,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'chart', 'create', 'sid', '--spec-json={}', '--sheet=Data', '--anchor=E10', '--width=800', '--height=400'],
      { account: undefined },
    );
  });

  it('includes --width=0 and --height=0 when zero', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_create')!({ spreadsheetId: 'sid', specJson: '{}', width: 0, height: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'chart', 'create', 'sid', '--spec-json={}', '--width=0', '--height=0'],
      { account: undefined },
    );
  });
});

// 28. chart update
describe('gog_sheets_chart_update', () => {
  it('calls runOrDiagnose with chartId and --spec-json', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_update')!({ spreadsheetId: 'sid', chartId: '99', specJson: '{}' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'chart', 'update', 'sid', '99', '--spec-json={}'],
      { account: undefined },
    );
  });
});

// 29. chart delete
describe('gog_sheets_chart_delete', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_chart_delete')!({ spreadsheetId: 'sid', chartId: '7' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'chart', 'delete', 'sid', '7'], { account: undefined });
  });
});

// 30. table list
describe('gog_sheets_table_list', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_table_list')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'table', 'list', 'sid'], { account: undefined });
  });
});

// 31. table get
describe('gog_sheets_table_get', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_table_get')!({ spreadsheetId: 'sid', tableId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'table', 'get', 'sid', 't1'], { account: undefined });
  });
});

// 32. table create
describe('gog_sheets_table_create', () => {
  it('calls runOrDiagnose with range, --name, --columns-json', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    const cols = '[{"columnName":"Name","columnType":"TEXT"}]';
    await handlers.get('gog_sheets_table_create')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:B10', name: 'People', columnsJson: cols });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'table', 'create', 'sid', 'Sheet1!A1:B10', '--name=People', `--columns-json=${cols}`],
      { account: undefined },
    );
  });
});

// 33. table append
describe('gog_sheets_table_append', () => {
  it('calls runOrDiagnose with --values-json (no --input)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_table_append')!({ spreadsheetId: 'sid', tableId: 't1', valuesJson: '[["a",1]]' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'table', 'append', 'sid', 't1', '--values-json=[["a",1]]'],
      { account: undefined },
    );
  });

  it('includes --input when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_table_append')!({ spreadsheetId: 'sid', tableId: 't1', valuesJson: '[]', input: 'RAW' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'table', 'append', 'sid', 't1', '--values-json=[]', '--input=RAW'],
      { account: undefined },
    );
  });
});

// 34. table clear
describe('gog_sheets_table_clear', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_table_clear')!({ spreadsheetId: 'sid', tableId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'table', 'clear', 'sid', 't1'], { account: undefined });
  });
});

// 35. table delete
describe('gog_sheets_table_delete', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_table_delete')!({ spreadsheetId: 'sid', tableId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'table', 'delete', 'sid', 't1'], { account: undefined });
  });
});

// 36. banding list
describe('gog_sheets_banding_list', () => {
  it('calls runOrDiagnose with no --sheet', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_list')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'list', 'sid'], { account: undefined });
  });

  it('includes --sheet when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_list')!({ spreadsheetId: 'sid', sheet: 'Data' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'list', 'sid', '--sheet=Data'], { account: undefined });
  });
});

// 37. banding set
describe('gog_sheets_banding_set', () => {
  it('calls runOrDiagnose with range only', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_set')!({ spreadsheetId: 'sid', range: 'Sheet1!A1:D20' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'set', 'sid', 'Sheet1!A1:D20'], { account: undefined });
  });

  it('includes --row-properties-json and --column-properties-json when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_set')!({
      spreadsheetId: 'sid', range: 'A1:D20',
      rowPropertiesJson: '{"firstBandColor":{}}',
      columnPropertiesJson: '{"secondBandColor":{}}',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'banding', 'set', 'sid', 'A1:D20', '--row-properties-json={"firstBandColor":{}}', '--column-properties-json={"secondBandColor":{}}'],
      { account: undefined },
    );
  });
});

// 38. banding clear
describe('gog_sheets_banding_clear', () => {
  it('calls runOrDiagnose with no optional flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_clear')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'clear', 'sid'], { account: undefined });
  });

  it('includes --id when provided (including 0)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_clear')!({ spreadsheetId: 'sid', id: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'clear', 'sid', '--id=0'], { account: undefined });
  });

  it('includes --all and --sheet when clearing a whole sheet', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_clear')!({ spreadsheetId: 'sid', all: true, sheet: 'Data' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'clear', 'sid', '--all', '--sheet=Data'], { account: undefined });
  });

  it('omits --all when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_banding_clear')!({ spreadsheetId: 'sid', all: false, id: 5 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'banding', 'clear', 'sid', '--id=5'], { account: undefined });
  });
});

// 39. conditional-format list
describe('gog_sheets_conditional_format_list', () => {
  it('calls runOrDiagnose with no --sheet', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_list')!({ spreadsheetId: 'sid' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'conditional-format', 'list', 'sid'], { account: undefined });
  });

  it('includes --sheet when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_list')!({ spreadsheetId: 'sid', sheet: 'Data' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'conditional-format', 'list', 'sid', '--sheet=Data'], { account: undefined });
  });
});

// 40. conditional-format add
describe('gog_sheets_conditional_format_add', () => {
  it('calls runOrDiagnose with type and --format-json (no expr/fields)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_add')!({
      spreadsheetId: 'sid', range: 'A1:A100', type: 'not-blank', formatJson: '{"backgroundColor":{}}',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'conditional-format', 'add', 'sid', 'A1:A100', '--type=not-blank', '--format-json={"backgroundColor":{}}'],
      { account: undefined },
    );
  });

  it('includes --expr and --format-fields when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_add')!({
      spreadsheetId: 'sid', range: 'B1:B50', type: 'number-gt', expr: '100', formatJson: '{}', formatFields: 'backgroundColor,textFormat.bold',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'conditional-format', 'add', 'sid', 'B1:B50', '--type=number-gt', '--format-json={}', '--expr=100', '--format-fields=backgroundColor,textFormat.bold'],
      { account: undefined },
    );
  });

  it('includes --expr when it is an empty string', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_add')!({
      spreadsheetId: 'sid', range: 'A1', type: 'text-eq', expr: '', formatJson: '{}',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['sheets', 'conditional-format', 'add', 'sid', 'A1', '--type=text-eq', '--format-json={}', '--expr='],
      { account: undefined },
    );
  });
});

// 41. conditional-format clear
describe('gog_sheets_conditional_format_clear', () => {
  it('calls runOrDiagnose with --sheet only', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_clear')!({ spreadsheetId: 'sid', sheet: 'Data' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'conditional-format', 'clear', 'sid', '--sheet=Data'], { account: undefined });
  });

  it('includes --index when provided (including 0)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_clear')!({ spreadsheetId: 'sid', sheet: 'Data', index: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'conditional-format', 'clear', 'sid', '--sheet=Data', '--index=0'], { account: undefined });
  });

  it('includes --all when true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_clear')!({ spreadsheetId: 'sid', sheet: 'Data', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'conditional-format', 'clear', 'sid', '--sheet=Data', '--all'], { account: undefined });
  });

  it('omits --all when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_sheets_conditional_format_clear')!({ spreadsheetId: 'sid', sheet: 'Data', all: false, index: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['sheets', 'conditional-format', 'clear', 'sid', '--sheet=Data', '--index=2'], { account: undefined });
  });
});
