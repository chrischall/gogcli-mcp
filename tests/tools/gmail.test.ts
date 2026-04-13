import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGmailTools } from '../../src/tools/gmail.js';
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
  registerGmailTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_gmail_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_search')!({ query: 'from:alice' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'from:alice'], { account: undefined });
  });

  it('appends --max flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_search')!({ query: 'is:unread', max: 5 });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'is:unread', '--max=5'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Search failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_gmail_search')!({ query: 'test' });
    expect(result.content[0].text).toBe('Error: Search failed');
  });
});

describe('gog_gmail_get', () => {
  it('calls run with message ID', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"msg1"}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_get')!({ messageId: 'msg1' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', 'msg1'], { account: undefined });
  });

  it('appends --format flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_get')!({ messageId: 'msg1', format: 'metadata' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', 'msg1', '--format=metadata'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_gmail_get')!({ messageId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_gmail_send', () => {
  it('calls run with required args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"msg2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_send')!({ to: 'bob@example.com', subject: 'Hi', body: 'Hello' });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'send', '--to=bob@example.com', '--subject=Hi', '--body=Hello'],
      { account: undefined },
    );
  });

  it('appends optional flags when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_send')!({
      to: 'bob@example.com',
      subject: 'Re: Hi',
      body: 'Sure',
      cc: 'carol@example.com',
      bcc: 'dave@example.com',
      replyToMessageId: 'msg1',
      threadId: 'thread1',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'send',
        '--to=bob@example.com', '--subject=Re: Hi', '--body=Sure',
        '--cc=carol@example.com', '--bcc=dave@example.com',
        '--reply-to-message-id=msg1', '--thread-id=thread1',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Send failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_gmail_send')!({ to: 'x', subject: 'y', body: 'z' });
    expect(result.content[0].text).toBe('Error: Send failed');
  });
});

describe('gog_gmail_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_gmail_run')!({ subcommand: 'archive', args: ['msg1'] });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'archive', 'msg1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_gmail_run')!({ subcommand: 'archive', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
