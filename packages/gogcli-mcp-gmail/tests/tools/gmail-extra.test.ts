import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraGmailTools } from '../../src/tools/gmail-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult, errorResult } from '@chrischall/mcp-utils';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    run: vi.fn(),
    runOrDiagnose: vi.fn(),
    diagnose: vi.fn(),
  };
});

let harness: TestHarness;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(lib.run).mockResolvedValue('{}');
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
  vi.mocked(lib.diagnose).mockResolvedValue(errorResult('diagnosed'));
  harness = await createTestHarness(registerExtraGmailTools);
});

describe('gog_gmail_raw', () => {
  it('calls runOrDiagnose with messageId', async () => {
    await harness.callTool('gog_gmail_raw', { messageId: 'm1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'raw', 'm1'], { account: undefined });
  });

  it('passes --format and --pretty when provided', async () => {
    await harness.callTool('gog_gmail_raw', { messageId: 'm1', format: 'metadata', pretty: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'raw', 'm1', '--format=metadata', '--pretty'],
      { account: undefined },
    );
  });

  it('omits --pretty when false', async () => {
    await harness.callTool('gog_gmail_raw', { messageId: 'm1', pretty: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'raw', 'm1'], { account: undefined });
  });
});

describe('gog_gmail_attachment', () => {
  // base64 whose first 16 chars decode to the given ASCII/binary prefix.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'; // "\x89PNG\r\n\x1a\n..."
  const PDF_B64 = 'JVBERi0xLjUKJVBFRgo='; // "%PDF-1.5\n%PEF\n"
  const OCTET_B64 = 'AAAAAAAAAAAAAAAA'; // decodes to NUL bytes — no magic match

  it('deliver=off passes through to runOrDiagnose (legacy download)', async () => {
    await harness.callTool('gog_gmail_attachment', {
      messageId: 'm1',
      attachmentId: 'a1',
      deliver: 'off',
      out: '/tmp/file.pdf',
      name: 'report.pdf',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'attachment', 'm1', 'a1', '--out=/tmp/file.pdf', '--name=report.pdf'],
      { account: undefined },
    );
    expect(lib.run).not.toHaveBeenCalled();
  });

  it('deliver=off with no out/name uses the bare download args', async () => {
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1', deliver: 'off' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'attachment', 'm1', 'a1'], { account: undefined });
  });

  it('auto (default) inlines a small image as a native image block', async () => {
    vi.mocked(lib.run).mockResolvedValue(
      JSON.stringify({ path: '/cfg/logo.png', bytes: 24, contentBase64: PNG_B64 }),
    );
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    expect(lib.run).toHaveBeenCalledWith(['gmail', 'attachment', 'm1', 'a1', '--inline'], { account: undefined });
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect(res.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
  });

  it('auto inlines a small non-image as an embedded resource blob', async () => {
    vi.mocked(lib.run).mockResolvedValue(
      JSON.stringify({ path: '/cfg/report.pdf', bytes: 12, contentBase64: PDF_B64 }),
    );
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    expect(res.content[1]).toEqual({
      type: 'resource',
      resource: { uri: 'gmail-attachment://m1/report.pdf', mimeType: 'application/pdf', blob: PDF_B64 },
    });
  });

  it('auto uploads to Drive and returns the link when over the inline cap', async () => {
    vi.mocked(lib.run)
      .mockResolvedValueOnce(JSON.stringify({ path: '/cfg/big.pdf', bytes: 9_000_000, reason: 'exceeds inline size limit (3145728 bytes)' }))
      .mockResolvedValueOnce(JSON.stringify({ file: { id: 'F1', name: 'big.pdf', mimeType: 'application/pdf', size: 9_000_000, webViewLink: 'https://drive.google.com/file/d/F1/view' } }));
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    expect(lib.run).toHaveBeenNthCalledWith(1, ['gmail', 'attachment', 'm1', 'a1', '--inline'], { account: undefined });
    expect(lib.run).toHaveBeenNthCalledWith(2, ['drive', 'upload', '/cfg/big.pdf', '--json'], { account: undefined });
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ deliveredVia: 'drive', id: 'F1', webViewLink: 'https://drive.google.com/file/d/F1/view' });
  });

  it('deliver=inline errors when the attachment is too large (no reason field)', async () => {
    // gog omits `reason` in some builds — the handler supplies a default.
    vi.mocked(lib.run).mockResolvedValue(JSON.stringify({ path: '/cfg/big.pdf', bytes: 9_000_000 }));
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1', deliver: 'inline' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('too large');
    expect(lib.run).toHaveBeenCalledTimes(1); // no Drive upload
  });

  it('deliver=drive skips --inline and uploads, honoring driveFolder and name', async () => {
    vi.mocked(lib.run)
      .mockResolvedValueOnce(JSON.stringify({ path: '/cfg/small.png', bytes: 24 }))
      .mockResolvedValueOnce(JSON.stringify({ file: { id: 'F2', webViewLink: 'https://drive.google.com/file/d/F2/view' } }));
    const res = await harness.callTool('gog_gmail_attachment', {
      messageId: 'm1',
      attachmentId: 'a1',
      deliver: 'drive',
      driveFolder: 'DIR9',
      name: 'renamed.png',
      account: 'me@x.com',
    });
    expect(lib.run).toHaveBeenNthCalledWith(1, ['gmail', 'attachment', 'm1', 'a1', '--name=renamed.png'], { account: 'me@x.com' });
    expect(lib.run).toHaveBeenNthCalledWith(2, ['drive', 'upload', '/cfg/small.png', '--json', '--parent=DIR9', '--name=renamed.png'], { account: 'me@x.com' });
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ deliveredVia: 'drive', id: 'F2' });
  });

  it('still reports drive delivery when the upload output lacks a file envelope', async () => {
    vi.mocked(lib.run)
      .mockResolvedValueOnce(JSON.stringify({ path: '/cfg/big.pdf', bytes: 9_000_000 }))
      .mockResolvedValueOnce('{}');
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ deliveredVia: 'drive' });
    expect(payload.id).toBeUndefined();
  });

  it('passes --out and --name through to the inline download', async () => {
    vi.mocked(lib.run).mockResolvedValue(JSON.stringify({ path: '/tmp/x.png', bytes: 24, contentBase64: PNG_B64 }));
    await harness.callTool('gog_gmail_attachment', {
      messageId: 'm1', attachmentId: 'a1', out: '/tmp/x.png', name: 'x.png',
    });
    expect(lib.run).toHaveBeenCalledWith(
      ['gmail', 'attachment', 'm1', 'a1', '--inline', '--out=/tmp/x.png', '--name=x.png'],
      { account: undefined },
    );
  });

  it('infers MIME by sniffing when the extension is unknown', async () => {
    vi.mocked(lib.run).mockResolvedValue(
      JSON.stringify({ path: '/cfg/blob.bin', bytes: 24, contentBase64: PNG_B64 }),
    );
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    // .bin isn't in the extension table, but the bytes sniff as PNG → image block.
    expect(res.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
  });

  it('falls back to application/octet-stream for unknown extension and unknown bytes', async () => {
    vi.mocked(lib.run).mockResolvedValue(
      JSON.stringify({ path: '/cfg/blob.bin', bytes: 12, contentBase64: OCTET_B64 }),
    );
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    expect(res.content[1]).toMatchObject({
      type: 'resource',
      resource: { mimeType: 'application/octet-stream', blob: OCTET_B64 },
    });
  });

  it('uses a generic filename and "?" size when gog reports no path or bytes', async () => {
    vi.mocked(lib.run).mockResolvedValue(JSON.stringify({ contentBase64: OCTET_B64 }));
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    expect((res.content[0] as { text: string }).text).toContain('? bytes');
    expect(res.content[1]).toMatchObject({ resource: { uri: 'gmail-attachment://m1/attachment' } });
  });

  it('diagnoses a download failure', async () => {
    vi.mocked(lib.run).mockRejectedValueOnce(new Error('boom'));
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1' });
    expect(lib.diagnose).toHaveBeenCalled();
    expect(res.isError).toBe(true);
  });
});

describe('gog_gmail_url', () => {
  it('calls runOrDiagnose with a single threadId', async () => {
    await harness.callTool('gog_gmail_url', { threadIds: ['t1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'url', 't1'], { account: undefined });
  });

  it('calls runOrDiagnose with multiple threadIds', async () => {
    await harness.callTool('gog_gmail_url', { threadIds: ['t1', 't2', 't3'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'url', 't1', 't2', 't3'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_history', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await harness.callTool('gog_gmail_history', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'history'], { account: undefined });
  });

  it('passes all history flags', async () => {
    await harness.callTool('gog_gmail_history', { since: '12345', max: 50, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'history', '--since=12345', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await harness.callTool('gog_gmail_history', { all: false });
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
        await harness.callTool(tool, { messageIds: ['m1', 'm2'] });
        expect(lib.runOrDiagnose).toHaveBeenCalledWith(
          ['gmail', cmd, 'm1', 'm2'],
          { account: undefined },
        );
      });

      it('passes --query and --max', async () => {
        await harness.callTool(tool, { query: 'is:unread older_than:7d', max: 50 });
        expect(lib.runOrDiagnose).toHaveBeenCalledWith(
          ['gmail', cmd, '--query=is:unread older_than:7d', '--max=50'],
          { account: undefined },
        );
      });

      it('passes both positional ids and flags together', async () => {
        await harness.callTool(tool, { messageIds: ['m1'], max: 10 });
        expect(lib.runOrDiagnose).toHaveBeenCalledWith(
          ['gmail', cmd, 'm1', '--max=10'],
          { account: undefined },
        );
      });
    });
  }

  // gog 0.25.0 — --thread is archive-only
  it('gog_gmail_archive passes --thread to archive whole threads by id', async () => {
    await harness.callTool('gog_gmail_archive', { messageIds: ['t1', 't2'], thread: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'archive', 't1', 't2', '--thread'],
      { account: undefined },
    );
  });

  it('other bulk tools do not expose a thread param', async () => {
    await harness.callTool('gog_gmail_trash', { messageIds: ['m1'], thread: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'trash', 'm1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_message_modify', () => {
  it('calls runOrDiagnose with messageId and label changes', async () => {
    await harness.callTool('gog_gmail_message_modify', {
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
    await harness.callTool('gog_gmail_message_modify', { messageId: 'm1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'modify', 'm1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_batch_delete', () => {
  it('calls runOrDiagnose with messageIds as positional args', async () => {
    await harness.callTool('gog_gmail_batch_delete', { messageIds: ['m1', 'm2', 'm3'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'delete', 'm1', 'm2', 'm3'],
      { account: undefined },
    );
  });

  it('appends --force when force is true', async () => {
    await harness.callTool('gog_gmail_batch_delete', { messageIds: ['m1'], force: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'delete', 'm1', '--force'],
      { account: undefined },
    );
  });

  it('omits --force when force is false', async () => {
    await harness.callTool('gog_gmail_batch_delete', { messageIds: ['m1'], force: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'delete', 'm1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_batch_modify', () => {
  it('calls runOrDiagnose with messageIds and label flags', async () => {
    await harness.callTool('gog_gmail_batch_modify', {
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
    await harness.callTool('gog_gmail_batch_modify', { messageIds: ['m1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'batch', 'modify', 'm1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_thread_get', () => {
  it('calls runOrDiagnose with threadId', async () => {
    await harness.callTool('gog_gmail_thread_get', { threadId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'get', 't1'],
      { account: undefined },
    );
  });

  it('passes all flags', async () => {
    await harness.callTool('gog_gmail_thread_get', {
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
    await harness.callTool('gog_gmail_thread_get', {
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
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult(THREAD));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1' });
    expect(result.content[0].text).toBe(THREAD);
  });

  it('latestN returns only the last N messages', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult(THREAD));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', latestN: 2 });
    // latestN is wrapper-side; no CLI flag is added
    expect(vi.mocked(lib.runOrDiagnose).mock.calls[0]![0]).toEqual(['gmail', 'thread', 'get', 't1']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.thread.messages.map((m: { id: string }) => m.id)).toEqual(['m2', 'm3']);
  });

  it('snippetsOnly returns per-message headers and snippet without bodies', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult(THREAD));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', snippetsOnly: true });
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
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult(THREAD));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', latestN: 1, snippetsOnly: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.thread.messages).toHaveLength(1);
    expect(parsed.thread.messages[0].id).toBe('m3');
  });

  it('returns the raw result when the payload is not JSON', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult('not json'));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', latestN: 2 });
    expect(result.content[0].text).toBe('not json');
  });

  it('returns the raw result when there is no messages array', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult('{"thread":{}}'));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', snippetsOnly: true });
    expect(result.content[0].text).toBe('{"thread":{}}');
  });

  it('returns the raw result when there is no thread object', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult('{}'));
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', latestN: 1 });
    expect(result.content[0].text).toBe('{}');
  });
});

describe('gog_gmail_thread_modify', () => {
  it('calls runOrDiagnose with threadId and label flags', async () => {
    await harness.callTool('gog_gmail_thread_modify', {
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
    await harness.callTool('gog_gmail_thread_modify', { threadId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'modify', 't1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_thread_attachments', () => {
  it('calls runOrDiagnose with threadId', async () => {
    await harness.callTool('gog_gmail_thread_attachments', { threadId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'thread', 'attachments', 't1'],
      { account: undefined },
    );
  });

  it('passes --download and --out-dir when provided', async () => {
    await harness.callTool('gog_gmail_thread_attachments', {
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
    await harness.callTool('gog_gmail_labels_list', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'list'],
      { account: undefined },
    );
  });

  it('forwards account', async () => {
    await harness.callTool('gog_gmail_labels_list', { account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'list'],
      { account: 'a@b.com' },
    );
  });
});

describe('gog_gmail_labels_get', () => {
  it('calls runOrDiagnose with labelIdOrName', async () => {
    await harness.callTool('gog_gmail_labels_get', { labelIdOrName: 'INBOX' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'get', 'INBOX'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_create', () => {
  it('calls runOrDiagnose with name', async () => {
    await harness.callTool('gog_gmail_labels_create', { name: 'Newsletter' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'create', 'Newsletter'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_rename', () => {
  it('calls runOrDiagnose with old and new names', async () => {
    await harness.callTool('gog_gmail_labels_rename', { labelIdOrName: 'Old', newName: 'New' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'rename', 'Old', 'New'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_delete', () => {
  it('calls runOrDiagnose with labelIdOrName', async () => {
    await harness.callTool('gog_gmail_labels_delete', { labelIdOrName: 'Trash-Me' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'delete', 'Trash-Me', '--force'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_modify', () => {
  it('calls runOrDiagnose with threadIds and label flags', async () => {
    await harness.callTool('gog_gmail_labels_modify', {
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
    await harness.callTool('gog_gmail_labels_modify', { threadIds: ['t1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'modify', 't1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_list', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await harness.callTool('gog_gmail_drafts_list', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'list'],
      { account: undefined },
    );
  });

  it('passes pagination flags', async () => {
    await harness.callTool('gog_gmail_drafts_list', { max: 50, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'list', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_get', () => {
  it('calls runOrDiagnose with draftId', async () => {
    await harness.callTool('gog_gmail_drafts_get', { draftId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'get', 'd1'],
      { account: undefined },
    );
  });

  it('passes --download when true', async () => {
    await harness.callTool('gog_gmail_drafts_get', { draftId: 'd1', download: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'get', 'd1', '--download'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_create', () => {
  it('calls runOrDiagnose with minimal required flags', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'Hi',
      body: 'Hello',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello'],
      { account: undefined },
    );
  });

  it('passes all flags including attachments', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
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

  it('passes --body-html-file when bodyHtmlFile is supplied', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'Hi',
      body: 'Hello',
      bodyHtmlFile: '/tmp/body.html',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello', '--body-html-file=/tmp/body.html'],
      { account: undefined },
    );
  });

  it('passes --reply-all when replyAll is set', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'Re: Hi',
      body: 'Hello all',
      replyToThreadId: 't1',
      replyAll: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Re: Hi', '--body=Hello all', '--thread-id=t1', '--reply-all'],
      { account: undefined },
    );
  });

  it('skips recipient flags when omitRecipients is true, even if to/cc/bcc are supplied', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
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
      .mockResolvedValueOnce(rawTextResult('{"draftId":"d9","message":{"id":"m9"}}'))
      .mockResolvedValueOnce(rawTextResult('{"id":"d9","message":{"subject":"Hi","body":"Hello"}}'));
    const result = await harness.callTool('gog_gmail_drafts_create', {
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
      .mockResolvedValueOnce(rawTextResult('{"draftId":"d9"}'))
      .mockResolvedValueOnce(rawTextResult('{}'));
    await harness.callTool('gog_gmail_drafts_create', { subject: 'Hi', body: 'Hello', returnFull: true });
    expect(vi.mocked(lib.runOrDiagnose).mock.calls[0]![0]).not.toContain('--return-full');
  });

  it('returnFull returns the write result when output is not parseable JSON', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult('not json'));
    const result = await harness.callTool('gog_gmail_drafts_create', { subject: 'Hi', body: 'Hello', returnFull: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe('not json');
  });

  it('returnFull returns the write result when no draftId is present', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult('{"message":{"id":"m9"}}'));
    const result = await harness.callTool('gog_gmail_drafts_create', { subject: 'Hi', body: 'Hello', returnFull: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe('{"message":{"id":"m9"}}');
  });
});

describe('gmail draft reply threading (native --thread-id)', () => {
  it('passes replyToThreadId straight through as --thread-id on create (no thread fetch)', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'Re: roof', body: 'Sounds good', replyToThreadId: '19dffe06f9668b28', account: 'me@x.com',
    });
    // gog resolves the thread's latest-message headers itself — no extra fetch.
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Re: roof', '--body=Sounds good', '--thread-id=19dffe06f9668b28'],
      { account: 'me@x.com' },
    );
  });

  it('passes replyToThreadId as --thread-id on update', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', replyToThreadId: 't1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--thread-id=t1'],
      { account: undefined },
    );
  });

  it('replyToMessageId wins when both ids are supplied (no --thread-id)', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'S', body: 'B', replyToMessageId: 'mExplicit', replyToThreadId: 't1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=S', '--body=B', '--reply-to-message-id=mExplicit'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_update', () => {
  it('calls runOrDiagnose with draftId and updated fields', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
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
    await harness.callTool('gog_gmail_drafts_update', {
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
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', to: 'a@b.com', subject: 'S', body: 'B', omitRecipients: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B'],
      { account: undefined },
    );
  });

  it('passes --clear-attachments when clearAttachments is true', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', clearAttachments: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--clear-attachments'],
      { account: undefined },
    );
  });

  it('returnFull re-fetches the draft by its known id', async () => {
    vi.mocked(lib.runOrDiagnose)
      .mockResolvedValueOnce(rawTextResult('{"draftId":"d1"}'))
      .mockResolvedValueOnce(rawTextResult('{"id":"d1","message":{"subject":"S"}}'));
    const result = await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', returnFull: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenNthCalledWith(2,
      ['gmail', 'drafts', 'get', 'd1'], { account: undefined });
    expect(result.content[0].text).toContain('"subject":"S"');
  });

  it('returnFull surfaces a failed update instead of re-fetching a stale draft', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce(rawTextResult('Error: update failed'));
    const result = await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', returnFull: true,
    });
    // write failed (non-JSON) → no re-fetch; the error is surfaced
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe('Error: update failed');
  });
});

describe('gog_gmail_drafts_delete', () => {
  it('calls runOrDiagnose with draftId', async () => {
    await harness.callTool('gog_gmail_drafts_delete', { draftId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'delete', 'd1'],
      { account: undefined },
    );
  });

  it('appends --force when force is true', async () => {
    await harness.callTool('gog_gmail_drafts_delete', { draftId: 'd1', force: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'delete', 'd1', '--force'],
      { account: undefined },
    );
  });

  it('omits --force when force is false', async () => {
    await harness.callTool('gog_gmail_drafts_delete', { draftId: 'd1', force: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'delete', 'd1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_drafts_send', () => {
  it('calls runOrDiagnose with draftId', async () => {
    await harness.callTool('gog_gmail_drafts_send', { draftId: 'd1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'send', 'd1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_forward', () => {
  it('calls runOrDiagnose with messageId and required --to', async () => {
    await harness.callTool('gog_gmail_forward', { messageId: 'm1', to: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'forward', 'm1', '--to=a@b.com'],
      { account: undefined },
    );
  });

  it('passes all forward flags', async () => {
    await harness.callTool('gog_gmail_forward', {
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
    await harness.callTool('gog_gmail_forward', { messageId: 'm1', to: 'a@b.com', skipAttachments: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'forward', 'm1', '--to=a@b.com'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_reply', () => {
  it('calls runOrDiagnose with messageId and --body', async () => {
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: 'Thanks' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'reply', 'm1', '--body=Thanks'],
      { account: undefined },
    );
  });

  it('passes all reply flags including repeatable recipients', async () => {
    await harness.callTool('gog_gmail_reply', {
      messageId: 'm1',
      body: 'Hi',
      bodyHtml: '<p>Hi</p>',
      bodyHtmlFile: '/tmp/b.html',
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
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'gmail', 'reply', 'm1',
        '--body=Hi',
        '--body-html=<p>Hi</p>',
        '--body-html-file=/tmp/b.html',
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
        '--signature-file=/tmp/sig.txt',
      ],
      { account: 'me@gmail.com' },
    );
  });

  it('omits --no-quote and --signature when false', async () => {
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: 'Hi', noQuote: false, signature: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'reply', 'm1', '--body=Hi'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_reply_all', () => {
  it('uses the reply-all subcommand', async () => {
    await harness.callTool('gog_gmail_reply_all', { messageId: 'm1', body: 'Thanks all' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'reply-all', 'm1', '--body=Thanks all'],
      { account: undefined },
    );
  });

  it('passes repeatable recipient and signature flags', async () => {
    await harness.callTool('gog_gmail_reply_all', {
      messageId: 'm1',
      bodyHtml: '<p>Hi</p>',
      cc: ['x@y.com', 'z@y.com'],
      remove: ['drop@y.com'],
      signatureFile: '/tmp/sig.html',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'gmail', 'reply-all', 'm1',
        '--body-html=<p>Hi</p>',
        '--cc=x@y.com',
        '--cc=z@y.com',
        '--remove=drop@y.com',
        '--signature-file=/tmp/sig.html',
      ],
      { account: undefined },
    );
  });
});

describe('gog_gmail_autoreply', () => {
  it('calls runOrDiagnose with query and --body', async () => {
    await harness.callTool('gog_gmail_autoreply', { query: 'is:unread', body: 'Thanks' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'autoreply', 'is:unread', '--body=Thanks'],
      { account: undefined },
    );
  });

  it('passes all autoreply flags', async () => {
    await harness.callTool('gog_gmail_autoreply', {
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
    await harness.callTool('gog_gmail_autoreply', {
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
    await harness.callTool('gog_gmail_autoreply', { query: 'is:unread', bodyHtml: '<p>Hi</p>' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'autoreply', 'is:unread', '--body-html=<p>Hi</p>'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_messages_search', () => {
  it('calls runOrDiagnose with just the query', async () => {
    await harness.callTool('gog_gmail_messages_search', { query: 'from:alice' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'search', 'from:alice'],
      { account: undefined },
    );
  });

  it('passes all flags when provided', async () => {
    await harness.callTool('gog_gmail_messages_search', {
      query: 'is:unread',
      max: 10,
      page: 'tok',
      all: true,
      includeBody: true,
      full: true,
      bodyFormat: 'html',
      account: 'me@x.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'search', 'is:unread', '--max=10', '--page=tok', '--all', '--include-body', '--full', '--body-format=html'],
      { account: 'me@x.com' },
    );
  });

  it('omits flags when false/absent', async () => {
    await harness.callTool('gog_gmail_messages_search', { query: 'x', all: false, includeBody: false, full: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'search', 'x'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_labels_style', () => {
  it('calls runOrDiagnose with just the label', async () => {
    await harness.callTool('gog_gmail_labels_style', { labelIdOrName: 'Work' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'style', 'Work'],
      { account: undefined },
    );
  });

  it('passes all style flags when provided', async () => {
    await harness.callTool('gog_gmail_labels_style', {
      labelIdOrName: 'Work',
      backgroundColor: '#000000',
      textColor: '#ffffff',
      labelListVisibility: 'labelHide',
      messageListVisibility: 'hide',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'labels', 'style', 'Work', '--background-color=#000000', '--text-color=#ffffff', '--label-list-visibility=labelHide', '--message-list-visibility=hide'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_vacation_get', () => {
  it('calls runOrDiagnose', async () => {
    await harness.callTool('gog_gmail_vacation_get', { account: 'me@x.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'vacation', 'get'],
      { account: 'me@x.com' },
    );
  });
});

describe('gog_gmail_vacation_update', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await harness.callTool('gog_gmail_vacation_update', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'vacation', 'update'],
      { account: undefined },
    );
  });

  it('enables with subject/body/start/end and scoping', async () => {
    await harness.callTool('gog_gmail_vacation_update', {
      enable: true,
      subject: 'Away',
      body: '<p>OOO</p>',
      start: '2024-12-20T00:00:00Z',
      end: '2024-12-31T23:59:59Z',
      contactsOnly: true,
      domainOnly: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'vacation', 'update', '--enable', '--subject=Away', '--body=<p>OOO</p>', '--start=2024-12-20T00:00:00Z', '--end=2024-12-31T23:59:59Z', '--contacts-only', '--domain-only'],
      { account: undefined },
    );
  });

  it('disables the responder', async () => {
    await harness.callTool('gog_gmail_vacation_update', { disable: true, enable: false, contactsOnly: false, domainOnly: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'vacation', 'update', '--disable'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_filters_list', () => {
  it('calls runOrDiagnose', async () => {
    await harness.callTool('gog_gmail_filters_list', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'filters', 'list'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_filters_get', () => {
  it('calls runOrDiagnose with the filter ID', async () => {
    await harness.callTool('gog_gmail_filters_get', { filterId: 'f1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'filters', 'get', 'f1'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_filters_create', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await harness.callTool('gog_gmail_filters_create', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'filters', 'create'],
      { account: undefined },
    );
  });

  it('passes all criteria and actions when provided', async () => {
    await harness.callTool('gog_gmail_filters_create', {
      from: 'alice@x.com',
      to: 'me@x.com',
      subject: 'Report',
      query: 'has:attachment',
      hasAttachment: true,
      addLabel: 'Reports',
      removeLabel: 'INBOX',
      archive: true,
      markRead: true,
      star: true,
      important: true,
      trash: true,
      neverSpam: true,
      forward: 'fwd@x.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'filters', 'create', '--from=alice@x.com', '--to=me@x.com', '--subject=Report', '--query=has:attachment', '--has-attachment', '--add-label=Reports', '--remove-label=INBOX', '--archive', '--mark-read', '--star', '--important', '--trash', '--never-spam', '--forward=fwd@x.com', '--force'],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await harness.callTool('gog_gmail_filters_create', {
      from: 'a@x.com',
      hasAttachment: false,
      archive: false,
      markRead: false,
      star: false,
      important: false,
      trash: false,
      neverSpam: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'filters', 'create', '--from=a@x.com'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_filters_delete', () => {
  it('calls runOrDiagnose with the filter ID', async () => {
    await harness.callTool('gog_gmail_filters_delete', { filterId: 'f1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'filters', 'delete', 'f1', '--force'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_sendas_list', () => {
  it('calls runOrDiagnose', async () => {
    await harness.callTool('gog_gmail_sendas_list', {});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'list'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_sendas_get', () => {
  it('calls runOrDiagnose with the email', async () => {
    await harness.callTool('gog_gmail_sendas_get', { email: 'alias@x.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'get', 'alias@x.com'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_sendas_create', () => {
  it('calls runOrDiagnose with just the email', async () => {
    await harness.callTool('gog_gmail_sendas_create', { email: 'alias@x.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'create', 'alias@x.com'],
      { account: undefined },
    );
  });

  it('passes all flags when provided', async () => {
    await harness.callTool('gog_gmail_sendas_create', {
      email: 'alias@x.com',
      displayName: 'Alias',
      replyTo: 'reply@x.com',
      signature: '<p>sig</p>',
      treatAsAlias: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'create', 'alias@x.com', '--display-name=Alias', '--reply-to=reply@x.com', '--signature=<p>sig</p>', '--treat-as-alias'],
      { account: undefined },
    );
  });

  it('omits treatAsAlias when false', async () => {
    await harness.callTool('gog_gmail_sendas_create', { email: 'alias@x.com', treatAsAlias: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'create', 'alias@x.com'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_sendas_update', () => {
  it('calls runOrDiagnose with just the email', async () => {
    await harness.callTool('gog_gmail_sendas_update', { email: 'alias@x.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'update', 'alias@x.com'],
      { account: undefined },
    );
  });

  it('passes all flags when provided', async () => {
    await harness.callTool('gog_gmail_sendas_update', {
      email: 'alias@x.com',
      displayName: 'Alias',
      replyTo: 'reply@x.com',
      signature: '<p>sig</p>',
      treatAsAlias: true,
      makeDefault: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'update', 'alias@x.com', '--display-name=Alias', '--reply-to=reply@x.com', '--signature=<p>sig</p>', '--treat-as-alias', '--make-default'],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await harness.callTool('gog_gmail_sendas_update', { email: 'alias@x.com', treatAsAlias: false, makeDefault: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'update', 'alias@x.com'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_sendas_delete', () => {
  it('calls runOrDiagnose with the email', async () => {
    await harness.callTool('gog_gmail_sendas_delete', { email: 'alias@x.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'delete', 'alias@x.com', '--force'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_sendas_verify', () => {
  it('calls runOrDiagnose with the email', async () => {
    await harness.callTool('gog_gmail_sendas_verify', { email: 'alias@x.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'settings', 'sendas', 'verify', 'alias@x.com'],
      { account: undefined },
    );
  });
});

// resultText degradations: a non-text tool result (never produced by
// runOrDiagnose today, but allowed by the MCP result shape) is passed
// through untouched instead of being post-processed.
describe('non-text result passthrough', () => {
  it('gog_gmail_thread_get returns a non-text result untouched when trimming', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue({ content: [] });
    const result = await harness.callTool('gog_gmail_thread_get', { threadId: 't1', latestN: 1 });
    expect(result.content).toEqual([]);
  });

  it('returnFull surfaces a non-text write result without re-fetching', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValueOnce({ content: [] });
    const result = await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', returnFull: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([]);
  });
});
