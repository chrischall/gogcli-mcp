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
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'raw', 'm1'], { account: undefined, lossless: true });
  });

  it('passes --format and --pretty when provided', async () => {
    await harness.callTool('gog_gmail_raw', { messageId: 'm1', format: 'metadata', pretty: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'raw', 'm1', '--format=metadata', '--pretty'],
      { account: undefined, lossless: true },
    );
  });

  it('omits --pretty when false', async () => {
    await harness.callTool('gog_gmail_raw', { messageId: 'm1', pretty: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'raw', 'm1'], { account: undefined, lossless: true });
  });
});

describe('gog_gmail_attachment', () => {
  // base64 whose first 16 chars decode to the given ASCII/binary prefix.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'; // "\x89PNG\r\n\x1a\n..."
  const PDF_B64 = 'JVBERi0xLjUKJVBFRgo='; // "%PDF-1.5\n%PEF\n"
  const OCTET_B64 = 'AAAAAAAAAAAAAAAA'; // decodes to NUL bytes — no magic match

  // Route the mocked `run` by subcommand: the metadata lookup (`gmail get`), the
  // download (`gmail attachment`), and the Drive upload (`drive upload`).
  function stubGog(opts: {
    meta?: unknown;
    metaError?: Error;
    download?: unknown;
    drive?: unknown;
    downloadError?: unknown;
  }): void {
    vi.mocked(lib.run).mockImplementation(async (args) => {
      const a = args as string[];
      if (a[0] === 'gmail' && a[1] === 'get') {
        if (opts.metaError) throw opts.metaError;
        return JSON.stringify(opts.meta ?? { attachments: [] });
      }
      if (a[0] === 'gmail' && a[1] === 'attachment') {
        if (opts.downloadError) throw opts.downloadError;
        return JSON.stringify(opts.download ?? {});
      }
      if (a[0] === 'drive' && a[1] === 'upload') return JSON.stringify(opts.drive ?? { file: {} });
      return '{}';
    });
  }

  // A dummy executor store — its mere presence makes runExecutor.getStore()
  // truthy, which is how the handler detects the remote connector transport.
  const REMOTE = { executor: async () => '{}' };
  const asConnector = <T>(fn: () => Promise<T>): Promise<T> => lib.runExecutor.run(REMOTE, fn);

  // The part metadata (`gmail get` `.attachments[]`) is matched by SIZE — Gmail's
  // attachmentId isn't stable across calls — so every list entry carries a `size`
  // that the download's `bytes` must equal for the filename/MIME to resolve.
  const PDF_LIST = { attachments: [{ filename: 'Guest_Copy.pdf', mimeType: 'application/pdf', size: 99723 }] };
  const PNG_LIST = { attachments: [{ filename: 'photo.png', mimeType: 'image/png', size: 24 }] };

  const call = (args: Record<string, unknown>) =>
    harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1', ...args });
  const textOf = (res: Awaited<ReturnType<typeof call>>) => (res.content[0] as { text: string }).text;
  const gotGet = () => vi.mocked(lib.run).mock.calls.some((c) => (c[0] as string[])[1] === 'get');
  const dlArgs = () => vi.mocked(lib.run).mock.calls.find((c) => (c[0] as string[])[1] === 'attachment')![0] as string[];

  it('the repro: a no-name PDF on stdio comes back as a readable file path, named correctly', async () => {
    // download writes to a provisional temp path; the real name resolves by size.
    stubGog({ meta: PDF_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 99723, contentBase64: PDF_B64 } });
    const res = await call({});
    // download to the temp path first, then the metadata read to resolve the name.
    expect(dlArgs()).toEqual(['gmail', 'attachment', 'm1', 'a1', '--use-indexed-attachment-ids=false', '--inline', '--inline-max-bytes=3145728', '--out=/tmp/gog-attachments/m1/attachment', '--name=attachment']);
    expect(gotGet()).toBe(true);
    const payload = JSON.parse(textOf(res));
    expect(payload).toMatchObject({
      delivery: 'file', path: '/tmp/gog-attachments/m1/attachment', fileName: 'Guest_Copy.pdf', mimeType: 'application/pdf', bytes: 99723,
    });
    // never an embedded-resource blob on auto (the claude.ai host rejects those for PDF).
    expect(res.content.some((c) => c.type === 'resource')).toBe(false);
  });

  it('the repro on the connector: the same PDF is delivered via Drive with the resolved name', async () => {
    stubGog({
      meta: PDF_LIST,
      download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 99723, contentBase64: PDF_B64 },
      drive: { file: { id: 'F1', name: 'Guest_Copy.pdf', webViewLink: 'https://drive.google.com/file/d/F1/view' } },
    });
    const res = await asConnector(() => call({}));
    // uploads the downloaded temp file, but names the Drive copy with the resolved filename.
    expect(lib.run).toHaveBeenCalledWith(
      ['drive', 'upload', '/tmp/gog-attachments/m1/attachment', '--json', '--name=Guest_Copy.pdf'], { account: undefined });
    expect(JSON.parse(textOf(res))).toMatchObject({ deliveredVia: 'drive', id: 'F1' });
  });

  it('an image renders inline (image block), on stdio and connector alike', async () => {
    stubGog({ meta: PNG_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 24, contentBase64: PNG_B64 } });
    const local = await call({});
    expect(local.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
    expect(textOf(local)).toContain('photo.png');
    vi.clearAllMocks();
    stubGog({ meta: PNG_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 24, contentBase64: PNG_B64 } });
    const remote = await asConnector(() => call({}));
    expect(remote.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
    expect(lib.run).not.toHaveBeenCalledWith(expect.arrayContaining(['drive', 'upload']), expect.anything());
  });

  it('a caller-supplied name skips the metadata lookup and names the file directly', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/report.pdf', bytes: 12, contentBase64: PDF_B64 } });
    await call({ name: 'report.pdf' });
    expect(gotGet()).toBe(false);
    expect(dlArgs()).toEqual(['gmail', 'attachment', 'm1', 'a1', '--use-indexed-attachment-ids=false', '--inline', '--inline-max-bytes=3145728', '--out=/tmp/gog-attachments/m1/report.pdf', '--name=report.pdf']);
  });

  it('a named non-image on the connector skips --inline (headed straight to Drive)', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/report.pdf', bytes: 12 }, drive: { file: { id: 'F9' } } });
    await asConnector(() => call({ name: 'report.pdf' }));
    expect(gotGet()).toBe(false);
    expect(dlArgs()).toEqual(['gmail', 'attachment', 'm1', 'a1', '--use-indexed-attachment-ids=false', '--inline-max-bytes=3145728', '--out=/tmp/gog-attachments/m1/report.pdf', '--name=report.pdf']);
  });

  it('resolves the real filename by size and sanitizes path separators (no traversal)', async () => {
    stubGog({
      meta: { attachments: [{ filename: '../../etc/evil.pdf', mimeType: 'application/pdf', size: 10 }] },
      download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 10, contentBase64: PDF_B64 },
    });
    const res = await call({});
    const fileName = JSON.parse(textOf(res)).fileName as string;
    expect(fileName).not.toMatch(/[/\\]/); // single safe segment, no traversal
    expect(fileName).toContain('evil.pdf');
  });

  it('derives an extension from the MIME type when the part has no filename (never *.bin)', async () => {
    stubGog({
      meta: { attachments: [{ mimeType: 'application/pdf', size: 10 }] },
      download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 10, contentBase64: PDF_B64 },
    });
    const res = await call({});
    expect(JSON.parse(textOf(res)).fileName).toBe('attachment.pdf');
  });

  it('falls back to a magic-byte sniff when the size is ambiguous (repeated)', async () => {
    stubGog({
      meta: { attachments: [
        { filename: 'a.pdf', mimeType: 'application/pdf', size: 10 },
        { filename: 'b.pdf', mimeType: 'application/pdf', size: 10 },
      ] },
      download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 10, contentBase64: PDF_B64 },
    });
    const res = await call({});
    // two parts share the size → no unique match → sniff + derived name.
    expect(JSON.parse(textOf(res))).toMatchObject({ fileName: 'attachment.pdf', mimeType: 'application/pdf' });
  });

  it('survives a metadata-lookup failure and still delivers, sniffing the MIME', async () => {
    stubGog({ metaError: new Error('get failed'), download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 24, contentBase64: PNG_B64 } });
    const res = await call({});
    // resolveBySize catches the failure → sniff → image/png.
    expect(res.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
  });

  it('summarizes with "? bytes" when the download reports no size (skips the size lookup)', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/x.png', contentBase64: PNG_B64 }, meta: PNG_LIST });
    const res = await call({ name: 'x.png' });
    expect(gotGet()).toBe(false); // no bytes → no size match needed; name given anyway
    expect(res.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
    expect(textOf(res)).toContain('? bytes');
  });

  it('skips the size lookup entirely when the download reports no bytes and no name', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/attachment', contentBase64: OCTET_B64 } });
    const res = await call({});
    // info.bytes undefined → resolveBySize short-circuits (no `gmail get`).
    expect(gotGet()).toBe(false);
    expect(JSON.parse(textOf(res))).toMatchObject({ delivery: 'file', fileName: 'attachment', mimeType: 'application/octet-stream' });
  });

  it('falls back to application/octet-stream when the message has no attachments array', async () => {
    // meta with no `attachments` key exercises the `?? []` guard in resolveBySize.
    stubGog({ meta: {}, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 12, contentBase64: OCTET_B64 } });
    const res = await call({});
    expect(JSON.parse(textOf(res))).toMatchObject({ delivery: 'file', fileName: 'attachment', mimeType: 'application/octet-stream' });
  });

  it('deliver=inline returns a native image block for an image', async () => {
    stubGog({ meta: PNG_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 24, contentBase64: PNG_B64 } });
    const res = await call({ deliver: 'inline' });
    expect(res.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
  });

  it('deliver=inline forces an embedded resource blob for a non-image', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/doc.pdf', bytes: 12, contentBase64: PDF_B64 } });
    const res = await call({ deliver: 'inline', name: 'doc.pdf' });
    expect(res.content[1]).toEqual({
      type: 'resource',
      resource: { uri: 'gmail-attachment://m1/doc.pdf', mimeType: 'application/pdf', blob: PDF_B64 },
    });
  });

  it('deliver=inline errors when the attachment is too large (no reason field)', async () => {
    // no `path` either → exercises the `info.path ?? outPath` fallback.
    stubGog({ download: { bytes: 9_000_000 } });
    const res = await call({ deliver: 'inline', name: 'big.pdf' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('too large');
    expect(lib.run).not.toHaveBeenCalledWith(expect.arrayContaining(['drive', 'upload']), expect.anything());
  });

  it('deliver=drive skips --inline and uploads, honoring driveFolder and name', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/renamed.png', bytes: 24 }, drive: { file: { id: 'F2', webViewLink: 'https://drive.google.com/file/d/F2/view' } } });
    const res = await call({ deliver: 'drive', driveFolder: 'DIR9', name: 'renamed.png', account: 'me@x.com' });
    expect(dlArgs()).toEqual(['gmail', 'attachment', 'm1', 'a1', '--use-indexed-attachment-ids=false', '--inline-max-bytes=3145728', '--out=/tmp/gog-attachments/m1/renamed.png', '--name=renamed.png']);
    expect(lib.run).toHaveBeenCalledWith(
      ['drive', 'upload', '/tmp/gog-attachments/m1/renamed.png', '--json', '--parent=DIR9', '--name=renamed.png'], { account: 'me@x.com' });
    expect(JSON.parse(textOf(res))).toMatchObject({ deliveredVia: 'drive', id: 'F2' });
  });

  it('deliver=off returns a structured record with the size-resolved filename + mime', async () => {
    stubGog({ meta: PDF_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 99723, cached: true } });
    const res = await call({ deliver: 'off' });
    expect(JSON.parse(textOf(res))).toMatchObject({
      delivery: 'file', path: '/tmp/gog-attachments/m1/attachment', fileName: 'Guest_Copy.pdf', mimeType: 'application/pdf', bytes: 99723, cached: true,
    });
  });

  it('deliver=off on the connector still surfaces the ignored-out note', async () => {
    stubGog({ meta: PDF_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 99723 } });
    const res = await asConnector(() => call({ deliver: 'off', out: '/home/claude/x.pdf' }));
    expect(res.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('`out` was ignored') });
    // the structured record still follows the note.
    expect(JSON.parse((res.content[1] as { text: string }).text)).toMatchObject({ delivery: 'file', fileName: 'Guest_Copy.pdf' });
  });

  it('still reports drive delivery when the upload output lacks a file envelope', async () => {
    stubGog({ meta: PDF_LIST, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 99723 }, drive: {} });
    const res = await asConnector(() => call({}));
    const payload = JSON.parse(textOf(res));
    expect(payload).toMatchObject({ deliveredVia: 'drive' });
    expect(payload.id).toBeUndefined();
  });

  it('honors a caller out on stdio', async () => {
    stubGog({ download: { path: '/home/me/x.png', bytes: 24, contentBase64: PNG_B64 } });
    await call({ out: '/home/me/x.png', name: 'x.png' });
    expect(dlArgs()).toEqual(['gmail', 'attachment', 'm1', 'a1', '--use-indexed-attachment-ids=false', '--inline', '--inline-max-bytes=3145728', '--out=/home/me/x.png', '--name=x.png']);
  });

  it('ignores a caller out on the connector and notes it', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/report.pdf', bytes: 12 }, drive: { file: { id: 'F3' } } });
    const res = await asConnector(() => call({ out: '/home/claude/report.pdf', name: 'report.pdf' }));
    // download used the temp path, NOT the caller's /home/claude path.
    expect(dlArgs()).toEqual(['gmail', 'attachment', 'm1', 'a1', '--use-indexed-attachment-ids=false', '--inline-max-bytes=3145728', '--out=/tmp/gog-attachments/m1/report.pdf', '--name=report.pdf']);
    expect(textOf(res)).toContain('`out` was ignored');
  });

  it('a caller name that sanitizes to empty falls back to "attachment"', async () => {
    stubGog({ download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 10 } });
    await call({ name: '...' }); // only dots → sanitizes to '' → 'attachment'
    expect(dlArgs()).toEqual(expect.arrayContaining(['--name=attachment', '--out=/tmp/gog-attachments/m1/attachment']));
  });

  it('wraps a download failure without leaking the command line or the attachment token', async () => {
    stubGog({ downloadError: new Error('Command failed: gog gmail attachment m1 a1 --out=/home/claude/x.pdf\nmkdir /home/claude: permission denied') });
    const res = await call({});
    expect(lib.diagnose).toHaveBeenCalled();
    const passed = (vi.mocked(lib.diagnose).mock.calls[0][0] as Error).message;
    expect(passed).not.toContain('Command failed');
    expect(passed).not.toContain('a1');
    expect(passed).not.toContain('m1');
    expect(passed).toContain('permission denied');
    expect(res.isError).toBe(true);
  });

  it('wraps a non-Error rejection', async () => {
    stubGog({ downloadError: 'weird string failure' });
    await call({});
    expect((vi.mocked(lib.diagnose).mock.calls[0][0] as Error).message).toBe('weird string failure');
  });

  it('falls back to a generic message when the error is nothing but the command echo', async () => {
    stubGog({ downloadError: new Error('Command failed: gog gmail attachment m1 a1\n') });
    await call({});
    expect((vi.mocked(lib.diagnose).mock.calls[0][0] as Error).message).toBe('the download failed on the server');
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
      ['gmail', 'thread', 'get', 't1', '--use-indexed-attachment-ids=false'],
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
      ['gmail', 'thread', 'get', 't1', '--download', '--full', '--sanitize-content', '--out-dir=/tmp/atts', '--use-indexed-attachment-ids=false'],
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
      ['gmail', 'thread', 'get', 't1', '--use-indexed-attachment-ids=false'],
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
    expect(vi.mocked(lib.runOrDiagnose).mock.calls[0]![0]).toEqual(['gmail', 'thread', 'get', 't1', '--use-indexed-attachment-ids=false']);
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
      ['gmail', 'thread', 'attachments', 't1', '--use-indexed-attachment-ids=false'],
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
      ['gmail', 'thread', 'attachments', 't1', '--download', '--out-dir=/tmp/atts', '--use-indexed-attachment-ids=false'],
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
      ['gmail', 'drafts', 'get', 'd1', '--use-indexed-attachment-ids=false'],
      { account: undefined },
    );
  });

  it('passes --download when true', async () => {
    await harness.callTool('gog_gmail_drafts_get', { draftId: 'd1', download: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'get', 'd1', '--download', '--use-indexed-attachment-ids=false'],
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
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello', '--auto-from-addressed-alias=false'],
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
        '--from=me@x.com', '--auto-from-addressed-alias=false'
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
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello', '--body-html-file=/tmp/body.html', '--auto-from-addressed-alias=false'],
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
      ['gmail', 'drafts', 'create', '--subject=Re: Hi', '--body=Hello all', '--thread-id=t1', '--reply-all', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('skips recipient flags when omitRecipients is true, even if to/cc/bcc are supplied', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      to: 'a@b.com', cc: 'cc@x.com', bcc: 'bcc@x.com',
      subject: 'Hi', body: 'Hello', omitRecipients: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello', '--auto-from-addressed-alias=false'],
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
      ['gmail', 'drafts', 'create', '--subject=Hi', '--body=Hello', '--auto-from-addressed-alias=false'], { account: undefined });
    expect(lib.runOrDiagnose).toHaveBeenNthCalledWith(2,
      ['gmail', 'drafts', 'get', 'd9', '--use-indexed-attachment-ids=false'], { account: undefined });
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
      ['gmail', 'drafts', 'create', '--subject=Re: roof', '--body=Sounds good', '--thread-id=19dffe06f9668b28', '--auto-from-addressed-alias=false'],
      { account: 'me@x.com' },
    );
  });

  it('passes replyToThreadId as --thread-id on update', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', replyToThreadId: 't1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--thread-id=t1', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('replyToMessageId wins when both ids are supplied (no --thread-id)', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'S', body: 'B', replyToMessageId: 'mExplicit', replyToThreadId: 't1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'create', '--subject=S', '--body=B', '--reply-to-message-id=mExplicit', '--auto-from-addressed-alias=false'],
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
      ['gmail', 'drafts', 'update', 'd1', '--subject=New subject', '--body=New body', '--auto-from-addressed-alias=false'],
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
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--attach=/tmp/x.pdf', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('skips recipient flags when omitRecipients is true', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', to: 'a@b.com', subject: 'S', body: 'B', omitRecipients: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('passes --clear-attachments when clearAttachments is true', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', clearAttachments: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--auto-from-addressed-alias=false', '--clear-attachments'],
      { account: undefined },
    );
  });

  it('passes --clear-reply-context when clearReplyContext is true', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', clearReplyContext: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--auto-from-addressed-alias=false', '--clear-reply-context'],
      { account: undefined },
    );
  });

  // A plain update carries no reply flags at all: gog preserves the draft's own
  // reply context and threadId. Passing a reply target here would re-anchor the
  // draft, so the wrapper must stay silent when the caller says nothing.
  it('sends no reply or thread flags when no reply target is supplied', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B',
    });
    const args = vi.mocked(lib.runOrDiagnose).mock.calls[0]?.[0] as string[];
    expect(args.some((a) => a.startsWith('--reply-to-message-id'))).toBe(false);
    expect(args.some((a) => a.startsWith('--thread-id'))).toBe(false);
    expect(args).not.toContain('--clear-reply-context');
  });

  it('combines clearAttachments and clearReplyContext', async () => {
    await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', clearAttachments: true, clearReplyContext: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B',
        '--auto-from-addressed-alias=false', '--clear-attachments', '--clear-reply-context'],
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
      ['gmail', 'drafts', 'get', 'd1', '--use-indexed-attachment-ids=false'], { account: undefined });
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
      ['gmail', 'reply', 'm1', '--body=Thanks', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('passes all reply flags including repeatable recipients', async () => {
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
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'gmail', 'reply', 'm1',
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
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: 'Hi', noQuote: false, signature: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'reply', 'm1', '--body=Hi', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });
});

describe('gog_gmail_reply_all', () => {
  it('uses the reply-all subcommand', async () => {
    await harness.callTool('gog_gmail_reply_all', { messageId: 'm1', body: 'Thanks all' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'reply-all', 'm1', '--body=Thanks all', '--auto-from-addressed-alias=false'],
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
        '--signature-file=/tmp/sig.html', '--auto-from-addressed-alias=false'
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
      ['gmail', 'messages', 'search', 'from:alice', '--include-attachments=false', '--use-indexed-attachment-ids=false'],
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
      ['gmail', 'messages', 'search', 'is:unread', '--max=10', '--page=tok', '--all', '--include-body', '--full', '--body-format=html', '--include-attachments=false', '--use-indexed-attachment-ids=false'],
      { account: 'me@x.com' },
    );
  });

  it('omits flags when false/absent', async () => {
    await harness.callTool('gog_gmail_messages_search', { query: 'x', all: false, includeBody: false, full: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'messages', 'search', 'x', '--include-attachments=false', '--use-indexed-attachment-ids=false'],
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

// Large message bodies cannot travel in argv: the hosted Fly runner rejects any
// single arg over its cap and the Linux kernel caps MAX_ARG_STRLEN at 128 KiB.
// payloadArg swaps an oversize value for a GogFileArg that the executor
// materializes as a temp file. These tests pin the boundary behavior at the
// tool surface: small bodies stay inline, large ones become file args, and the
// rest of the flag set is unaffected either way.
describe('large payloads route to file args', () => {
  const big = 'x'.repeat(lib.PAYLOAD_INLINE_MAX + 1);
  const bigHtml = `<table>${'<tr><td>cell</td></tr>'.repeat(600)}</table>`;

  // Pull the args array out of the single runOrDiagnose call under test.
  function args(): lib.GogArg[] {
    return vi.mocked(lib.runOrDiagnose).mock.calls[0]![0];
  }

  it('keeps a body at exactly the threshold inline', async () => {
    const atLimit = 'x'.repeat(lib.PAYLOAD_INLINE_MAX);
    await harness.callTool('gog_gmail_drafts_create', { subject: 'S', body: atLimit });
    expect(args()).toEqual(['gmail', 'drafts', 'create', '--subject=S', `--body=${atLimit}`, '--auto-from-addressed-alias=false']);
  });

  it('measures bytes, not characters, so a multibyte body crosses earlier', async () => {
    // Each emoji is 2 UTF-16 units but 4 UTF-8 bytes, so this sits comfortably
    // under the threshold by .length yet well over it by byte count.
    const emoji = '😀'.repeat(1500);
    expect(emoji.length).toBeLessThan(lib.PAYLOAD_INLINE_MAX);
    expect(Buffer.byteLength(emoji, 'utf8')).toBeGreaterThan(lib.PAYLOAD_INLINE_MAX);
    await harness.callTool('gog_gmail_drafts_create', { subject: 'S', body: emoji });
    expect(args()[4]).toEqual({ kind: 'file', flag: 'body-file', contents: emoji, ext: undefined });
  });

  it('gog_gmail_drafts_create routes a large body to --body-file', async () => {
    await harness.callTool('gog_gmail_drafts_create', { subject: 'S', body: big });
    expect(args()).toEqual([
      'gmail', 'drafts', 'create',
      '--subject=S',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined }, '--auto-from-addressed-alias=false'
    ]);
  });

  it('gog_gmail_drafts_create routes a large bodyHtml to --body-html-file with an html ext', async () => {
    expect(Buffer.byteLength(bigHtml)).toBeGreaterThan(12_000);
    await harness.callTool('gog_gmail_drafts_create', { subject: 'S', body: 'plain', bodyHtml: bigHtml });
    expect(args()).toEqual([
      'gmail', 'drafts', 'create',
      '--subject=S',
      '--body=plain',
      { kind: 'file', flag: 'body-html-file', contents: bigHtml, ext: 'html' }, '--auto-from-addressed-alias=false'
    ]);
  });

  it('gog_gmail_drafts_update routes a large body to --body-file', async () => {
    await harness.callTool('gog_gmail_drafts_update', { draftId: 'd1', subject: 'S', body: big });
    expect(args()).toEqual([
      'gmail', 'drafts', 'update', 'd1',
      '--subject=S',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined }, '--auto-from-addressed-alias=false'
    ]);
  });

  it('omitRecipients still suppresses to/cc/bcc alongside a large body', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'S', body: big, to: 'a@b.com', cc: 'c@d.com', bcc: 'e@f.com', omitRecipients: true,
    });
    expect(args()).toEqual([
      'gmail', 'drafts', 'create',
      '--subject=S',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined }, '--auto-from-addressed-alias=false'
    ]);
  });

  it('threading and attachments still apply alongside a large body', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'S', body: big, replyToThreadId: 't1', attach: ['/tmp/a.pdf'],
    });
    expect(args()).toEqual([
      'gmail', 'drafts', 'create',
      '--subject=S',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
      '--thread-id=t1',
      '--attach=/tmp/a.pdf', '--auto-from-addressed-alias=false'
    ]);
  });

  it('replyToMessageId still wins over replyToThreadId alongside a large body', async () => {
    await harness.callTool('gog_gmail_drafts_create', {
      subject: 'S', body: big, replyToMessageId: 'm1', replyToThreadId: 't1',
    });
    expect(args()).toContain('--reply-to-message-id=m1');
    expect(args()).not.toContain('--thread-id=t1');
  });

  it('gog_gmail_reply routes a large body and bodyHtml to file args', async () => {
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: big, bodyHtml: bigHtml });
    expect(args()).toEqual([
      'gmail', 'reply', 'm1',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
      { kind: 'file', flag: 'body-html-file', contents: bigHtml, ext: 'html' }, '--auto-from-addressed-alias=false'
    ]);
  });

  it('gog_gmail_reply_all routes a large body to --body-file, leaving the signature boolean a bare flag', async () => {
    await harness.callTool('gog_gmail_reply_all', { messageId: 'm1', body: big, signature: true });
    expect(args()).toEqual([
      'gmail', 'reply-all', 'm1',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
      '--signature', '--auto-from-addressed-alias=false'
    ]);
  });

  it('gog_gmail_forward routes a large note to --note-file', async () => {
    await harness.callTool('gog_gmail_forward', { messageId: 'm1', to: 'a@b.com', note: big });
    expect(args()).toEqual([
      'gmail', 'forward', 'm1', '--to=a@b.com',
      { kind: 'file', flag: 'note-file', contents: big, ext: undefined },
    ]);
  });

  it('gog_gmail_autoreply routes a large body to --body-file but keeps bodyHtml inline', async () => {
    // gog 0.34.1 gives `gmail autoreply` a --body-file but no --body-html-file.
    await harness.callTool('gog_gmail_autoreply', { query: 'is:unread', body: big, bodyHtml: '<p>Hi</p>' });
    expect(args()).toEqual([
      'gmail', 'autoreply', 'is:unread',
      { kind: 'file', flag: 'body-file', contents: big, ext: undefined },
      '--body-html=<p>Hi</p>',
    ]);
  });

  it('gog_gmail_vacation_update keeps a large body inline (gog has no --body-file there)', async () => {
    await harness.callTool('gog_gmail_vacation_update', { enable: true, body: big });
    expect(args()).toEqual(['gmail', 'settings', 'vacation', 'update', '--enable', `--body=${big}`]);
  });
});

// gog hard-errors when an inline flag and its --*-file twin are both present
// ("use only one of --body-html or --body-html-file"). The tools reject the
// combination up front so the caller sees which PARAMS collided.
describe('inline/file param conflicts are rejected before gog runs', () => {
  it('gog_gmail_drafts_create rejects bodyHtml plus bodyHtmlFile', async () => {
    const res = await harness.callTool('gog_gmail_drafts_create', {
      subject: 'S', body: 'B', bodyHtml: '<p>Hi</p>', bodyHtmlFile: '/tmp/b.html',
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('bodyHtml and bodyHtmlFile are mutually exclusive');
    expect(lib.runOrDiagnose).not.toHaveBeenCalled();
  });

  it('gog_gmail_drafts_update rejects bodyHtml plus bodyHtmlFile', async () => {
    const res = await harness.callTool('gog_gmail_drafts_update', {
      draftId: 'd1', subject: 'S', body: 'B', bodyHtml: '<p>Hi</p>', bodyHtmlFile: '/tmp/b.html',
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('mutually exclusive');
    expect(lib.runOrDiagnose).not.toHaveBeenCalled();
  });

  it('gog_gmail_reply rejects bodyHtml plus bodyHtmlFile', async () => {
    const res = await harness.callTool('gog_gmail_reply', {
      messageId: 'm1', bodyHtml: '<p>Hi</p>', bodyHtmlFile: '/tmp/b.html',
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('bodyHtml and bodyHtmlFile are mutually exclusive');
    expect(lib.runOrDiagnose).not.toHaveBeenCalled();
  });

  it('an empty-string bodyHtml still counts as supplied and conflicts', async () => {
    // Guards the `!== undefined` check against a falsy-but-present value
    // sliding through to gog, which rejects the pair regardless of content.
    const res = await harness.callTool('gog_gmail_reply', {
      messageId: 'm1', body: 'B', bodyHtml: '', bodyHtmlFile: '/tmp/b.html',
    });
    expect(res.isError).toBe(true);
    expect(lib.runOrDiagnose).not.toHaveBeenCalled();
  });

  it('bodyHtmlFile alone still passes through as --body-html-file', async () => {
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: 'Hi', bodyHtmlFile: '/tmp/b.html' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'reply', 'm1', '--body=Hi', '--body-html-file=/tmp/b.html', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });
});

// ---------------------------------------------------------------------------
// gog 0.35.0 capabilities (MIN_GOG_VERSION floor).
//
// Every flag below is env-bound in gog, so an ambient GOG_GMAIL_* var on the
// host silently changes the SHAPE of the output (or, for the attachment
// download, makes gog reject the caller's own argument). runner.ts strips only
// *_TOKEN/*_SECRET/*_API_KEY/*_PRIVATE_KEY, and on the remote runner the child
// env belongs to a backend this wrapper does not control — so the tests below
// assert the flag is PINNED on every call, not merely pushed when true.
// ---------------------------------------------------------------------------

describe('gog 0.35.0 — indexed attachment ids (gog_gmail_attachment)', () => {
  const PDF_B64 = 'JVBERi0xLjUKJVBFRgo=';
  const INDEXED_LIST = {
    attachments: [
      { filename: 'cover.png', mimeType: 'image/png', attachmentIndex: 0, size: 11 },
      { filename: 'Guest_Copy.pdf', mimeType: 'application/pdf', attachmentIndex: 1, size: 99723 },
    ],
  };

  function stub(opts: { meta?: unknown; metaError?: Error; download?: unknown; downloadError?: unknown }): void {
    vi.mocked(lib.run).mockImplementation(async (args) => {
      const a = args as string[];
      if (a[0] === 'gmail' && a[1] === 'get') {
        if (opts.metaError) throw opts.metaError;
        return JSON.stringify(opts.meta ?? { attachments: [] });
      }
      if (a[0] === 'gmail' && a[1] === 'attachment') {
        if (opts.downloadError) throw opts.downloadError;
        return JSON.stringify(opts.download ?? {});
      }
      return '{}';
    });
  }
  const runArgs = () => vi.mocked(lib.run).mock.calls.map((c) => c[0] as string[]);
  const dlArgs = () => runArgs().find((a) => a[1] === 'attachment')!;
  const textOf = (res: { content: unknown[] }) => (res.content[0] as { text: string }).text;

  it('resolves the real filename BEFORE the download and never runs the size heuristic', async () => {
    stub({ meta: INDEXED_LIST, download: { path: '/tmp/gog-attachments/m1/Guest_Copy.pdf', bytes: 99723, contentBase64: PDF_B64 } });
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 1 });
    // exactly one metadata read, and it happens BEFORE the download.
    expect(runArgs().map((a) => a.slice(0, 2))).toEqual([['gmail', 'get'], ['gmail', 'attachment']]);
    expect(runArgs()[0]).toEqual(['gmail', 'get', 'm1', '--use-indexed-attachment-ids']);
    // the index rides in the positional slot, and gog is told to read it as one.
    expect(dlArgs()).toEqual([
      'gmail', 'attachment', 'm1', '1', '--use-indexed-attachment-ids', '--inline', '--inline-max-bytes=3145728',
      '--out=/tmp/gog-attachments/m1/Guest_Copy.pdf', '--name=Guest_Copy.pdf',
    ]);
    expect(JSON.parse(textOf(res))).toMatchObject({ fileName: 'Guest_Copy.pdf', mimeType: 'application/pdf' });
  });

  it('pins the mode OFF on the legacy attachmentId path', async () => {
    stub({ download: { path: '/tmp/gog-attachments/m1/x.pdf', bytes: 12, contentBase64: PDF_B64 } });
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'OPAQUE1', name: 'x.pdf' });
    expect(dlArgs()).toEqual([
      'gmail', 'attachment', 'm1', 'OPAQUE1', '--use-indexed-attachment-ids=false', '--inline', '--inline-max-bytes=3145728',
      '--out=/tmp/gog-attachments/m1/x.pdf', '--name=x.pdf',
    ]);
  });

  it('rejects both attachmentId and attachmentIndex', async () => {
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1', attachmentIndex: 0 });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('exactly one');
    expect(lib.run).not.toHaveBeenCalled();
  });

  it('rejects neither attachmentId nor attachmentIndex', async () => {
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('exactly one');
    expect(lib.run).not.toHaveBeenCalled();
  });

  it('a caller-supplied name skips the index lookup', async () => {
    stub({ meta: INDEXED_LIST, download: { path: '/tmp/gog-attachments/m1/mine.pdf', bytes: 5, contentBase64: PDF_B64 } });
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 1, name: 'mine.pdf' });
    expect(runArgs().some((a) => a[1] === 'get')).toBe(false);
  });

  it('survives an index lookup failure without falling back to the size heuristic', async () => {
    stub({ metaError: new Error('get failed'), download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 12, contentBase64: PDF_B64 } });
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 0 });
    // only the (failed) pre-download lookup — resolveBySize must not run after it.
    expect(runArgs().filter((a) => a[1] === 'get')).toHaveLength(1);
    expect(JSON.parse(textOf(res))).toMatchObject({ fileName: 'attachment.pdf', mimeType: 'application/pdf' });
  });

  it('tolerates a message whose listing carries no attachments array', async () => {
    stub({ meta: {}, download: { path: '/tmp/gog-attachments/m1/attachment', bytes: 12, contentBase64: PDF_B64 } });
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 3 });
    expect(JSON.parse(textOf(res))).toMatchObject({ fileName: 'attachment.pdf' });
  });

  it('uses the filename/mimeType gog itself reports on an --inline download', async () => {
    // gog >= 0.34 returns the part metadata alongside the bytes; prefer it over
    // any wrapper-side guess.
    stub({ meta: { attachments: [{}] }, download: {
      path: '/tmp/gog-attachments/m1/attachment', bytes: 12, contentBase64: PDF_B64,
      filename: 'From_Gog.pdf', mimeType: 'application/pdf',
    } });
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 0 });
    expect(JSON.parse(textOf(res))).toMatchObject({ fileName: 'From_Gog.pdf', mimeType: 'application/pdf' });
  });

  it('prefers a caller name over the one gog reports', async () => {
    stub({ download: {
      path: '/tmp/gog-attachments/m1/mine.pdf', bytes: 12, contentBase64: PDF_B64,
      filename: 'From_Gog.pdf', mimeType: 'application/pdf',
    } });
    const res = await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 0, name: 'mine.pdf' });
    expect(JSON.parse(textOf(res))).toMatchObject({ fileName: 'mine.pdf', mimeType: 'application/pdf' });
  });

  it('passes inlineMaxBytes through as --inline-max-bytes', async () => {
    stub({ meta: INDEXED_LIST, download: { path: '/tmp/gog-attachments/m1/cover.png', bytes: 11 } });
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 0, inlineMaxBytes: 1048576 });
    expect(dlArgs()).toEqual([
      'gmail', 'attachment', 'm1', '0', '--use-indexed-attachment-ids', '--inline', '--inline-max-bytes=1048576',
      '--out=/tmp/gog-attachments/m1/cover.png', '--name=cover.png',
    ]);
  });

  it('does not mangle an indexed failure message while redacting (no bare-digit substitution)', async () => {
    stub({ downloadError: new Error('Command failed: gog gmail attachment m1 0\nquota exceeded: 1000 requests') });
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentIndex: 0 });
    const passed = (vi.mocked(lib.diagnose).mock.calls[0]![0] as Error).message;
    expect(passed).toBe('quota exceeded: 1000 requests');
  });
});

describe('gog 0.35.0 — indexed ids are pinned on every listing that emits attachments', () => {
  const args = () => vi.mocked(lib.runOrDiagnose).mock.calls[0]![0] as string[];

  it('gog_gmail_thread_get pins the mode off by default and on when asked', async () => {
    await harness.callTool('gog_gmail_thread_get', { threadId: 't1' });
    expect(args()).toEqual(['gmail', 'thread', 'get', 't1', '--use-indexed-attachment-ids=false']);
    vi.clearAllMocks();
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
    await harness.callTool('gog_gmail_thread_get', { threadId: 't1', useIndexedAttachmentIds: true });
    expect(args()).toEqual(['gmail', 'thread', 'get', 't1', '--use-indexed-attachment-ids']);
  });

  it('gog_gmail_thread_attachments pins the mode — a flat list needs per-message indexes', async () => {
    await harness.callTool('gog_gmail_thread_attachments', { threadId: 't1' });
    expect(args()).toEqual(['gmail', 'thread', 'attachments', 't1', '--use-indexed-attachment-ids=false']);
    vi.clearAllMocks();
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
    await harness.callTool('gog_gmail_thread_attachments', { threadId: 't1', useIndexedAttachmentIds: true, download: true });
    expect(args()).toEqual(['gmail', 'thread', 'attachments', 't1', '--download', '--use-indexed-attachment-ids']);
  });

  it('gog_gmail_drafts_get pins the mode', async () => {
    await harness.callTool('gog_gmail_drafts_get', { draftId: 'd1' });
    expect(args()).toEqual(['gmail', 'drafts', 'get', 'd1', '--use-indexed-attachment-ids=false']);
    vi.clearAllMocks();
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
    await harness.callTool('gog_gmail_drafts_get', { draftId: 'd1', useIndexedAttachmentIds: true, download: true });
    expect(args()).toEqual(['gmail', 'drafts', 'get', 'd1', '--download', '--use-indexed-attachment-ids']);
  });

  it('gog_gmail_messages_search pins BOTH attachment-shaping flags', async () => {
    await harness.callTool('gog_gmail_messages_search', { query: 'x' });
    expect(args()).toEqual([
      'gmail', 'messages', 'search', 'x', '--include-attachments=false', '--use-indexed-attachment-ids=false',
    ]);
    vi.clearAllMocks();
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
    await harness.callTool('gog_gmail_messages_search', { query: 'x', includeAttachments: true, useIndexedAttachmentIds: true });
    expect(args()).toEqual([
      'gmail', 'messages', 'search', 'x', '--include-attachments', '--use-indexed-attachment-ids',
    ]);
  });
});

describe('gog 0.35.0 — --auto-from-addressed-alias is pinned on every send-shaped write', () => {
  const args = () => vi.mocked(lib.runOrDiagnose).mock.calls[0]![0] as string[];

  it('gog_gmail_drafts_create pins it off, and sets it when asked', async () => {
    await harness.callTool('gog_gmail_drafts_create', { subject: 'S', body: 'B' });
    expect(args()).toEqual(['gmail', 'drafts', 'create', '--subject=S', '--body=B', '--auto-from-addressed-alias=false']);
    vi.clearAllMocks();
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
    await harness.callTool('gog_gmail_drafts_create', { subject: 'S', body: 'B', autoFromAddressedAlias: true });
    expect(args()).toEqual(['gmail', 'drafts', 'create', '--subject=S', '--body=B', '--auto-from-addressed-alias']);
  });

  it('gog_gmail_drafts_update pins it', async () => {
    await harness.callTool('gog_gmail_drafts_update', { draftId: 'd1', subject: 'S', body: 'B', autoFromAddressedAlias: true });
    expect(args()).toEqual(['gmail', 'drafts', 'update', 'd1', '--subject=S', '--body=B', '--auto-from-addressed-alias']);
  });

  it('gog_gmail_reply and gog_gmail_reply_all pin it', async () => {
    await harness.callTool('gog_gmail_reply', { messageId: 'm1', body: 'Hi' });
    expect(args()).toEqual(['gmail', 'reply', 'm1', '--body=Hi', '--auto-from-addressed-alias=false']);
    vi.clearAllMocks();
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
    await harness.callTool('gog_gmail_reply_all', { messageId: 'm1', body: 'Hi', autoFromAddressedAlias: true });
    expect(args()).toEqual(['gmail', 'reply-all', 'm1', '--body=Hi', '--auto-from-addressed-alias']);
  });
});

describe('gog 0.35.0 — gog_gmail_import', () => {
  const args = () => vi.mocked(lib.runOrDiagnose).mock.calls[0]![0] as string[];

  it('imports a file with no options', async () => {
    await harness.callTool('gog_gmail_import', { file: '/tmp/msg.eml' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['gmail', 'import', '/tmp/msg.eml'], { account: undefined });
  });

  it('passes every option, repeating --label', async () => {
    await harness.callTool('gog_gmail_import', {
      file: '/srv/exports/archived.eml',
      labels: ['INBOX', 'Archive/2026'],
      internalDateSource: 'receivedTime',
      neverMarkSpam: true,
      processForCalendar: true,
      account: 'me@x.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['gmail', 'import', '/srv/exports/archived.eml', '--label=INBOX', '--label=Archive/2026', '--internal-date-source=receivedTime', '--never-mark-spam', '--process-for-calendar'],
      { account: 'me@x.com' },
    );
  });

  it('omits flags that are false or absent', async () => {
    await harness.callTool('gog_gmail_import', { file: '/tmp/m.eml', neverMarkSpam: false, processForCalendar: false });
    expect(args()).toEqual(['gmail', 'import', '/tmp/m.eml']);
  });

  it('rejects an internalDateSource outside gog\'s enum', async () => {
    const res = await harness.callTool('gog_gmail_import', { file: '/tmp/m.eml', internalDateSource: 'yesterday' });
    expect(res.isError).toBe(true);
  });

  it('never appends --force — gog gates no confirmation on import', async () => {
    await harness.callTool('gog_gmail_import', { file: '/tmp/m.eml' });
    expect(args()).not.toContain('--force');
  });
});

// gog reads a "-" path argument with io.ReadAll(stdinReader(ctx)) — os.Stdin,
// unaffected by --no-input (gmail_import.go:102, gmail_body_input.go:45 at
// upstream-v0.35.0). runner.ts's spawnGog spawns with default stdio and never
// writes to or ends child.stdin, so gog blocks forever on a read that never
// EOFs: `spawn('gog', ['gmail','import','-','--dry-run','--json','--no-input'])`
// was still running with no output after 5s. Under run() that burns the whole
// 30s timeout and returns "gog timed out after 30s". No description may offer
// it as a usable option.
describe('server-side file params never advertise stdin as usable', () => {
  const STDIN_PARAMS: Array<[tool: string, param: string]> = [
    ['gog_gmail_import', 'file'],
    ['gog_gmail_drafts_create', 'bodyHtmlFile'],
    ['gog_gmail_drafts_update', 'bodyHtmlFile'],
    ['gog_gmail_reply', 'bodyHtmlFile'],
    ['gog_gmail_reply_all', 'bodyHtmlFile'],
  ];

  async function paramDescriptions(): Promise<Map<string, Record<string, { description?: string }>>> {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const configs = new Map<string, Record<string, { description?: string }>>();
    vi.spyOn(server, 'registerTool').mockImplementation((name, config) => {
      configs.set(name, (config as { inputSchema: Record<string, { description?: string }> }).inputSchema);
      return undefined as never;
    });
    registerExtraGmailTools(server);
    return configs;
  }

  it.each(STDIN_PARAMS)('%s.%s warns that stdin hangs instead of offering it', async (tool, param) => {
    const schema = (await paramDescriptions()).get(tool);
    const desc = schema?.[param]?.description ?? '';
    expect(desc).not.toBe('');
    expect(desc).not.toMatch(/(?:or|use)\s+"?-"?\s+(?:for|to read)/i);
    expect(desc).toMatch(/stdin/i);
    expect(desc).toMatch(/hang|never writes/i);
  });
});

// Every env-bound gog flag this tool depends on is pinned on the call, because
// the child env on the remote runner belongs to a backend we do not control.
// --inline-max-bytes is declared env:"GOG_GMAIL_INLINE_MAX_BYTES"
// (gmail_attachment.go:27 at upstream-v0.35.0), so an ambient value would
// silently decide whether contentBase64 comes back at all.
describe('gog_gmail_attachment pins --inline-max-bytes', () => {
  const args = () => vi.mocked(lib.run).mock.calls[0]![0] as string[];

  it('pins gog\'s default when the caller supplies nothing', async () => {
    vi.mocked(lib.run).mockResolvedValue(JSON.stringify({ bytes: 10, contentBase64: 'AAAA', mimeType: 'image/png', filename: 'a.png' }));
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1', deliver: 'inline' });
    expect(args()).toContain('--inline-max-bytes=3145728');
  });

  it('pins the caller\'s value when supplied', async () => {
    vi.mocked(lib.run).mockResolvedValue(JSON.stringify({ bytes: 10, contentBase64: 'AAAA', mimeType: 'image/png', filename: 'a.png' }));
    await harness.callTool('gog_gmail_attachment', { messageId: 'm1', attachmentId: 'a1', deliver: 'inline', inlineMaxBytes: 99 });
    expect(args()).toContain('--inline-max-bytes=99');
  });
});
