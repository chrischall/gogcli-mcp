import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerGmailTools } from '../../src/tools/gmail.js';
import * as runner from '../../src/runner.js';
import { PAYLOAD_INLINE_MAX } from '../../src/tools/utils.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerGmailTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_gmail_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'from:alice' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'from:alice'], { account: undefined });
  });

  it('appends --max flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'is:unread', max: 5 });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'is:unread', '--max=5'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Search failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_search', { query: 'test' });
    expect(result.content[0].text).toBe('Error: Search failed');
  });

  it('appends --from-contact flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'subject:invoice', fromContact: 'Alice' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'subject:invoice', '--from-contact=Alice'], { account: undefined });
  });
});

describe('gog_gmail_search — pagination and result finalization', () => {
  // The cursor is appended LAST because it rides per page rather than being
  // baked into the shared args, so the multi-page walk can advance it. gog
  // parses flags position-independently, so the order carries no meaning.
  it('appends --page and --all when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'x', pageToken: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'x', '--all', '--page=tok'], { account: undefined });
  });

  it('omits --all when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'x', all: false });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', 'x'], { account: undefined });
  });

  it('sorts results newest-first', async () => {
    vi.mocked(runner.run).mockResolvedValue(JSON.stringify({
      threads: [
        { id: 'old', internalDateIso: '2026-08-01T09:00:00-04:00' },
        { id: 'new', internalDateIso: '2026-08-12T12:36:00-04:00' },
      ],
      nextPageToken: '',
    }));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_search', { query: 'x' });
    const out = JSON.parse(result.content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['new', 'old']);
  });

  it('marks a capped result set truncated and counts the real total', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'a' }], nextPageToken: 'tok' }))
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_search', { query: 'invoice', max: 1 });
    const out = JSON.parse(result.content[0].text as string);
    expect(out.truncated).toBe(true);
    expect(out.returned).toBe(1);
    expect(out.totalMatches).toBe(3);
    expect(out.warning).toContain('INCOMPLETE RESULT SET: returned 1 of 3 matches');
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'gmail', 'v1', 'users.threads.list',
        '--params={"userId":"me","q":"invoice","maxResults":500,"fields":"threads/id,nextPageToken"}'],
      { account: undefined },
    );
  });

  it('does not spend a count probe when --from-contact rewrote the query', async () => {
    vi.mocked(runner.run).mockResolvedValue(JSON.stringify({ threads: [{ id: 'a' }], nextPageToken: 'tok' }));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_search', { query: 'x', fromContact: 'Alice' });
    const out = JSON.parse(result.content[0].text as string);
    expect(out.truncated).toBe(true);
    expect(out).not.toHaveProperty('totalMatches');
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});

describe('gog_gmail_search — the page cursor reaches the API', () => {
  // THE REGRESSION. `page` was the declared name while the response field was
  // `nextPageToken`; a caller passing pageToken had it silently stripped by zod
  // and got page 1 forever — same threads, same token, no error. These fail if
  // a caller-supplied cursor is dropped before the gog call.
  it('threads a pageToken through to the gog invocation', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'x', pageToken: 'CURSOR' });
    const args = vi.mocked(runner.run).mock.calls[0][0] as string[];
    expect(args).toContain('--page=CURSOR');
  });

  it('still accepts the deprecated page alias', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'x', page: 'CURSOR' });
    expect(vi.mocked(runner.run).mock.calls[0][0]).toContain('--page=CURSOR');
  });

  it('prefers pageToken when both are supplied', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'x', pageToken: 'NEW', page: 'OLD' });
    expect(vi.mocked(runner.run).mock.calls[0][0]).toContain('--page=NEW');
  });

  it('returns a genuinely different page for page 2, and no token on the last', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'TOK1' }))
      .mockResolvedValueOnce('{"threads":[{"id":"x"}]}')   // count probe for page 1
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'c' }, { id: 'd' }], nextPageToken: '' }));
    const harness = await setupHandlers();

    const p1 = JSON.parse((await harness.callTool('gog_gmail_search', { query: 'q', max: 2 })).content[0].text as string);
    expect(p1.threads.map((t: { id: string }) => t.id)).toEqual(['a', 'b']);
    expect(p1.nextPageToken).toBe('TOK1');
    expect(p1.truncated).toBe(true);

    const p2 = JSON.parse((await harness.callTool('gog_gmail_search',
      { query: 'q', max: 2, pageToken: p1.nextPageToken })).content[0].text as string);
    expect(p2.threads.map((t: { id: string }) => t.id)).toEqual(['c', 'd']);
    // Exhausted cursor stripped, so its absence means "last page" unambiguously.
    expect(p2).not.toHaveProperty('nextPageToken');
    expect(p2).not.toHaveProperty('truncated');
  });
});

describe('gog_gmail_search — maxPages', () => {
  it('walks pages and merges them, stopping at the last page', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'a' }], nextPageToken: 'T1' }))
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'b' }], nextPageToken: 'T2' }))
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'c' }], nextPageToken: '' }));
    const harness = await setupHandlers();
    const out = JSON.parse((await harness.callTool('gog_gmail_search',
      { query: 'q', maxPages: 5 })).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a', 'b', 'c']);
    expect(out).not.toHaveProperty('truncated');
    expect(vi.mocked(runner.run).mock.calls[1][0]).toContain('--page=T1');
    expect(vi.mocked(runner.run).mock.calls[2][0]).toContain('--page=T2');
  });

  it('stays truncated when the page cap is hit before the end', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'a' }], nextPageToken: 'T1' }))
      .mockResolvedValueOnce(JSON.stringify({ threads: [{ id: 'b' }], nextPageToken: 'T2' }))
      .mockResolvedValueOnce('{"threads":[{"id":"1"},{"id":"2"},{"id":"3"}]}');  // count probe
    const harness = await setupHandlers();
    const out = JSON.parse((await harness.callTool('gog_gmail_search',
      { query: 'q', maxPages: 2 })).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a', 'b']);
    expect(out.truncated).toBe(true);
    expect(out.nextPageToken).toBe('T2');
    expect(out.totalMatches).toBe(3);
  });

  it('starts the walk from a caller-supplied cursor', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'q', maxPages: 3, pageToken: 'START' });
    expect(vi.mocked(runner.run).mock.calls[0][0]).toContain('--page=START');
  });
});

describe('gog_gmail_get', () => {
  it('calls run with message ID', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"msg1"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', 'msg1'], { account: undefined });
  });

  it('appends --format flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1', format: 'metadata' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', 'msg1', '--format=metadata'], { account: undefined });
  });

  // gog >= 0.37.0 (openclaw/gogcli#992): before that release the sanitized
  // JSON repeated the headers and body at the top level, so this flag grew the
  // payload it exists to shrink. Pinned here as the flag spelling gog expects.
  it('appends --sanitize-content when asked', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1', sanitizeContent: true });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', 'msg1', '--sanitize-content'], { account: undefined });
  });

  it('omits --sanitize-content when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1', sanitizeContent: false });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', 'msg1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_get', { messageId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_gmail_send', () => {
  it('calls run with required args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"msg2"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_send', { to: 'bob@example.com', subject: 'Hi', body: 'Hello' });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'send', '--to=bob@example.com', '--subject=Hi', '--body=Hello'],
      { account: undefined },
    );
  });

  it('appends optional flags when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_send', {
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

  it('appends one --attach flag per file path', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com',
      subject: 'Evidence',
      body: 'See attached',
      attach: ['/tmp/shot.png', '/tmp/notes.pdf'],
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'send',
        '--to=bob@example.com', '--subject=Evidence', '--body=See attached',
        '--attach=/tmp/shot.png', '--attach=/tmp/notes.pdf',
      ],
      { account: undefined },
    );
  });

  // A body over the shared threshold cannot ride in argv (the hosted runner
  // caps a single arg; Linux caps MAX_ARG_STRLEN at 128 KiB), so payloadArg
  // swaps it for a file arg the executor materializes as a temp file.
  it('routes an oversize body to --body-file, leaving the other flags inline', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const big = 'x'.repeat(PAYLOAD_INLINE_MAX + 1);
    await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com', subject: 'Long', body: big, cc: 'carol@example.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'send',
        '--to=bob@example.com', '--subject=Long',
        { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
        '--cc=carol@example.com',
      ],
      { account: undefined },
    );
  });

  it('keeps a body at exactly the threshold inline', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const atLimit = 'x'.repeat(PAYLOAD_INLINE_MAX);
    await harness.callTool('gog_gmail_send', { to: 'b@x.com', subject: 'S', body: atLimit });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'send', '--to=b@x.com', '--subject=S', `--body=${atLimit}`],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Send failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_send', { to: 'x', subject: 'y', body: 'z' });
    expect(result.content[0].text).toBe('Error: Send failed');
  });
});

describe('gog_gmail_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_run', { subcommand: 'archive', args: ['msg1'] });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'archive', 'msg1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_run', { subcommand: 'archive', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
