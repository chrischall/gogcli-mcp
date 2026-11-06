import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { blobStoreFromEnv, mintUploadSlot } from '@chrischall/mcp-utils/export';
import { registerGmailTools, appendReplyFlags } from '../../src/tools/gmail.js';
import { registerChatTools } from '../../src/tools/chat.js';
import * as runner from '../../src/runner.js';
import type { GogArg, GogFileArg } from '../../src/runner.js';
import { resetConfirmTokenState } from '../../src/send-confirm-token.js';
import { installFakeBlobStore, type FakeBlobStore } from '../support/fake-blob-store.js';

vi.mock('../../src/runner.js');

// ============================================================================
// blobKeys on the confirm-gated senders (gog_gmail_send / _reply / _reply_all,
// gog_chat_messages_send): the blob is read before the gate, sent as an
// ordinary --attach temp file, and deleted only after gog succeeded. The token
// fallback's preview must not consume anything, and a blob re-PUT between the
// phases must be refused.
// ============================================================================

const ORIGINAL_ENV = { ...process.env };
let fake: FakeBlobStore;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_DATA_DIR;
  delete process.env.MCP_CONFIRM_TTL_SECONDS;
  delete process.env.MCP_CONFIRM_SECRET;
  process.env.MCP_CONFIRM_MODE = 'ask-user';
  process.env.GOG_ACCOUNT = 'me@example.com';
  process.env.GOG_FILE_ROOTS = mkdtempSync(join(tmpdir(), 'blobkeys-roots-'));
  resetConfirmTokenState();
  fake = installFakeBlobStore();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const accepting = { elicitation: async () => ({ action: 'accept' as const, content: { confirmed: true } }) };
const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);

function upload(filename: string, bytes: string, contentType = 'image/jpeg'): string {
  const key = mintUploadSlot(blobStoreFromEnv()!, { filename }).blobKey;
  fake.put(key, bytes, contentType);
  return key;
}

function fileArgs(call: number = 0): GogFileArg[] {
  const args = vi.mocked(runner.run).mock.calls[call]![0] as GogArg[];
  return args.filter((a): a is GogFileArg => typeof a === 'object' && a.kind === 'file');
}

const SEND = { to: 'pat@example.com', subject: 'Photos', body: 'Attached.' };
const deletes = () => fake.requests.filter((r) => r.startsWith('DELETE'));

describe('gog_gmail_send + blobKeys', () => {
  it('attaches the uploaded file under its own name and deletes it after the send', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"sent1"}');
    const key = upload('photo.jpg', 'JPEGBYTES');
    const harness = await createTestHarness(registerGmailTools, accepting);
    const result = await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    expect(fileArgs()).toEqual([expect.objectContaining({
      flag: 'attach', filename: 'photo.jpg', encoding: 'base64', contents: Buffer.from('JPEGBYTES').toString('base64'),
    })]);
    expect(fake.deleted).toEqual([key]);
  });

  it('keeps the blob when gog fails', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('send failed'));
    const key = upload('photo.jpg', 'JPEGBYTES');
    const harness = await createTestHarness(registerGmailTools, accepting);
    const result = await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] });
    expect(result.isError).toBe(true);
    expect(deletes()).toEqual([]);
    expect(fake.blobs.has(key)).toBe(true);
    expect(result.content.map((c) => c.text).join('\n')).toMatch(/kept.*same blobKeys/s);
  });

  it('keeps the blob when the user declines', async () => {
    const key = upload('photo.jpg', 'JPEGBYTES');
    const harness = await createTestHarness(registerGmailTools, {
      elicitation: async () => ({ action: 'decline' as const }),
    });
    await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] });
    expect(runner.run).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
  });

  it('refuses a key it did not mint, fetching nothing and sending nothing', async () => {
    const harness = await createTestHarness(registerGmailTools, accepting);
    const result = await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: ['exports/x/archive.zip'] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not an upload key.*gog_upload_slots/);
    expect(fake.requests).toEqual([]);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('reports a failed delete as a warning, not a failure', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"sent1"}');
    const key = upload('photo.jpg', 'JPEGBYTES');
    fake.failDeletesWith(500);
    const harness = await createTestHarness(registerGmailTools, accepting);
    const result = await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toBe('{"id":"sent1"}');
    expect(result.content[1]!.text).toMatch(/WARNING.*could not be deleted.*photo\.jpg.*Do NOT retry/s);
  });

  describe('token fallback (no elicitation)', () => {
    it('phase 1 previews the blob by name and size, binds its hash, and consumes nothing', async () => {
      const key = upload('photo.jpg', 'JPEGBYTES');
      const harness = await createTestHarness(registerGmailTools);
      const body = json(await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] }));
      expect(body.status).toBe('confirmation-required');
      expect(body.preview.attachments).toEqual([{ name: 'photo.jpg', size: 9 }]);
      expect(runner.run).not.toHaveBeenCalled();
      expect(deletes()).toEqual([]);
      expect(fake.blobs.has(key)).toBe(true);
    });

    it('phase 2 with the same blob sends it and then deletes it', async () => {
      vi.mocked(runner.run).mockResolvedValue('{"id":"sent1"}');
      const key = upload('photo.jpg', 'JPEGBYTES');
      const harness = await createTestHarness(registerGmailTools);
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] }));
      const result = await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key], confirmToken });
      expect(result.content[0]!.text).toBe('{"id":"sent1"}');
      expect(fileArgs()[0]!.contents).toBe(Buffer.from('JPEGBYTES').toString('base64'));
      expect(fake.deleted).toEqual([key]);
    });

    it('a blob re-PUT between preview and approval is DRAFT_CHANGED: nothing sent, nothing deleted', async () => {
      const key = upload('photo.jpg', 'JPEGBYTES');
      const harness = await createTestHarness(registerGmailTools);
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key] }));
      fake.put(key, 'OTHERBYTE', 'image/jpeg'); // same size, different bytes
      const body = json(await harness.callTool('gog_gmail_send', { ...SEND, blobKeys: [key], confirmToken }));
      expect(body).toMatchObject({ error: 'DRAFT_CHANGED', dispatched: false });
      expect(runner.run).not.toHaveBeenCalled();
      expect(deletes()).toEqual([]);
    });
  });
});

describe('gog_gmail_reply / _reply_all + blobKeys', () => {
  const META = JSON.stringify({ headers: { from: 'pat@example.com', to: 'me@example.com', subject: 'Hi', message_id: '<m@x>' } });

  it.each(['gog_gmail_reply', 'gog_gmail_reply_all'])('%s attaches the blob and deletes it after the send', async (tool) => {
    vi.mocked(runner.run).mockImplementation(async (args) => (args[1] === 'get' ? META : '{"id":"r1"}'));
    const key = upload('scan.pdf', '%PDF-1', 'application/pdf');
    const harness = await createTestHarness(registerGmailTools, accepting);
    const result = await harness.callTool(tool, { messageId: 'm1', body: 'See attached.', blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    const last = vi.mocked(runner.run).mock.calls.length - 1;
    expect(fileArgs(last)).toEqual([expect.objectContaining({ flag: 'attach', filename: 'scan.pdf' })]);
    expect(fake.deleted).toEqual([key]);
  });

  it('phase 1 of the token fallback previews the blob and deletes nothing; a re-PUT is refused', async () => {
    vi.mocked(runner.run).mockResolvedValue(META);
    const key = upload('scan.pdf', '%PDF-1', 'application/pdf');
    const harness = await createTestHarness(registerGmailTools);
    const args = { messageId: 'm1', body: 'See attached.', blobKeys: [key] };
    const first = json(await harness.callTool('gog_gmail_reply', args));
    expect(first.preview.attachments).toEqual([{ name: 'scan.pdf', size: 6 }]);
    expect(deletes()).toEqual([]);
    fake.put(key, '%PDF-2', 'application/pdf');
    const second = json(await harness.callTool('gog_gmail_reply', { ...args, confirmToken: first.confirmToken }));
    expect(second).toMatchObject({ error: 'DRAFT_CHANGED', dispatched: false });
    expect(deletes()).toEqual([]);
  });

  it('appendReplyFlags refuses blobKeys that were never read (a caller bug, never a silent drop)', () => {
    expect(() => appendReplyFlags(['gmail', 'reply'], { body: 'x', blobKeys: ['k'] })).toThrow(/blobKeys were not read/);
  });
});

describe('gog_chat_messages_send + blobKeys', () => {
  it('attaches the blob and deletes it after the post', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"name":"spaces/S/messages/1"}');
    const key = upload('photo.jpg', 'JPEGBYTES');
    const harness = await createTestHarness(registerChatTools, accepting);
    const result = await harness.callTool('gog_chat_messages_send', { space: 'spaces/S', blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    expect(fileArgs()).toEqual([expect.objectContaining({ flag: 'attach', filename: 'photo.jpg' })]);
    expect(fake.deleted).toEqual([key]);
  });

  it('phase 1 of the token fallback previews the blob and deletes nothing; a re-PUT is refused', async () => {
    const key = upload('photo.jpg', 'JPEGBYTES');
    const harness = await createTestHarness(registerChatTools);
    const first = json(await harness.callTool('gog_chat_messages_send', { space: 'spaces/S', blobKeys: [key] }));
    expect(first.preview.attachments).toEqual([{ name: 'photo.jpg', size: 9 }]);
    expect(deletes()).toEqual([]);
    fake.put(key, 'OTHERBYTE');
    const second = json(await harness.callTool('gog_chat_messages_send', { space: 'spaces/S', blobKeys: [key], confirmToken: first.confirmToken }));
    expect(second).toMatchObject({ error: 'DRAFT_CHANGED', dispatched: false });
    expect(runner.run).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
  });
});

describe('hosted path refusal on attach', () => {
  it.each([
    ['gog_gmail_send', registerGmailTools, { ...SEND }],
    ['gog_gmail_reply', registerGmailTools, { messageId: 'm1', body: 'x' }],
    ['gog_chat_messages_send', registerChatTools, { space: 'spaces/S', text: 'x' }],
  ] as const)('%s says the server is remote and points at gog_upload_slots', async (tool, register, args) => {
    process.env.MCP_DATA_DIR = '/data';
    const harness = await createTestHarness(register, accepting);
    const result = await harness.callTool(tool, { ...args, attach: ['/Users/someone/photo.jpg'] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/server is remote.*gog_upload_slots.*blobKeys.*attachInline/s);
    expect(runner.run).not.toHaveBeenCalled();
  });
});
