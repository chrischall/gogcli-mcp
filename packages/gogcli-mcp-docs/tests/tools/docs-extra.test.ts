import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExtraDocsTools } from '../../src/tools/docs-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function toText(text: string) {
  return { content: [{ type: 'text', text }] };
}

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerExtraDocsTools(server);
  return handlers;
}

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
