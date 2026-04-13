import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async () => {
  const { z } = await import('zod');
  const mockRun = vi.fn<(args: string[], options?: { account?: string }) => Promise<string>>();
  const accountParam = z.string().optional().describe('Google account email');
  const toText = (output: string) => ({ content: [{ type: 'text' as const, text: output }] });
  const toError = (err: unknown) =>
    toText(err instanceof Error ? `Error: ${err.message}` : String(err));

  return {
    createBaseServer: vi.fn(),
    run: mockRun,
    accountParam,
    toText,
    toError,
    runOrDiagnose: async (args: string[], options: { account?: string }) => {
      try {
        return toText(await mockRun(args, options));
      } catch (err) {
        return toError(err);
      }
    },
  };
});

import { run } from '../../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from '../../src/tools/docs-extra.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

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
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{"docId":"newid"}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'My Copy' });
    expect(run).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'My Copy'], { account: undefined });
    expect(result.content[0].text).toContain('newid');
  });

  it('includes --parent when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'Copy', parent: 'folder123' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'copy', 'abc', 'Copy', '--parent=folder123'],
      { account: undefined },
    );
  });

  it('omits --parent when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'Copy' });
    expect(run).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'Copy'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_copy')!({ docId: 'abc', title: 'Copy', account: 'other@gmail.com' });
    expect(run).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'Copy'], { account: 'other@gmail.com' });
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Copy failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_copy')!({ docId: 'bad', title: 'x' });
    expect(result.content[0].text).toBe('Error: Copy failed');
  });
});

// --- gog_docs_delete ---

describe('gog_docs_delete', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete')!({ docId: 'abc', start: 5, end: 10 });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'delete', '--start=5', '--end=10', 'abc'],
      { account: undefined },
    );
  });

  it('includes --tab-id when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete')!({ docId: 'abc', start: 1, end: 5, tabId: 'tab1' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'delete', '--start=1', '--end=5', 'abc', '--tab-id=tab1'],
      { account: undefined },
    );
  });

  it('omits --tab-id when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_delete')!({ docId: 'abc', start: 1, end: 5 });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'delete', '--start=1', '--end=5', 'abc'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_delete')!({ docId: 'bad', start: 1, end: 5 });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

// --- gog_docs_edit ---

describe('gog_docs_edit', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_edit')!({ docId: 'abc', find: 'old', replace: 'new' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'edit', 'abc', 'old', 'new'],
      { account: undefined },
    );
  });

  it('includes --match-case when true', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_edit')!({ docId: 'abc', find: 'old', replace: 'new', matchCase: true });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'edit', 'abc', 'old', 'new', '--match-case'],
      { account: undefined },
    );
  });

  it('omits --match-case when false', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_edit')!({ docId: 'abc', find: 'old', replace: 'new', matchCase: false });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'edit', 'abc', 'old', 'new'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Edit failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_edit')!({ docId: 'bad', find: 'x', replace: 'y' });
    expect(result.content[0].text).toBe('Error: Edit failed');
  });
});

// --- gog_docs_export ---

describe('gog_docs_export', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('Exported to file.pdf');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_export')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'export', 'abc'], { account: undefined });
    expect(result.content[0].text).toContain('Exported');
  });

  it('includes --format when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc', format: 'html' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'export', 'abc', '--format=html'],
      { account: undefined },
    );
  });

  it('includes --out when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc', out: '/tmp/doc.pdf' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'export', 'abc', '--out=/tmp/doc.pdf'],
      { account: undefined },
    );
  });

  it('includes both --format and --out when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc', format: 'txt', out: '/tmp/doc.txt' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'export', 'abc', '--format=txt', '--out=/tmp/doc.txt'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_export')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'export', 'abc'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Export failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_export')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Export failed');
  });
});

// --- gog_docs_insert ---

describe('gog_docs_insert', () => {
  it('calls run with content', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'Hello world' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'Hello world'],
      { account: undefined },
    );
  });

  it('includes --index when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'text', index: 5 });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'text', '--index=5'],
      { account: undefined },
    );
  });

  it('includes --index=0 when index is zero', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'text', index: 0 });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'text', '--index=0'],
      { account: undefined },
    );
  });

  it('includes --file when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', file: '/tmp/text.txt' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', '--file=/tmp/text.txt'],
      { account: undefined },
    );
  });

  it('includes --tab-id when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc', content: 'hi', tabId: 'tab1' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'insert', 'abc', 'hi', '--tab-id=tab1'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_insert')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'insert', 'abc'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Insert failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_insert')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Insert failed');
  });
});

// --- gog_docs_list_tabs ---

describe('gog_docs_list_tabs', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('[{"id":"t1","title":"Tab 1"}]');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_list_tabs')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'list-tabs', 'abc'], { account: undefined });
    expect(result.content[0].text).toContain('Tab 1');
  });

  it('forwards account override', async () => {
    vi.mocked(run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_list_tabs')!({ docId: 'abc', account: 'other@gmail.com' });
    expect(run).toHaveBeenCalledWith(['docs', 'list-tabs', 'abc'], { account: 'other@gmail.com' });
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('List tabs failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_list_tabs')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: List tabs failed');
  });
});

// --- gog_docs_sed ---

describe('gog_docs_sed', () => {
  it('calls run with single expression', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc', expression: 's/old/new/g' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', 's/old/new/g'],
      { account: undefined },
    );
  });

  it('calls run with multiple expressions', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({
      docId: 'abc',
      expressions: ['s/foo/bar/g', 's/baz/qux/g'],
    });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', '--expressions=s/foo/bar/g', '--expressions=s/baz/qux/g'],
      { account: undefined },
    );
  });

  it('includes --file when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc', file: '/tmp/sed.txt' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', '--file=/tmp/sed.txt'],
      { account: undefined },
    );
  });

  it('includes --tab when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc', expression: 's/a/b/', tab: 'Notes' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'sed', 'abc', 's/a/b/', '--tab=Notes'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_sed')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'sed', 'abc'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Sed failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_sed')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Sed failed');
  });
});

// --- gog_docs_update ---

describe('gog_docs_update', () => {
  it('calls run with --text flag', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'Hello' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=Hello'],
      { account: undefined },
    );
  });

  it('includes --file when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', file: '/tmp/content.txt' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--file=/tmp/content.txt'],
      { account: undefined },
    );
  });

  it('includes --index when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', index: 10 });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi', '--index=10'],
      { account: undefined },
    );
  });

  it('includes --index=0 when index is zero', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', index: 0 });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi', '--index=0'],
      { account: undefined },
    );
  });

  it('includes --tab-id when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', text: 'hi', tabId: 'tab1' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--text=hi', '--tab-id=tab1'],
      { account: undefined },
    );
  });

  it('includes --pageless when true', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', pageless: true });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc', '--pageless'],
      { account: undefined },
    );
  });

  it('omits --pageless when false', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc', pageless: false });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'update', 'abc'],
      { account: undefined },
    );
  });

  it('omits optional flags when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_update')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'update', 'abc'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Update failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_update')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

// --- Dedicated comment tools ---

describe('gog_docs_comments_list', () => {
  it('calls run with correct args for open comments', async () => {
    vi.mocked(run).mockResolvedValue('[{"id":"c1","content":"Fix this"}]');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_list')!({ docId: 'abc' });
    expect(run).toHaveBeenCalledWith(['docs', 'comments', 'list', 'abc'], { account: undefined });
    expect(result.content[0].text).toContain('Fix this');
  });

  it('includes --include-resolved when set', async () => {
    vi.mocked(run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', includeResolved: true });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc', '--include-resolved'],
      { account: undefined },
    );
  });

  it('omits --include-resolved when false', async () => {
    vi.mocked(run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', includeResolved: false });
    expect(run).toHaveBeenCalledWith(['docs', 'comments', 'list', 'abc'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', account: 'other@gmail.com' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc'],
      { account: 'other@gmail.com' },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('List failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_list')!({ docId: 'bad' });
    expect(result.content[0].text).toContain('Error: List failed');
  });
});

describe('gog_docs_comments_get', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{"id":"c1","content":"Fix this","replies":[]}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_get')!({ docId: 'abc', commentId: 'c1' });
    expect(run).toHaveBeenCalledWith(['docs', 'comments', 'get', 'abc', 'c1'], { account: undefined });
    expect(result.content[0].text).toContain('Fix this');
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_get')!({ docId: 'abc', commentId: 'bad' });
    expect(result.content[0].text).toContain('Error: Not found');
  });
});

describe('gog_docs_comments_add', () => {
  it('calls run with content', async () => {
    vi.mocked(run).mockResolvedValue('{"id":"c2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({ docId: 'abc', content: 'Please review' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Please review'],
      { account: undefined },
    );
  });

  it('includes --quoted when provided', async () => {
    vi.mocked(run).mockResolvedValue('{"id":"c2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({
      docId: 'abc', content: 'Typo here', quoted: 'teh',
    });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Typo here', '--quoted=teh'],
      { account: undefined },
    );
  });

  it('omits --quoted when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{"id":"c2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({ docId: 'abc', content: 'Nice' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Nice'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Add failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_add')!({ docId: 'bad', content: 'x' });
    expect(result.content[0].text).toContain('Error: Add failed');
  });
});

describe('gog_docs_comments_reply', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{"id":"r1"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_reply')!({ docId: 'abc', commentId: 'c1', content: 'Done' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'reply', 'abc', 'c1', 'Done'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Reply failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_reply')!({
      docId: 'abc', commentId: 'c1', content: 'x',
    });
    expect(result.content[0].text).toContain('Error: Reply failed');
  });
});

describe('gog_docs_comments_resolve', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('includes --message when provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({
      docId: 'abc', commentId: 'c1', message: 'Fixed in v2',
    });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1', '--message=Fixed in v2'],
      { account: undefined },
    );
  });

  it('omits --message when not provided', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Resolve failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(result.content[0].text).toContain('Error: Resolve failed');
  });
});

describe('gog_docs_comments_delete', () => {
  it('calls run with correct args', async () => {
    vi.mocked(run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_delete')!({ docId: 'abc', commentId: 'c1' });
    expect(run).toHaveBeenCalledWith(
      ['docs', 'comments', 'delete', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_delete')!({ docId: 'abc', commentId: 'c1' });
    expect(result.content[0].text).toContain('Error: Delete failed');
  });
});
