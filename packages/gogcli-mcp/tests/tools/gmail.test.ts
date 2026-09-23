import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerGmailTools } from '../../src/tools/gmail.js';
import * as runner from '../../src/runner.js';
import { PAYLOAD_INLINE_MAX } from '../../src/tools/utils.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import { pos } from '../../src/argv.js';

vi.mock('../../src/runner.js');

const setupHandlers = (
  elicitation: (request: ElicitRequest) => ElicitResult | Promise<ElicitResult> =
    async () => ({ action: 'accept', content: { confirmed: true } }),
) => createTestHarness(registerGmailTools, { elicitation });

beforeEach(() => vi.clearAllMocks());

describe('gog_gmail_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'from:alice' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', pos('from:alice')], { account: undefined });
  });

  // BUG-1: `gog gmail search "-in:spam"` failed with "unknown flag -i". The
  // query is marked positional so the runner passes it after `--`.
  it('marks a negation query positional so gog never parses it as a flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: '-in:spam', max: 5 });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', pos('-in:spam'), '--max=5'], { account: undefined });
  });

  it('appends --max flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'is:unread', max: 5 });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', pos('is:unread'), '--max=5'], { account: undefined });
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
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', pos('subject:invoice'), '--from-contact=Alice'], { account: undefined });
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
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', pos('x'), '--all', '--page=tok'], { account: undefined });
  });

  it('omits --all when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_search', { query: 'x', all: false });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'search', pos('x')], { account: undefined });
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
      ['api', 'call', 'gmail', 'v1', pos('users.threads.list'),
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
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', pos('msg1')], { account: undefined });
  });

  it('appends --format flag when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1', format: 'metadata' });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', pos('msg1'), '--format=metadata'], { account: undefined });
  });

  // gog >= 0.37.0 (openclaw/gogcli#992): before that release the sanitized
  // JSON repeated the headers and body at the top level, so this flag grew the
  // payload it exists to shrink. Pinned here as the flag spelling gog expects.
  it('appends --sanitize-content when asked', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1', sanitizeContent: true });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', pos('msg1'), '--sanitize-content'], { account: undefined });
  });

  it('omits --sanitize-content when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_get', { messageId: 'msg1', sanitizeContent: false });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', pos('msg1')], { account: undefined });
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

  // gog's --quote is opt-in on `gmail send` and default-on for `gmail reply`;
  // a threaded send without it arrives with the original nowhere in the body.
  it('appends --quote only when quote is set', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com', subject: 'Re: Hi', body: 'Sure',
      replyToMessageId: 'msg1', quote: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'send',
        '--to=bob@example.com', '--subject=Re: Hi', '--body=Sure',
        '--reply-to-message-id=msg1', '--quote',
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

  // ==========================================================================
  // INLINE ATTACHMENT BYTES — for callers with no filesystem in common with gog
  // (a hosted deployment such as mcp-host). The bytes ride with the call and
  // the runner materializes them beside gog.
  // ==========================================================================
  it('turns attachInline bytes into repeatable --attach file args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com',
      subject: 'Layouts',
      body: 'See attached',
      attachInline: [{ filename: 'pendant-layouts.png', contentBase64: png }],
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'send',
        '--to=bob@example.com', '--subject=Layouts', '--body=See attached',
        { kind: 'file', flag: 'attach', contents: png, encoding: 'base64', filename: 'pendant-layouts.png' },
      ],
      { account: undefined },
    );
  });

  it('combines server-side paths and inline bytes on one message', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const bytes = Buffer.from('hello').toString('base64');
    await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com',
      subject: 'Both',
      body: 'x',
      attach: ['/tmp/on-server.pdf'],
      attachInline: [{ filename: 'from-client.txt', contentBase64: bytes }],
    });
    const args = vi.mocked(runner.run).mock.calls[0][0];
    expect(args).toContain('--attach=/tmp/on-server.pdf');
    expect(args).toContainEqual(
      { kind: 'file', flag: 'attach', contents: bytes, encoding: 'base64', filename: 'from-client.txt' },
    );
  });

  it('keeps a filename with spaces and non-ASCII intact end to end', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const filename = 'Reçu — étude 2026.png';
    await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com', subject: 's', body: 'b',
      attachInline: [{ filename, contentBase64: Buffer.from('x').toString('base64') }],
    });
    const args = vi.mocked(runner.run).mock.calls[0][0];
    expect(args.at(-1)).toMatchObject({ filename });
  });

  it('surfaces an invalid-base64 attachment as a readable error, not a corrupt send', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const res = await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com', subject: 's', body: 'b',
      attachInline: [{ filename: 'a.png', contentBase64: 'not!valid!base64!' }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not valid base64/);
    expect(runner.run).not.toHaveBeenCalled(); // nothing was sent
  });

  it('rejects an oversize attachment before the call rather than deep in the stack', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const res = await harness.callTool('gog_gmail_send', {
      to: 'bob@example.com', subject: 's', body: 'b',
      attachInline: [{ filename: 'huge.bin', contentBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/per-file limit/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('leaves the arg list untouched when attachInline is absent', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_send', { to: 'b@e.com', subject: 'Hi', body: 'Hello' });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'send', '--to=b@e.com', '--subject=Hi', '--body=Hello'],
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

  // ==========================================================================
  // THE CONFIRMATION GATE. Unlike reply/reply-all, send's recipients are
  // explicit params, so its preview needs no extra gog call at all.
  // ==========================================================================
  describe('confirmation gate', () => {
    it('elicits a recipient preview and sends only after the user accepts it', async () => {
      vi.mocked(runner.run).mockResolvedValue('{}');
      let request: ElicitRequest | undefined;
      const harness = await setupHandlers(async (value) => {
        request = value;
        return { action: 'accept', content: { confirmed: true } };
      });
      const result = await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', cc: 'carol@example.com', subject: 'Hi', body: 'Hello',
        replyToMessageId: 'm1', quote: true,
      });
      expect(request?.params.message).toContain('bob@example.com');
      expect(request?.params.message).toContain('carol@example.com');
      expect(request?.params.message).toContain('"threaded": true');
      expect(request?.params.requestedSchema).toEqual(expect.objectContaining({ type: 'object' }));
      expect(result.isError).not.toBe(true);
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    // SEC-5: the user must see WHAT is being sent, not just how long it is.
    it('shows the body text and every attachment name in the prompt', async () => {
      let request: ElicitRequest | undefined;
      const harness = await setupHandlers(async (value) => {
        request = value;
        return { action: 'decline' };
      });
      await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', subject: 'Hi', body: 'Here are the numbers you asked for',
        attach: ['/home/me/.ssh/id_rsa'],
        attachInline: [{ filename: 'report.pdf', contentBase64: Buffer.from('x').toString('base64') }],
      });
      const details = (JSON.parse(request!.params.message.split('\n').slice(1).join('\n')) as { details: Record<string, unknown> }).details;
      expect(details.bodyPreview).toBe('Here are the numbers you asked for');
      expect(details.attachments).toEqual(['/home/me/.ssh/id_rsa', 'report.pdf']);
      expect(details.subject).toBe('Hi');
      expect(details.recipients).toEqual(['bob@example.com']);
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('sends nothing when the user declines the elicitation', async () => {
      const harness = await setupHandlers(async () => ({ action: 'decline' }));
      const result = await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', subject: 'Hi', body: 'Hello',
      });
      expect(runner.run).not.toHaveBeenCalled();
      expect(JSON.parse(result.content[0].text as string)).toEqual(expect.objectContaining({
        confirmed: false,
        cancelled: true,
        action: 'gmail.send',
      }));
    });

    it('sends nothing when the user accepts but leaves confirmation false', async () => {
      const harness = await setupHandlers(async () => ({ action: 'accept', content: { confirmed: false } }));
      const result = await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', subject: 'Hi', body: 'Hello',
      });
      expect(runner.run).not.toHaveBeenCalled();
      expect(JSON.parse(result.content[0].text as string).cancelled).toBe(true);
    });

    it('logs a gmail_dispatch event with the recipients after an accepted send', async () => {
      vi.mocked(runner.run).mockResolvedValue('{}');
      const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const harness = await setupHandlers();
      await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', subject: 'Hi', body: 'Hello',
      });
      const event = JSON.parse((writeSpy.mock.calls.at(-1)?.[0] as string).trim());
      expect(event.event).toBe('gmail_dispatch');
      expect(event.tool).toBe('gog_gmail_send');
      expect(event.recipientCount).toBe(1);
      writeSpy.mockRestore();
    });

    it('does not log when the accepted send fails', async () => {
      vi.mocked(runner.run).mockRejectedValue(new Error('Send failed'));
      const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const harness = await setupHandlers();
      await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', subject: 'Hi', body: 'Hello',
      });
      expect(writeSpy).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('still validates attachments before either preview or send', async () => {
      const harness = await setupHandlers();
      const res = await harness.callTool('gog_gmail_send', {
        to: 'bob@example.com', subject: 's', body: 'b',
        attachInline: [{ filename: 'a.png', contentBase64: 'not!valid!base64!' }],
      });
      expect(res.isError).toBe(true);
      expect(runner.run).not.toHaveBeenCalled();
    });
  });
});

describe('gog_gmail_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_run', { subcommand: 'archive', args: ['msg1'] });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'archive', 'msg1'], { account: undefined, gmailNoSend: true });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_run', { subcommand: 'archive', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });

  // SEC-1: gog takes the LAST value of a repeated flag, so a model-supplied
  // override placed after the runner's injected safety flags would win.
  it.each([
    ['--readonly=false'],
    ['--'],
    ['--disable-commands='],
    ['--enable-commands=gmail.send'],
    ['--gmail-no-send=false'],
    ['--account=attacker@example.com'],
    ['-a'],
  ])('refuses a forwarded %j without running gog', async (bad) => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_run', { subcommand: 'archive', args: ['msg1', bad] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not allowed/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('refuses a flag-shaped subcommand', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_run', { subcommand: '--readonly=false', args: ['archive'] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid subcommand/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  // SEC-2: the escape hatch must not be a way around the send confirmation.
  // gog's own --gmail-no-send blocks send/reply/forward/drafts send (and every
  // alias of them — fwd, drafts post) at runtime, so it is pinned on.
  it('always runs with gog --gmail-no-send', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_run', { subcommand: 'send', args: ['--to=x@example.com'] });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'send', '--to=x@example.com'], { account: undefined, gmailNoSend: true });
  });

  it.each([
    ['autoreply', ['--body=hi']],
    ['settings', ['forwarding', 'create', 'x@example.com']],
    ['settings', ['autoforward', 'update', '--enable']],
    ['settings', ['filters', 'create', '--forward=x@example.com']],
    ['settings', ['delegates', 'add', 'x@example.com']],
  ])('refuses gmail %s %j, which dispatch or forward mail outside --gmail-no-send', async (subcommand, args) => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_gmail_run', { subcommand, args });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('still allows other settings subcommands', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_run', { subcommand: 'settings', args: ['sendas', 'list'] });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'settings', 'sendas', 'list'], { account: undefined, gmailNoSend: true });
  });

  it('allows bare settings (help/listing) with no args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_run', { subcommand: 'settings', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'settings'], { account: undefined, gmailNoSend: true });
  });
});

// ============================================================================
// REPLY / REPLY-ALL. The base package used to expose gog_gmail_send as its only
// Gmail write, so replying meant send + replyToMessageId: that threads the
// message (In-Reply-To/References) but quotes nothing, inherits no recipients
// and no "Re:" subject — the reply lands looking like a brand-new message.
// gog's `gmail reply` quotes BY DEFAULT (opt out with --no-quote), which is why
// these are separate tools rather than flags on send.
// ============================================================================
describe.each([
  ['gog_gmail_reply', 'reply'],
  ['gog_gmail_reply_all', 'reply-all'],
])('%s', (tool, subcommand) => {
  it('calls run with the message id and body, quoting by default', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"msg9"}');
    const harness = await setupHandlers();
    await harness.callTool(tool, { messageId: 'msg1', body: 'Sounds good' });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', subcommand, pos('msg1'), '--body=Sounds good', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('appends --no-quote only when noQuote is set', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool(tool, { messageId: 'msg1', body: 'Ack', noQuote: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', subcommand, pos('msg1'), '--body=Ack', '--no-quote', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('appends optional flags when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool(tool, {
      messageId: 'msg1',
      body: 'Adding Carol',
      to: ['bob@example.com'],
      cc: ['carol@example.com'],
      bcc: ['dave@example.com'],
      remove: ['eve@example.com'],
      subject: 'Re: Custom',
      from: 'me@example.com',
      account: 'me@example.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', subcommand, pos('msg1'), '--body=Adding Carol',
        '--to=bob@example.com', '--cc=carol@example.com', '--bcc=dave@example.com',
        '--remove=eve@example.com', '--subject=Re: Custom', '--from=me@example.com',
        '--auto-from-addressed-alias=false',
      ],
      { account: 'me@example.com' },
    );
  });

  it('pins --auto-from-addressed-alias on when requested', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool(tool, { messageId: 'msg1', body: 'Hi', autoFromAddressedAlias: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', subcommand, pos('msg1'), '--body=Hi', '--auto-from-addressed-alias'],
      { account: undefined },
    );
  });

  it('appends one --attach flag per file path', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool(tool, {
      messageId: 'msg1',
      body: 'See attached',
      attach: ['/tmp/shot.png', '/tmp/notes.pdf'],
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', subcommand, pos('msg1'), '--body=See attached',
        '--attach=/tmp/shot.png', '--attach=/tmp/notes.pdf',
        '--auto-from-addressed-alias=false',
      ],
      { account: undefined },
    );
  });

  it('turns attachInline bytes into a --attach file arg', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const bytes = Buffer.from('hi').toString('base64');
    await harness.callTool(tool, {
      messageId: 'msg1',
      body: 'Bytes',
      attachInline: [{ filename: 'a.txt', contentBase64: bytes }],
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', subcommand, pos('msg1'), '--body=Bytes',
        { kind: 'file', flag: 'attach', contents: bytes, encoding: 'base64', filename: 'a.txt' },
        '--auto-from-addressed-alias=false',
      ],
      { account: undefined },
    );
  });

  it('routes an oversize body to --body-file', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const big = 'x'.repeat(PAYLOAD_INLINE_MAX + 1);
    await harness.callTool(tool, { messageId: 'msg1', body: big });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', subcommand, pos('msg1'),
        { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
        '--auto-from-addressed-alias=false',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Reply failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool(tool, { messageId: 'msg1', body: 'x' });
    expect(result.content[0].text).toBe('Error: Reply failed');
  });
});

// Moved here with the tools themselves: reply/reply-all used to live in the
// gmail sub-package, which now imports replySchema/appendReplyFlags from this
// package instead of declaring a second copy.
describe('gog_gmail_reply — full flag set', () => {
  it('calls runOrDiagnose with messageId and --body', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: 'Thanks' });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'reply', pos('m1'), '--body=Thanks', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('passes all reply flags including repeatable recipients', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_reply', {
      messageId: 'm1',
      body: 'Hi',
      bodyHtml: '<p>Hi</p>',
      to: ['a@b.com', 'c@d.com'],
      cc: ['cc@x.com'],
      bcc: ['bcc@x.com'],
      remove: ['old@x.com'],
      subject: 'New subject',
      noQuote: true,
      attach: ['/tmp/a.pdf', '/tmp/b.pdf'],
      from: 'me@x.com',
      signature: true,
      signatureFrom: 'alias@x.com',
      signatureFile: '/tmp/sig.txt',
      account: 'me@gmail.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'reply', pos('m1'),
        '--body=Hi',
        '--body-html=<p>Hi</p>',
        '--to=a@b.com',
        '--to=c@d.com',
        '--cc=cc@x.com',
        '--bcc=bcc@x.com',
        '--remove=old@x.com',
        '--subject=New subject',
        '--no-quote',
        '--attach=/tmp/a.pdf',
        '--attach=/tmp/b.pdf',
        '--from=me@x.com',
        '--signature',
        '--signature-from=alias@x.com',
        '--signature-file=/tmp/sig.txt', '--auto-from-addressed-alias=false'
      ],
      { account: 'me@gmail.com' },
    );
  });

  it('omits --no-quote and --signature when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_reply', {
      messageId: 'm1', body: 'Hi', noQuote: false, signature: false,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'reply', pos('m1'), '--body=Hi', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_reply_all — full flag set', () => {
  it('uses the reply-all subcommand', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_reply_all', { messageId: 'm1', body: 'Thanks all' });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'reply-all', pos('m1'), '--body=Thanks all', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('passes repeatable recipient and signature flags', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_reply_all', {
      messageId: 'm1',
      bodyHtml: '<p>Hi</p>',
      cc: ['x@y.com', 'z@y.com'],
      remove: ['drop@y.com'],
      signatureFile: '/tmp/sig.html',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'reply-all', pos('m1'),
        '--body-html=<p>Hi</p>',
        '--cc=x@y.com',
        '--cc=z@y.com',
        '--remove=drop@y.com',
        '--signature-file=/tmp/sig.html', '--auto-from-addressed-alias=false'
      ],
      { account: undefined },
    );
  });
});

// ============================================================================
// THE CONFIRMATION GATE. The first protocol round returns input_required and
// the harness routes its embedded elicitation through the handler supplied to
// setupHandlers. Declining lets these tests inspect the prompt while proving
// the send subcommand was never reached.
// ============================================================================
describe.each([
  ['gog_gmail_reply', 'reply' as const],
  ['gog_gmail_reply_all', 'reply-all' as const],
])('%s — confirmation gate', (tool, subcommand) => {
  const METADATA = JSON.stringify({
    headers: { from: 'Alice <alice@example.com>', to: 'me@example.com', cc: 'Carol <carol@law-firm.example>', subject: 'Contract terms' },
  });

  const promptedDetails = async (args: Record<string, unknown>, metadata = METADATA) => {
    vi.mocked(runner.run).mockResolvedValue(METADATA);
    if (metadata !== METADATA) vi.mocked(runner.run).mockResolvedValue(metadata);
    let request: ElicitRequest | undefined;
    const harness = await setupHandlers(async (value) => {
      request = value;
      return { action: 'decline' };
    });
    const result = await harness.callTool(tool, { messageId: 'm1', ...args });
    return {
      result,
      request,
      details: (JSON.parse(request?.params.message.split('\n').slice(1).join('\n') ?? '{}') as {
        details?: Record<string, unknown>;
      }).details ?? {},
    };
  };

  it('elicits the resolved recipients and sends nothing when the user declines', async () => {
    const { result, request, details } = await promptedDetails({ body: 'Sounds good' });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run).toHaveBeenCalledWith(['gmail', 'get', pos('m1'), '--format=metadata'], { account: undefined });
    expect(request?.params.requestedSchema).toEqual(expect.objectContaining({ type: 'object' }));
    expect(JSON.parse(result.content[0].text as string)).toEqual(expect.objectContaining({
      confirmed: false,
      cancelled: true,
      action: `gmail.${subcommand}`,
    }));
    if (subcommand === 'reply') {
      expect(details.recipients).toEqual(['alice@example.com']);
    } else {
      expect(details.recipients).toEqual(['alice@example.com', 'me@example.com', 'carol@law-firm.example']);
    }
  });

  it('sends nothing when the user accepts but leaves confirmation false', async () => {
    vi.mocked(runner.run).mockResolvedValue(METADATA);
    const harness = await setupHandlers(async () => ({ action: 'accept', content: { confirmed: false } }));
    const result = await harness.callTool(tool, { messageId: 'm1', body: 'x' });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content[0].text as string).cancelled).toBe(true);
  });

  it('falls back to "Re: <original subject>" in the prompt when no subject override is given', async () => {
    const { details } = await promptedDetails({ body: 'x' });
    expect(details.subject).toBe('Re: Contract terms');
  });

  it('prefers an explicit subject override in the prompt over the inherited one', async () => {
    const { details } = await promptedDetails({ body: 'x', subject: 'Custom subject' });
    expect(details.subject).toBe('Custom subject');
  });

  it('actually sends and logs the resolved recipients after the user accepts', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(METADATA)
      .mockResolvedValueOnce(METADATA)
      .mockResolvedValueOnce('{"id":"sent1"}');
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const harness = await setupHandlers();
    const result = await harness.callTool(tool, { messageId: 'm1', body: 'Sounds good' });
    expect(runner.run).toHaveBeenCalledTimes(3);
    expect(runner.run).toHaveBeenNthCalledWith(1, ['gmail', 'get', pos('m1'), '--format=metadata'], { account: undefined });
    expect(runner.run).toHaveBeenNthCalledWith(
      3,
      ['gmail', subcommand, pos('m1'), '--body=Sounds good', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
    expect(result.content[0].text).toBe('{"id":"sent1"}');
    const event = JSON.parse((writeSpy.mock.calls.at(-1)?.[0] as string).trim());
    expect(event.event).toBe('gmail_dispatch');
    expect(event.tool).toBe(tool);
    expect(event.recipientCount).toBeGreaterThan(0);
    writeSpy.mockRestore();
  });

  it('does not log when the accepted send itself fails', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(METADATA)
      .mockResolvedValueOnce(METADATA)
      .mockRejectedValueOnce(new Error('quota exceeded'));
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const harness = await setupHandlers();
    const result = await harness.callTool(tool, { messageId: 'm1', body: 'x' });
    expect(result.isError).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('surfaces a bad messageId as a diagnosed error, without ever building a preview', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('message not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool(tool, { messageId: 'bad', body: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('message not found');
  });

  it('shows the reply body and attachment names in the prompt', async () => {
    const { details } = await promptedDetails({
      body: 'See the attached statement',
      attach: ['/srv/statements/2026-08.pdf'],
      attachInline: [{ filename: 'notes.txt', contentBase64: Buffer.from('n').toString('base64') }],
    });
    expect(details.bodyPreview).toBe('See the attached statement');
    expect(details.attachments).toEqual(['/srv/statements/2026-08.pdf', 'notes.txt']);
  });

  it('previews bodyHtml when there is no plain body, and names a bodyHtmlFile', async () => {
    expect((await promptedDetails({ bodyHtml: '<p>Hi</p>' })).details.bodyPreview).toBe('<p>Hi</p>');
    const { details } = await promptedDetails({ bodyHtmlFile: '/srv/body.html' });
    expect(details.bodyPreview).toBeUndefined();
    expect(details.bodyHtmlFile).toBe('/srv/body.html');
  });

  it('measures bodyLength from bodyHtml when no plain body is given', async () => {
    const { details } = await promptedDetails({ bodyHtml: '<p>Hi</p>' });
    expect(details.bodyLength).toBe('<p>Hi</p>'.length);
  });

  it('measures bodyLength as zero when neither body nor bodyHtml is given', async () => {
    const { details } = await promptedDetails({});
    expect(details.bodyLength).toBe(0);
  });

  it('ignores a non-string header value in the metadata response', async () => {
    const { details } = await promptedDetails({ body: 'x' }, JSON.stringify({
      headers: { from: 'alice@example.com', subject: 42 },
    }));
    expect(details.recipients).toEqual(['alice@example.com']);
    expect(details.subject).toBeUndefined();
  });

  it('treats an unparseable metadata response as empty headers rather than crashing', async () => {
    const { details } = await promptedDetails({ body: 'x' }, 'not json at all');
    expect(details.recipients).toEqual([]);
  });

  it('applies to/cc/bcc adds and remove drops on top of the inherited recipients in the prompt', async () => {
    const { details } = await promptedDetails({
      body: 'x', to: ['dave@example.com'], remove: ['carol@law-firm.example'],
    });
    expect(details.recipients).not.toContain('carol@law-firm.example');
    expect(details.recipients).toContain('dave@example.com');
  });
});

describe('gog_gmail_reply body-vs-file conflicts', () => {
  it('rejects bodyHtml plus bodyHtmlFile before gog runs', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const res = await harness.callTool('gog_gmail_reply', {
      messageId: 'm1', bodyHtml: '<p>Hi</p>', bodyHtmlFile: '/tmp/b.html',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('bodyHtml and bodyHtmlFile are mutually exclusive');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('treats an empty-string bodyHtml as supplied, so it still conflicts', async () => {
    // Guards the `!== undefined` check against a falsy-but-present value
    // sliding through to gog, which rejects the pair regardless of content.
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const res = await harness.callTool('gog_gmail_reply', {
      messageId: 'm1', body: 'B', bodyHtml: '', bodyHtmlFile: '/tmp/b.html',
    });
    expect(res.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('passes bodyHtmlFile alone through as --body-html-file', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_gmail_reply', {
      messageId: 'm1', body: 'Hi', bodyHtmlFile: '/tmp/b.html',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['gmail', 'reply', pos('m1'), '--body=Hi', '--body-html-file=/tmp/b.html', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('routes a large body and bodyHtml to file args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const big = 'x'.repeat(PAYLOAD_INLINE_MAX + 1);
    const bigHtml = `<p>${'y'.repeat(PAYLOAD_INLINE_MAX)}</p>`;
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: big, bodyHtml: bigHtml });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'gmail', 'reply', pos('m1'),
        { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
        { kind: 'file', flag: 'body-html-file', contents: bigHtml, ext: 'html' },
        '--auto-from-addressed-alias=false',
      ],
      { account: undefined },
    );
  });
});

// gog reads "-" from stdin, but runner.ts spawns with default stdio and never
// writes to or closes the child's stdin, so a "-" here hangs until the 30s
// timeout. No file param may advertise it as usable.
describe('reply file params never advertise stdin as usable', () => {
  it.each(['gog_gmail_reply', 'gog_gmail_reply_all'])('%s.bodyHtmlFile warns that stdin hangs', async (tool) => {
    const harness = await setupHandlers();
    const listed = (await harness.client.listTools()).tools.find((candidate) => candidate.name === tool);
    const properties = listed?.inputSchema.properties as Record<string, { description?: string }> | undefined;
    const desc = properties?.bodyHtmlFile?.description ?? '';
    expect(desc).not.toBe('');
    expect(desc).not.toMatch(/(?:or|use)\s+"?-"?\s+(?:for|to read)/i);
    expect(desc).toMatch(/stdin/i);
    expect(properties).not.toHaveProperty('confirmed');
  });
});
