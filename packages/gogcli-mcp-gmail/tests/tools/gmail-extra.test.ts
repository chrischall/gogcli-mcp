import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraGmailTools } from '../../src/tools/gmail-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupHandlers, toText, type ToolHandler } from '../../../gogcli-mcp/tests/helpers/test-harness.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers(registerExtraGmailTools);
});

describe('gog_gmail_raw', () => {
  it('calls runOrDiagnose with messageId', async () => {
    await handlers.get('gog_gmail_raw')!({ messageId: 'm1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'raw', 'm1'], { account: undefined });
  });

  it('passes --format and --pretty when provided', async () => {
    await handlers.get('gog_gmail_raw')!({ messageId: 'm1', format: 'metadata', pretty: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'raw', 'm1', '--format=metadata', '--pretty'],
      { account: undefined },
    );
  });

  it('omits --pretty when false', async () => {
    await handlers.get('gog_gmail_raw')!({ messageId: 'm1', pretty: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'raw', 'm1'], { account: undefined });
  });
});

describe('gog_gmail_attachment', () => {
  it('calls runOrDiagnose with messageId and attachmentId', async () => {
    await handlers.get('gog_gmail_attachment')!({ messageId: 'm1', attachmentId: 'a1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'attachment', 'm1', 'a1'],
      { account: undefined },
    );
  });

  it('passes --out and --name when provided', async () => {
    await handlers.get('gog_gmail_attachment')!({
      messageId: 'm1',
      attachmentId: 'a1',
      out: '/tmp/file.pdf',
      name: 'report.pdf',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'attachment', 'm1', 'a1', '--out=/tmp/file.pdf', '--name=report.pdf'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_url', () => {
  it('calls runOrDiagnose with a single threadId', async () => {
    await handlers.get('gog_gmail_url')!({ threadIds: ['t1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'url', 't1'], { account: undefined });
  });

  it('calls runOrDiagnose with multiple threadIds', async () => {
    await handlers.get('gog_gmail_url')!({ threadIds: ['t1', 't2', 't3'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'url', 't1', 't2', 't3'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_history', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_gmail_history')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'history'], { account: undefined });
  });

  it('passes all history flags', async () => {
    await handlers.get('gog_gmail_history')!({ since: '12345', max: 50, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'history', '--since=12345', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_gmail_history')!({ all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'history'], { account: undefined });
  });
});

describe('bulk action tools (archive, mark_read, mark_unread, trash)', () => {
  const bulkTools = [
    { tool: 'gog_gmail_archive', cmd: 'archive' },
    { tool: 'gog_gmail_mark_read', cmd: 'mark-read' },
    { tool: 'gog_gmail_mark_unread', cmd: 'unread' },
    { tool: 'gog_gmail_trash', cmd: 'trash' },
  ];

  for (const { tool, cmd } of bulkTools) {
    describe(tool, () => {
      it('passes messageIds as positional args', async () => {
        await handlers.get(tool)!({ messageIds: ['m1', 'm2'] });
        expect(lib.runOrDiagnose).toHaveBeenCalledWith(
          ['gmail', cmd, 'm1', 'm2'],
          { account: undefined },
        );
      });

      it('passes --query and --max', async () => {
        await handlers.get(tool)!({ query: 'is:unread older_than:7d', max: 50 });
        expect(lib.runOrDiagnose).toHaveBeenCalledWith(
          ['gmail', cmd, '--query=is:unread older_than:7d', '--max=50'],
          { account: undefined },
        );
      });

      it('passes both positional ids and flags together', async () => {
        await handlers.get(tool)!({ messageIds: ['m1'], max: 10 });
        expect(lib.runOrDiagnose).toHaveBeenCalledWith(
          ['gmail', cmd, 'm1', '--max=10'],
          { account: undefined },
        );
      });
    });
  }
});

describe('gog_gmail_message_modify', () => {
  it('calls runOrDiagnose with messageId and label changes', async () => {
    await handlers.get('gog_gmail_message_modify')!({
      messageId: 'm1',
      add: 'STARRED,IMPORTANT',
      remove: 'INBOX',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'modify', 'm1', '--add=STARRED,IMPORTANT', '--remove=INBOX'],
      { account: undefined },
    );
  });

  it('omits flags when not provided', async () => {
    await handlers.get('gog_gmail_message_modify')!({ messageId: 'm1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'modify', 'm1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_batch_delete', () => {
  it('calls runOrDiagnose with messageIds as positional args', async () => {
    await handlers.get('gog_gmail_batch_delete')!({ messageIds: ['m1', 'm2', 'm3'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'delete', 'm1', 'm2', 'm3'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_batch_modify', () => {
  it('calls runOrDiagnose with messageIds and label flags', async () => {
    await handlers.get('gog_gmail_batch_modify')!({
      messageIds: ['m1', 'm2'],
      add: 'STARRED',
      remove: 'INBOX',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'modify', 'm1', 'm2', '--add=STARRED', '--remove=INBOX'],
      { account: undefined },
    );
  });

  it('omits label flags when not provided', async () => {
    await handlers.get('gog_gmail_batch_modify')!({ messageIds: ['m1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'modify', 'm1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_thread_get', () => {
  it('calls runOrDiagnose with threadId', async () => {
    await handlers.get('gog_gmail_thread_get')!({ threadId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'get', 't1'],
      { account: undefined },
    );
  });

  it('passes all flags', async () => {
    await handlers.get('gog_gmail_thread_get')!({
      threadId: 't1',
      download: true,
      full: true,
      sanitizeContent: true,
      outDir: '/tmp/atts',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'get', 't1', '--download', '--full', '--sanitize-content', '--out-dir=/tmp/atts'],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_gmail_thread_get')!({
      threadId: 't1',
      download: false,
      full: false,
      sanitizeContent: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'get', 't1'],
      { account: undefined },
    );
  });

  const THREAD = JSON.stringify({
    downloaded: false,
    thread: {
      id: 't1',
      messages: [
        { id: 'm1', threadId: 't1', internalDate: '1', labelIds: ['INBOX'], snippet: 'first', payload: { headers: [{ name: 'From', value: 'a@x.com' }, { name: 'Subject', value: 'Hi' }, { name: 'X-Spam', value: 'no' }, { value: 'orphan-no-name' }], body: { data: 'AAAA' } } },
        { id: 'm2', threadId: 't1', internalDate: '2', labelIds: ['INBOX'], snippet: 'second', payload: { headers: [{ name: 'From', value: 'b@x.com' }] } },
        { id: 'm3', threadId: 't1', internalDate: '3', labelIds: ['SENT'], snippet: 'third' },
      ],
    },
  });

  it('does not transform the output when no paging params are given', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText(THREAD));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1' });
    expect(result.content[0].text).toBe(THREAD);
  });

  it('latestN returns only the last N messages', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText(THREAD));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1', latestN: 2 });
    // latestN is wrapper-side; no CLI flag is added
    expect(vi.mocked(lib.runOrDiagnose).mock.calls[0]![0]).toEqual(['gmail', 'thread', 'get', 't1']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.thread.messages.map((m: { id: string }) => m.id)).toEqual(['m2', 'm3']);
  });

  it('snippetsOnly returns per-message headers and snippet without bodies', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText(THREAD));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1', snippetsOnly: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.thread.messages).toHaveLength(3);
    const m1 = parsed.thread.messages[0];
    expect(m1.snippet).toBe('first');
    expect(m1.headers).toEqual({ From: 'a@x.com', Subject: 'Hi' }); // X-Spam dropped
    expect(m1.payload).toBeUndefined();
    // a message with no payload yields empty headers without throwing
    expect(parsed.thread.messages[2].headers).toEqual({});
  });

  it('combines latestN and snippetsOnly', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText(THREAD));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1', latestN: 1, snippetsOnly: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.thread.messages).toHaveLength(1);
    expect(parsed.thread.messages[0].id).toBe('m3');
  });

  it('returns the raw result when the payload is not JSON', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText('not json'));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1', latestN: 2 });
    expect(result.content[0].text).toBe('not json');
  });

  it('returns the raw result when there is no messages array', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText('{"thread":{}}'));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1', snippetsOnly: true });
    expect(result.content[0].text).toBe('{"thread":{}}');
  });

  it('returns the raw result when there is no thread object', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText('{}'));
    const result = await handlers.get('gog_gmail_thread_get')!({ threadId: 't1', latestN: 1 });
    expect(result.content[0].text).toBe('{}');
  });
});

describe('gog_gmail_thread_modify', () => {
  it('calls runOrDiagnose with threadId and label flags', async () => {
    await handlers.get('gog_gmail_thread_modify')!({
      threadId: 't1',
      add: 'IMPORTANT',
      remove: 'INBOX',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'modify', 't1', '--add=IMPORTANT', '--remove=INBOX'],
      { account: undefined },
    );
  });

  it('omits label flags when not provided', async () => {
    await handlers.get('gog_gmail_thread_modify')!({ threadId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'modify', 't1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_thread_attachments', () => {
  it('calls runOrDiagnose with threadId', async () => {
    await handlers.get('gog_gmail_thread_attachments')!({ threadId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'attachments', 't1'],
      { account: undefined },
    );
  });

  it('passes --download and --out-dir when provided', async () => {
    await handlers.get('gog_gmail_thread_attachments')!({
      threadId: 't1',
      download: true,
      outDir: '/tmp/atts',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'attachments', 't1', '--download', '--out-dir=/tmp/atts'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_list', () => {
  it('calls runOrDiagnose with no args', async () => {
    await handlers.get('gog_gmail_labels_list')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'list'],
      { account: undefined },
    );
  });

  it('forwards account', async () => {
    await handlers.get('gog_gmail_labels_list')!({ account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'list'],
      { account: 'a@b.com' },
    );
  });
});

describe('gog_gmail_labels_get', () => {
  it('calls runOrDiagnose with labelIdOrName', async () => {
    await handlers.get('gog_gmail_labels_get')!({ labelIdOrName: 'INBOX' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'get', 'INBOX'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_create', () => {
  it('calls runOrDiagnose with name', async () => {
    await handlers.get('gog_gmail_labels_create')!({ name: 'Newsletter' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'create', 'Newsletter'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_rename', () => {
  it('calls runOrDiagnose with old and new names', async () => {
    await handlers.get('gog_gmail_labels_rename')!({ labelIdOrName: 'Old', newName: 'New' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'rename', 'Old', 'New'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_delete', () => {
  it('calls runOrDiagnose with labelIdOrName', async () => {
    await handlers.get('gog_gmail_labels_delete')!({ labelIdOrName: 'Trash-Me' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'delete', 'Trash-Me'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_modify', () => {
  it('calls runOrDiagnose with threadIds and label flags', async () => {
    await handlers.get('gog_gmail_labels_modify')!({
      threadIds: ['t1', 't2'],
      add: 'Newsletter',
      remove: 'INBOX',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'modify', 't1', 't2', '--add=Newsletter', '--remove=INBOX'],
      { account: undefined },
    );
  });

  it('omits label flags when not provided', async () => {
    await handlers.get('gog_gmail_labels_modify')!({ threadIds: ['t1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'modify', 't1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_list', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_gmail_drafts_list')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'list'],
      { account: undefined },
    );
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_gmail_drafts_list')!({ max: 50, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'list', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_get', () => {
  it('calls runOrDiagnose with draftId', async () => {
    await handlers.get('gog_gmail_drafts_get')!({ draftId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'get', 'd1'],
      { account: undefined },
    );
  });

  it('passes --download when true', async () => {
    await handlers.get('gog_gmail_drafts_get')!({ draftId: 'd1', download: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'get', 'd1', '--download'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_create', () => {
  it('calls runOrDiagnose with minimal required flags', async () => {
    await handlers.get('gog_gmail_drafts_create')!({
      subject: 'Hi',
      body: 'Hello',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello'],
      { account: undefined },
    );
  });

  it('passes all flags including attachments', async () => {
    await handlers.get('gog_gmail_drafts_create')!({
      to: 'a@b.com,c@d.com',
      cc: 'cc@x.com',
      bcc: 'bcc@x.com',
      subject: 'Hi',
      body: 'Hello',
      bodyHtml: '<p>Hi</p>',
      replyToMessageId: 'm1',
      replyTo: 'rt@x.com',
      quote: true,
      attach: ['/tmp/a.pdf', '/tmp/b.pdf'],
      from: 'me@x.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'gmail', 'drafts', 'create',
        '--to=a@b.com,c@d.com',
        '--cc=cc@x.com',
        '--bcc=bcc@x.com',
        '--subject=Hi',
        '--body=Hello',
        '--body-html=<p>Hi</p>',
        '--reply-to-message-id=m1',
        '--reply-to=rt@x.com',
        '--quote',
        '--attach=/tmp/a.pdf',
        '--attach=/tmp/b.pdf',
        '--from=me@x.com',
      ],
      { account: undefined },
    );
  });

  it('skips recipient flags when omitRecipients is true, even if to/cc/bcc are supplied', async () => {
    await handlers.get('gog_gmail_drafts_create')!({
      to: 'a@b.com', cc: 'cc@x.com', bcc: 'bcc@x.com',
      subject: 'Hi', body: 'Hello', omitRecipients: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello'],
      { account: undefined },
    );
  });

  it('returnFull re-fetches and returns the full stored draft', async () => {
    vi.mocked(lib.runOrDiagnose)
      .mockResolvedValueOnce(toText('{"draftId":"d9","message":{"id":"m9"}}'))
      .mockResolvedValueOnce(toText('{"id":"d9","message":{"subject":"Hi","body":"Hello"}}'));
    const result = await handlers.get('gog_gmail_drafts_create')!({
      subject: 'Hi', body: 'Hello', returnFull: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenNthCalledWith(1,
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello'], { account: undefined });
    expect(lib.runOrDiagnose).toHaveBeenNthCalledWith(2,
      ['gmail', 'drafts', 'get', 'd9'], { account: undefined });
    expect(result.content[0].text).toContain('"subject":"Hi"');
  });

  it('returnFull does not push --return-full to the CLI', async () => {
    vi.mocked(lib.runOrDiagnose)
      .mockResolvedValueOnce(toText('{"draftId":"d9"}'))
      .mockResolvedValueOnce(toText('{}'));
    await handlers.get('gog_gmail_drafts_create')!({ subject: 'Hi', body: 'Hello', returnFull: true });
    expect(vi.mocked(lib.runOrDiagnose).mock.calls[0]![0]).not.toContain('--return-full');
  });

  it('returnFull returns the write result when output is not parseable JSON', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText('not json'));
    const result = await handlers.get('gog_gmail_drafts_create')!({ subject: 'Hi', body: 'Hello', returnFull: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe('not json');
  });

  it('returnFull returns the write result when no draftId is present', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText('{"message":{"id":"m9"}}'));
    const result = await handlers.get('gog_gmail_drafts_create')!({ subject: 'Hi', body: 'Hello', returnFull: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe('{"message":{"id":"m9"}}');
  });
});

describe('gog_gmail_drafts_update', () => {
  it('calls runOrDiagnose with draftId and updated fields', async () => {
    await handlers.get('gog_gmail_drafts_update')!({
      draftId: 'd1',
      subject: 'New subject',
      body: 'New body',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=New subject', '--body=New body'],
      { account: undefined },
    );
  });

  it('passes attachments as repeatable flags', async () => {
    await handlers.get('gog_gmail_drafts_update')!({
      draftId: 'd1',
      subject: 'S',
      body: 'B',
      attach: ['/tmp/x.pdf'],
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--attach=/tmp/x.pdf'],
      { account: undefined },
    );
  });

  it('skips recipient flags when omitRecipients is true', async () => {
    await handlers.get('gog_gmail_drafts_update')!({
      draftId: 'd1', to: 'a@b.com', subject: 'S', body: 'B', omitRecipients: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B'],
      { account: undefined },
    );
  });

  it('returnFull re-fetches the draft by its known id', async () => {
    vi.mocked(lib.runOrDiagnose)
      .mockResolvedValueOnce(toText('{"draftId":"d1"}'))
      .mockResolvedValueOnce(toText('{"id":"d1","message":{"subject":"S"}}'));
    const result = await handlers.get('gog_gmail_drafts_update')!({
      draftId: 'd1', subject: 'S', body: 'B', returnFull: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenNthCalledWith(2,
      ['gmail', 'drafts', 'get', 'd1'], { account: undefined });
    expect(result.content[0].text).toContain('"subject":"S"');
  });

  it('returnFull surfaces a failed update instead of re-fetching a stale draft', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(toText('Error: update failed'));
    const result = await handlers.get('gog_gmail_drafts_update')!({
      draftId: 'd1', subject: 'S', body: 'B', returnFull: true,
    });
    // write failed (non-JSON) → no re-fetch; the error is surfaced
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe('Error: update failed');
  });
});

describe('gog_gmail_drafts_delete', () => {
  it('calls runOrDiagnose with draftId', async () => {
    await handlers.get('gog_gmail_drafts_delete')!({ draftId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'delete', 'd1'],
      { account: undefined },
    );
  });

  it('appends --force when force is true', async () => {
    await handlers.get('gog_gmail_drafts_delete')!({ draftId: 'd1', force: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'delete', 'd1', '--force'],
      { account: undefined },
    );
  });

  it('omits --force when force is false', async () => {
    await handlers.get('gog_gmail_drafts_delete')!({ draftId: 'd1', force: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'delete', 'd1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_send', () => {
  it('calls runOrDiagnose with draftId', async () => {
    await handlers.get('gog_gmail_drafts_send')!({ draftId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'send', 'd1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_forward', () => {
  it('calls runOrDiagnose with messageId and required --to', async () => {
    await handlers.get('gog_gmail_forward')!({ messageId: 'm1', to: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'forward', 'm1', '--to=a@b.com'],
      { account: undefined },
    );
  });

  it('passes all forward flags', async () => {
    await handlers.get('gog_gmail_forward')!({
      messageId: 'm1',
      to: 'a@b.com',
      cc: 'cc@x.com',
      bcc: 'bcc@x.com',
      note: 'FYI',
      from: 'me@x.com',
      skipAttachments: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'gmail', 'forward', 'm1',
        '--to=a@b.com',
        '--cc=cc@x.com',
        '--bcc=bcc@x.com',
        '--note=FYI',
        '--from=me@x.com',
        '--skip-attachments',
      ],
      { account: undefined },
    );
  });

  it('omits --skip-attachments when false', async () => {
    await handlers.get('gog_gmail_forward')!({ messageId: 'm1', to: 'a@b.com', skipAttachments: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'forward', 'm1', '--to=a@b.com'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_autoreply', () => {
  it('calls runOrDiagnose with query and --body', async () => {
    await handlers.get('gog_gmail_autoreply')!({ query: 'is:unread', body: 'Thanks' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'autoreply', 'is:unread', '--body=Thanks'],
      { account: undefined },
    );
  });

  it('passes all autoreply flags', async () => {
    await handlers.get('gog_gmail_autoreply')!({
      query: 'is:unread',
      max: 50,
      subject: 'Re: out of office',
      body: 'I am out',
      bodyHtml: '<p>OOO</p>',
      from: 'me@x.com',
      replyTo: 'rt@x.com',
      label: 'OOO-Replied',
      archive: true,
      markRead: true,
      skipBulk: true,
      allowSelf: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'gmail', 'autoreply', 'is:unread',
        '--max=50',
        '--subject=Re: out of office',
        '--body=I am out',
        '--body-html=<p>OOO</p>',
        '--from=me@x.com',
        '--reply-to=rt@x.com',
        '--label=OOO-Replied',
        '--archive',
        '--mark-read',
        '--skip-bulk',
        '--allow-self',
      ],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_gmail_autoreply')!({
      query: 'is:unread',
      body: 'Thanks',
      archive: false,
      markRead: false,
      skipBulk: false,
      allowSelf: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'autoreply', 'is:unread', '--body=Thanks'],
      { account: undefined },
    );
  });

  it('supports HTML-only body (no plain --body)', async () => {
    await handlers.get('gog_gmail_autoreply')!({ query: 'is:unread', bodyHtml: '<p>Hi</p>' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'autoreply', 'is:unread', '--body-html=<p>Hi</p>'],
      { account: undefined },
    );
  });
});
