import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraDocsTools } from '../../src/tools/docs-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupHandlers as setupHandlersBase, toText } from '../../../gogcli-mcp/tests/helpers/test-harness.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

const setupHandlers = () => setupHandlersBase(registerExtraDocsTools);

beforeEach(() => vi.clearAllMocks());

// --- gog_docs_copy ---

describe('gog_docs_copy', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'My Copy' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'My Copy'], { account: undefined });
  });

  it('includes --parent when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'Copy', parent: 'folder123' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'copy', 'abc', 'Copy', '--parent=folder123'],
      { account: undefined },
    );
  });

  it('omits --parent when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'Copy' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'Copy'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'Copy', account: 'other@gmail.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'Copy'], { account: 'other@gmail.com' });
  });
});

// --- gog_docs_delete ---

describe('gog_docs_delete', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete')!({ docId: 'abc', start: 5, end: 10 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'delete', '--start=5', '--end=10', 'abc'],
      { account: undefined },
    );
  });

  it('includes --tab-id when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete')!({ docId: 'abc', start: 1, end: 5, tabId: 'tab1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'delete', '--start=1', '--end=5', 'abc', '--tab-id=tab1'],
      { account: undefined },
    );
  });

  it('omits --tab-id when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete')!({ docId: 'abc', start: 1, end: 5 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'delete', '--start=1', '--end=5', 'abc'],
      { account: undefined },
    );
  });
});

// --- gog_docs_edit ---

describe('gog_docs_edit', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_edit')!({ docId: 'abc', find: 'old', replace: 'new' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'edit', 'abc', 'old', 'new'],
      { account: undefined },
    );
  });

  it('includes --match-case when true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_edit')!({ docId: 'abc', find: 'old', replace: 'new', matchCase: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'edit', 'abc', 'old', 'new', '--match-case'],
      { account: undefined },
    );
  });

  it('omits --match-case when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_edit')!({ docId: 'abc', find: 'old', replace: 'new', matchCase: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'edit', 'abc', 'old', 'new'],
      { account: undefined },
    );
  });
});

// --- gog_docs_export ---

describe('gog_docs_export', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'export', 'abc'], { account: undefined });
  });

  it('includes --format when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc', format: 'html' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'export', 'abc', '--format=html'],
      { account: undefined },
    );
  });

  it('includes --out when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc', out: '/tmp/doc.pdf' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'export', 'abc', '--out=/tmp/doc.pdf'],
      { account: undefined },
    );
  });

  it('includes both --format and --out when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc', format: 'txt', out: '/tmp/doc.txt' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'export', 'abc', '--format=txt', '--out=/tmp/doc.txt'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'export', 'abc'], { account: undefined });
  });
});

// --- gog_docs_insert ---

describe('gog_docs_insert', () => {
  it('calls runOrDiagnose with content', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'Hello world' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'Hello world'],
      { account: undefined },
    );
  });

  it('includes --index when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'text', index: 5 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'text', '--index=5'],
      { account: undefined },
    );
  });

  it('includes --index=0 when index is zero', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'text', index: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'text', '--index=0'],
      { account: undefined },
    );
  });

  it('includes --file when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', file: '/tmp/text.txt' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', '--file=/tmp/text.txt'],
      { account: undefined },
    );
  });

  it('includes --tab-id when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'hi', tabId: 'tab1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'hi', '--tab-id=tab1'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'insert', 'abc'], { account: undefined });
  });
});

// --- gog_docs_list_tabs ---

describe('gog_docs_list_tabs', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_list_tabs')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'list-tabs', 'abc'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_list_tabs')!({ docId: 'abc', account: 'other@gmail.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'list-tabs', 'abc'], { account: 'other@gmail.com' });
  });
});

// --- gog_docs_sed ---

describe('gog_docs_sed', () => {
  it('calls runOrDiagnose with single expression', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc', expression: 's/old/new/g' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', 's/old/new/g'],
      { account: undefined },
    );
  });

  it('calls runOrDiagnose with multiple expressions', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({
      docId: 'abc',
      expressions: ['s/foo/bar/g', 's/baz/qux/g'],
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', '--expressions=s/foo/bar/g', '--expressions=s/baz/qux/g'],
      { account: undefined },
    );
  });

  it('includes --file when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc', file: '/tmp/sed.txt' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', '--file=/tmp/sed.txt'],
      { account: undefined },
    );
  });

  it('includes --tab when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc', expression: 's/a/b/', tab: 'Notes' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', 's/a/b/', '--tab=Notes'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'sed', 'abc'], { account: undefined });
  });
});

// --- gog_docs_update ---

describe('gog_docs_update', () => {
  it('calls runOrDiagnose with --text flag', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'Hello' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=Hello'],
      { account: undefined },
    );
  });

  it('includes --file when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', file: '/tmp/content.txt' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--file=/tmp/content.txt'],
      { account: undefined },
    );
  });

  it('includes --index when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', index: 10 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi', '--index=10'],
      { account: undefined },
    );
  });

  it('includes --index=0 when index is zero', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', index: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi', '--index=0'],
      { account: undefined },
    );
  });

  it('includes --tab-id when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', tabId: 'tab1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi', '--tab-id=tab1'],
      { account: undefined },
    );
  });

  it('includes --pageless when true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', pageless: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--pageless'],
      { account: undefined },
    );
  });

  it('omits --pageless when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', pageless: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'update', 'abc'], { account: undefined });
  });

  it('includes --replace-range when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'new', replaceRange: '25:40' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=new', '--replace-range=25:40'],
      { account: undefined },
    );
  });

  it('includes --markdown when true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: '# Heading', markdown: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=# Heading', '--markdown'],
      { account: undefined },
    );
  });

  it('omits --markdown when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', markdown: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi'],
      { account: undefined },
    );
  });
});

// --- Dedicated comment tools ---

describe('gog_docs_comments_list', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'comments', 'list', 'abc'], { account: undefined });
  });

  it('includes --include-resolved when set', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', includeResolved: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc', '--include-resolved'],
      { account: undefined },
    );
  });

  it('omits --include-resolved when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', includeResolved: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'comments', 'list', 'abc'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', account: 'other@gmail.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc'],
      { account: 'other@gmail.com' },
    );
  });

  // gog 0.22.0 adds --since; pagination flags were already supported by gog.
  it('includes --since and pagination flags when set', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({
      docId: 'abc', includeResolved: true, since: '2026-06-01T00:00:00Z', max: 10, page: 'tok', all: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc', '--include-resolved', '--since=2026-06-01T00:00:00Z', '--max=10', '--page=tok', '--all'],
      { account: undefined },
    );
  });
});

describe('gog_docs_table_column_width', () => {
  it('sets a fixed column width', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_table_column_width')!({
      docId: 'd1', col: 2, width: 120, tableIndex: 1, tab: 'Body',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'table-column-width', 'd1', '--col=2', '--width=120', '--table-index=1', '--tab=Body'],
      { account: undefined },
    );
  });

  it('resets all columns to even distribution', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_table_column_width')!({ docId: 'd1', evenlyDistributed: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'table-column-width', 'd1', '--evenly-distributed'],
      { account: undefined },
    );
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_table_column_width')!({ docId: 'd1', col: 1, width: 80, account: 'other@gmail.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'table-column-width', 'd1', '--col=1', '--width=80'],
      { account: 'other@gmail.com' },
    );
  });
});

describe('gog_docs_comments_get', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_get')!({ docId: 'abc', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'comments', 'get', 'abc', 'c1'], { account: undefined });
  });
});

describe('gog_docs_comments_add', () => {
  it('calls runOrDiagnose with content', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({ docId: 'abc', content: 'Please review' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Please review'],
      { account: undefined },
    );
  });

  it('includes --quoted when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({
      docId: 'abc', content: 'Typo here', quoted: 'teh',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Typo here', '--quoted=teh'],
      { account: undefined },
    );
  });

  it('omits --quoted when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({ docId: 'abc', content: 'Nice' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Nice'],
      { account: undefined },
    );
  });
});

describe('gog_docs_comments_reply', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_reply')!({ docId: 'abc', commentId: 'c1', content: 'Done' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'reply', 'abc', 'c1', 'Done'],
      { account: undefined },
    );
  });
});

describe('gog_docs_comments_resolve', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('includes --message when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({
      docId: 'abc', commentId: 'c1', message: 'Fixed in v2',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1', '--message=Fixed in v2'],
      { account: undefined },
    );
  });

  it('omits --message when not provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1'],
      { account: undefined },
    );
  });
});

describe('gog_docs_comments_delete', () => {
  it('calls runOrDiagnose with correct args', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_delete')!({ docId: 'abc', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'delete', 'abc', 'c1'],
      { account: undefined },
    );
  });
});

describe('gog_docs_trash', () => {
  it('routes to gog drive delete <docId>', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_trash')!({ docId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'delete', 'd1'], { account: undefined });
  });
});

describe('gog_docs_append', () => {
  it('uses gog docs write --append', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_append')!({ docId: 'd1', text: 'Hello' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'write', 'd1', '--append', '--text=Hello'],
      { account: undefined },
    );
  });

  it('passes file, markdown, and tab flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_append')!({
      docId: 'd1', file: '/tmp/section.md', markdown: true, tab: 'Notes',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'write', 'd1', '--append', '--file=/tmp/section.md', '--markdown', '--tab=Notes'],
      { account: undefined },
    );
  });

  // Regression: the tool description must warn about the 3 known upstream
  // markdown converter bugs (openclaw/gogcli#607, #608, #609). If upstream
  // fixes any of these and the warning is removed, this test fails as a
  // prompt to revisit + reopen the README/SKILL/TODO sections too.
  it('description warns about all 3 known upstream markdown limitations', async () => {
    // Local mock to capture the registration config (the shared harness only
    // captures the handler callback).
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const configs = new Map<string, { description?: string }>();
    vi.spyOn(server, 'registerTool').mockImplementation((name, config) => {
      configs.set(name, config as { description?: string });
      return undefined as never;
    });
    const { registerExtraDocsTools } = await import('../../src/tools/docs-extra.js');
    registerExtraDocsTools(server);
    const desc = configs.get('gog_docs_append')?.description ?? '';
    expect(desc).toMatch(/openclaw\/gogcli#607/);
    expect(desc).toMatch(/openclaw\/gogcli#608/);
    expect(desc).toMatch(/openclaw\/gogcli#609/);
  });
});

describe('gog_docs_read', () => {
  it('defaults to plain text via gog docs cat', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('hello'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_read')!({ docId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'cat', 'd1'], { account: undefined });
  });

  it('routes json format to gog docs raw --pretty', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_read')!({ docId: 'd1', format: 'json' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'raw', 'd1', '--pretty'], { account: undefined });
  });

  it('passes tab, allTabs, maxBytes in text mode', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText(''));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_read')!({ docId: 'd1', tab: 'Section A', allTabs: true, maxBytes: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cat', 'd1', '--tab=Section A', '--all-tabs', '--max-bytes=0'],
      { account: undefined },
    );
  });
});

describe('gog_docs_format', () => {
  it('passes all text/paragraph attribute flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_format')!({
      docId: 'd1',
      match: 'Title',
      matchAll: true,
      matchCase: true,
      tab: 'Body',
      fontFamily: 'Arial',
      fontSize: 18,
      textColor: '#333333',
      bgColor: '#FFF5D9',
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      alignment: 'center',
      lineSpacing: 150,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'docs', 'format', 'd1',
        '--match=Title',
        '--match-all',
        '--match-case',
        '--tab=Body',
        '--font-family=Arial',
        '--font-size=18',
        '--text-color=#333333',
        '--bg-color=#FFF5D9',
        '--bold',
        '--italic',
        '--underline',
        '--strikethrough',
        '--alignment=center',
        '--line-spacing=150',
      ],
      { account: undefined },
    );
  });

  it('emits clear-style flags (noBold/noItalic/...) without the set variants', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_format')!({
      docId: 'd1',
      noBold: true,
      noItalic: true,
      noUnderline: true,
      noStrikethrough: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'format', 'd1', '--no-bold', '--no-italic', '--no-underline', '--no-strikethrough'],
      { account: undefined },
    );
  });

  it('omits all flags when not provided (whole-doc no-op call passes through)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_format')!({ docId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'format', 'd1'], { account: undefined });
  });

  // gog 0.18.0
  it('passes --heading-level and --named-style when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_format')!({
      docId: 'd1', match: 'Intro', headingLevel: 1, namedStyle: 'HEADING_1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'format', 'd1', '--match=Intro', '--heading-level=1', '--named-style=HEADING_1'],
      { account: undefined },
    );
  });

  it('passes --heading-level=0 when explicitly 0 (HEADING_0 reserved but argument should reach gog)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_format')!({ docId: 'd1', headingLevel: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'format', 'd1', '--heading-level=0'],
      { account: undefined },
    );
  });

  // gog 0.22.0
  it('passes --code when code is true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_format')!({ docId: 'd1', match: 'snippet', code: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'format', 'd1', '--match=snippet', '--code'],
      { account: undefined },
    );
  });
});

// --- gog 0.18.0 new tools ---

describe('gog_docs_insert_page_break', () => {
  it('inserts at index when --index provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_page_break')!({ docId: 'd1', index: 42 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-page-break', 'd1', '--index=42'],
      { account: undefined },
    );
  });

  it('uses --at-end when atEnd is true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_page_break')!({ docId: 'd1', atEnd: true, tab: 'Body' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-page-break', 'd1', '--at-end', '--tab=Body'],
      { account: undefined },
    );
  });

  it('passes --index=1 when explicitly 1', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_page_break')!({ docId: 'd1', index: 1 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-page-break', 'd1', '--index=1'],
      { account: undefined },
    );
  });
});

describe('gog_docs_page_layout', () => {
  it('passes --layout when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_page_layout')!({ docId: 'd1', layout: 'pages' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'page-layout', 'd1', '--layout=pages'],
      { account: undefined },
    );
  });

  it('omits --layout when not provided (defaults to pageless on gog side)', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_page_layout')!({ docId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'page-layout', 'd1'], { account: undefined });
  });

  it('passes --page-size, page dimensions and all margins', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_page_layout')!({
      docId: 'd1', layout: 'pages', pageSize: 'A4', pageWidth: '8.5in', pageHeight: '11in',
      marginTop: '1in', marginBottom: '1in', marginLeft: '0.75in', marginRight: '0.75in',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'page-layout', 'd1', '--layout=pages', '--page-size=A4', '--page-width=8.5in',
        '--page-height=11in', '--margin-top=1in', '--margin-bottom=1in', '--margin-left=0.75in', '--margin-right=0.75in'],
      { account: undefined },
    );
  });
});

describe('gog_docs_cell_update', () => {
  it('passes required --row and --col', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cell_update')!({ docId: 'd1', row: 2, col: 3, content: 'hi' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cell-update', 'd1', '--row=2', '--col=3', '--content=hi'],
      { account: undefined },
    );
  });

  it('supports empty-string content, --content-file, --append, --format, --table-index and --tab', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cell_update')!({
      docId: 'd1', row: 1, col: 1, content: '', contentFile: '/tmp/c.md', append: true,
      format: 'plain', tableIndex: -1, tab: 'Tab2',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cell-update', 'd1', '--row=1', '--col=1', '--content=', '--content-file=/tmp/c.md',
        '--append', '--format=plain', '--table-index=-1', '--tab=Tab2'],
      { account: undefined },
    );
  });

  it('omits content when not provided and forwards account', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cell_update')!({ docId: 'd1', row: 1, col: 2, account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cell-update', 'd1', '--row=1', '--col=2'],
      { account: 'a@b.com' },
    );
  });
});

describe('gog_docs_cell_style', () => {
  it('passes required --row and --col', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cell_style')!({ docId: 'd1', row: 0, col: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cell-style', 'd1', '--row=0', '--col=0'],
      { account: undefined },
    );
  });

  it('passes spans, colors and text styling', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cell_style')!({
      docId: 'd1', row: 1, col: 2, rowSpan: 2, colSpan: 3, backgroundColor: '#eee',
      textColor: '#111', bold: true, italic: true, underline: true, tableIndex: 1, tab: 'T',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cell-style', 'd1', '--row=1', '--col=2', '--row-span=2', '--col-span=3',
        '--background-color=#eee', '--text-color=#111', '--bold', '--italic', '--underline',
        '--table-index=1', '--tab=T'],
      { account: undefined },
    );
  });

  it('omits text styling flags when false', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cell_style')!({ docId: 'd1', row: 0, col: 0, bold: false, italic: false, underline: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'cell-style', 'd1', '--row=0', '--col=0'],
      { account: undefined },
    );
  });
});

describe('gog_docs_insert_image', () => {
  it('passes required --file and defaults', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_image')!({ docId: 'd1', file: '/tmp/pic.png' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-image', 'd1', '--file=/tmp/pic.png'],
      { account: undefined },
    );
  });

  it('passes placement, sizing, naming and restriction handling', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_image')!({
      docId: 'd1', file: '/tmp/pic.png', at: '{{logo}}', width: 200, height: 100,
      name: 'logo.png', parent: 'folder1', onRestricted: 'link', tab: 'T',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-image', 'd1', '--file=/tmp/pic.png', '--at={{logo}}', '--width=200',
        '--height=100', '--name=logo.png', '--parent=folder1', '--on-restricted=link', '--tab=T'],
      { account: undefined },
    );
  });
});

describe('gog_docs_insert_person', () => {
  it('passes required --email', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_person')!({ docId: 'd1', email: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-person', 'd1', '--email=a@b.com'],
      { account: undefined },
    );
  });

  it('passes --index, --at-end and --tab', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_person')!({ docId: 'd1', email: 'a@b.com', index: 0, atEnd: true, tab: 'T' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-person', 'd1', '--email=a@b.com', '--index=0', '--at-end', '--tab=T'],
      { account: undefined },
    );
  });
});

describe('gog_docs_insert_date_chip', () => {
  it('omits all optional flags by default', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_date_chip')!({ docId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'insert-date-chip', 'd1'], { account: undefined });
  });

  it('passes --date, --format, --index and --at-end', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_date_chip')!({ docId: 'd1', date: '2026-06-01', format: 'iso', index: 5, atEnd: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-date-chip', 'd1', '--date=2026-06-01', '--format=iso', '--index=5', '--at-end'],
      { account: undefined },
    );
  });
});

describe('gog_docs_insert_table', () => {
  it('passes required --rows and --cols', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_table')!({ docId: 'd1', rows: 3, cols: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-table', 'd1', '--rows=3', '--cols=2'],
      { account: undefined },
    );
  });

  it('passes --values-json, --index, --tab when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    const vj = '[["a","b"],["c","d"]]';
    await handlers.get('gog_docs_insert_table')!({
      docId: 'd1', rows: 2, cols: 2, index: 10, valuesJson: vj, tab: 'Body',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-table', 'd1', '--rows=2', '--cols=2', '--index=10', `--values-json=${vj}`, '--tab=Body'],
      { account: undefined },
    );
  });

  it('uses --at-end when atEnd is true', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert_table')!({ docId: 'd1', rows: 1, cols: 1, atEnd: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'insert-table', 'd1', '--rows=1', '--cols=1', '--at-end'],
      { account: undefined },
    );
  });
});

describe('gog_docs_comments_reopen', () => {
  it('calls runOrDiagnose with docId and commentId', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_reopen')!({ docId: 'd1', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'reopen', 'd1', 'c1'],
      { account: undefined },
    );
  });

  it('forwards account', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_reopen')!({ docId: 'd1', commentId: 'c1', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'comments', 'reopen', 'd1', 'c1'],
      { account: 'a@b.com' },
    );
  });
});

// --- gog_docs_add_tab ---

describe('gog_docs_add_tab', () => {
  it('calls runOrDiagnose with only docId when no flags', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_add_tab')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'add-tab', 'abc'], { account: undefined });
  });

  it('includes all flags when provided', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_add_tab')!({
      docId: 'abc',
      title: 'Notes',
      index: 2,
      parentTab: 'Intro',
      iconEmoji: '📌',
      account: 'a@b.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'add-tab', 'abc', '--title=Notes', '--index=2', '--parent-tab=Intro', '--icon-emoji=📌'],
      { account: 'a@b.com' },
    );
  });

  it('includes --index when zero', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_add_tab')!({ docId: 'abc', index: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'add-tab', 'abc', '--index=0'],
      { account: undefined },
    );
  });
});

// --- gog_docs_rename_tab ---

describe('gog_docs_rename_tab', () => {
  it('calls runOrDiagnose with tab and title', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_rename_tab')!({ docId: 'abc', tab: 'Old', title: 'New' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'rename-tab', 'abc', '--tab=Old', '--title=New'],
      { account: undefined },
    );
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_rename_tab')!({ docId: 'abc', tab: 't1', title: 'New', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'rename-tab', 'abc', '--tab=t1', '--title=New'],
      { account: 'a@b.com' },
    );
  });
});

// --- gog_docs_delete_tab ---

describe('gog_docs_delete_tab', () => {
  it('calls runOrDiagnose with tab', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete_tab')!({ docId: 'abc', tab: 'Old' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'delete-tab', 'abc', '--tab=Old'],
      { account: undefined },
    );
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete_tab')!({ docId: 'abc', tab: 't1', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['docs', 'delete-tab', 'abc', '--tab=t1'],
      { account: 'a@b.com' },
    );
  });
});

// --- gog_docs_clear ---

describe('gog_docs_clear', () => {
  it('calls runOrDiagnose with docId', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_clear')!({ docId: 'abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'clear', 'abc'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
    const handlers = setupHandlers();
    await handlers.get('gog_docs_clear')!({ docId: 'abc', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['docs', 'clear', 'abc'], { account: 'a@b.com' });
  });
});
