import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocsTools } from '../../src/tools/docs.js';
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
  registerDocsTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_docs_info', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"title":"My Doc","docId":"abc"}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_info')!({ docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'info', 'abc'], { account: undefined });
    expect(result.content[0].text).toContain('My Doc');
  });

  it('appends auth list on failure when auth list succeeds', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Doc not found'))
      .mockResolvedValueOnce('user@gmail.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_info')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Doc not found\n\nConfigured accounts:\nuser@gmail.com');
  });

  it('returns plain error text when auth list also fails', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Doc not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_info')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Doc not found');
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce('raw error string')
      .mockRejectedValueOnce(new Error('auth list failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_info')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('raw error string');
  });
});

describe('gog_docs_cat', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('Hello world');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_cat')!({ docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'cat', 'abc'], { account: undefined });
    expect(result.content[0].text).toBe('Hello world');
  });

  it('forwards account override', async () => {
    vi.mocked(runner.run).mockResolvedValue('text');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_cat')!({ docId: 'abc', account: 'other@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'cat', 'abc'], { account: 'other@gmail.com' });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_cat')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_docs_create', () => {
  it('calls run with title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"docId":"newid","title":"Meeting Notes"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_create')!({ title: 'Meeting Notes' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'create', 'Meeting Notes'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_create')!({ title: 'Bad' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_docs_write', () => {
  it('calls run with text flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_write')!({ docId: 'abc', text: 'Hello world' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'write', 'abc', '--text=Hello world'], { account: undefined });
  });

  it('adds --append flag when append is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_write')!({ docId: 'abc', text: 'More text', append: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'write', 'abc', '--text=More text', '--append'],
      { account: undefined },
    );
  });

  it('omits --append flag when append is false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_write')!({ docId: 'abc', text: 'text', append: false });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'write', 'abc', '--text=text'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Write failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_write')!({ docId: 'bad', text: 'x' });
    expect(result.content[0].text).toBe('Error: Write failed');
  });
});

describe('gog_docs_find_replace', () => {
  it('calls run with find and replace args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"occurrencesChanged":2}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_find_replace')!({ docId: 'abc', find: 'foo', replace: 'bar' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'find-replace', 'abc', 'foo', 'bar'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Replace failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_find_replace')!({ docId: 'bad', find: 'x', replace: 'y' });
    expect(result.content[0].text).toBe('Error: Replace failed');
  });
});

describe('gog_docs_structure', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('[1] Heading\n[2] Paragraph');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_structure')!({ docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'structure', 'abc'], { account: undefined });
    expect(result.content[0].text).toContain('Heading');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Structure failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_structure')!({ docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Structure failed');
  });
});

// --- Comments tools ---

describe('gog_docs_comments_list', () => {
  it('calls run with correct args for open comments', async () => {
    vi.mocked(runner.run).mockResolvedValue('[{"id":"c1","content":"Fix this"}]');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_list')!({ docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'comments', 'list', 'abc'], { account: undefined });
    expect(result.content[0].text).toContain('Fix this');
  });

  it('includes --include-resolved when set', async () => {
    vi.mocked(runner.run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', includeResolved: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc', '--include-resolved'],
      { account: undefined },
    );
  });

  it('omits --include-resolved when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', includeResolved: false });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'comments', 'list', 'abc'], { account: undefined });
  });

  it('forwards account override', async () => {
    vi.mocked(runner.run).mockResolvedValue('[]');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_list')!({ docId: 'abc', account: 'other@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'list', 'abc'],
      { account: 'other@gmail.com' },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_list')!({ docId: 'bad' });
    expect(result.content[0].text).toContain('Error: List failed');
  });
});

describe('gog_docs_comments_get', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"c1","content":"Fix this","replies":[]}');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_get')!({ docId: 'abc', commentId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'comments', 'get', 'abc', 'c1'], { account: undefined });
    expect(result.content[0].text).toContain('Fix this');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_get')!({ docId: 'abc', commentId: 'bad' });
    expect(result.content[0].text).toContain('Error: Not found');
  });
});

describe('gog_docs_comments_add', () => {
  it('calls run with content', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"c2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({ docId: 'abc', content: 'Please review' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Please review'],
      { account: undefined },
    );
  });

  it('includes --quoted when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"c2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({
      docId: 'abc',
      content: 'Typo here',
      quoted: 'teh',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Typo here', '--quoted=teh'],
      { account: undefined },
    );
  });

  it('omits --quoted when not provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"c2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_add')!({ docId: 'abc', content: 'Nice' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'add', 'abc', 'Nice'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Add failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_add')!({ docId: 'bad', content: 'x' });
    expect(result.content[0].text).toContain('Error: Add failed');
  });
});

describe('gog_docs_comments_reply', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"r1"}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_reply')!({ docId: 'abc', commentId: 'c1', content: 'Done' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'reply', 'abc', 'c1', 'Done'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Reply failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_reply')!({
      docId: 'abc', commentId: 'c1', content: 'x',
    });
    expect(result.content[0].text).toContain('Error: Reply failed');
  });
});

describe('gog_docs_comments_resolve', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('includes --message when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({
      docId: 'abc', commentId: 'c1', message: 'Fixed in v2',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1', '--message=Fixed in v2'],
      { account: undefined },
    );
  });

  it('omits --message when not provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'resolve', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Resolve failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_resolve')!({ docId: 'abc', commentId: 'c1' });
    expect(result.content[0].text).toContain('Error: Resolve failed');
  });
});

describe('gog_docs_comments_delete', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_comments_delete')!({ docId: 'abc', commentId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'comments', 'delete', 'abc', 'c1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_comments_delete')!({ docId: 'abc', commentId: 'c1' });
    expect(result.content[0].text).toContain('Error: Delete failed');
  });
});

describe('gog_docs_run', () => {
  it('passes raw subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_run')!({ subcommand: 'copy', args: ['abc', 'My Copy'] });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'My Copy'], { account: undefined });
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_docs_run')!({ subcommand: 'clear', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'clear'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_docs_run')!({ subcommand: 'clear', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
