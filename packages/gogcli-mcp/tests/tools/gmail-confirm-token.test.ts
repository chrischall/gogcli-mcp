import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { metadataThreadId, registerGmailTools } from '../../src/tools/gmail.js';
import * as runner from '../../src/runner.js';
import { pos } from '../../src/argv.js';
import { resetConfirmTokenState } from '../../src/send-confirm-token.js';

vi.mock('../../src/runner.js');

// ============================================================================
// The two-phase confirmToken fallback on the base package's send tools,
// driven through the real MCP RPC path. A harness registered WITHOUT an
// elicitation handler is a client that declares no elicitation — claude.ai's
// measured shape.
// ============================================================================

const ORIGINAL_ENV = { ...process.env };
let fileRoot: string;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_CONFIRM_MODE;
  delete process.env.MCP_CONFIRM_TTL_SECONDS;
  delete process.env.MCP_CONFIRM_SECRET;
  process.env.GOG_ACCOUNT = 'me@example.com';
  fileRoot = mkdtempSync(join(tmpdir(), 'gct-roots-'));
  process.env.GOG_FILE_ROOTS = fileRoot;
  resetConfirmTokenState();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const noElicitation = () => createTestHarness(registerGmailTools);
const withElicitation = () => createTestHarness(registerGmailTools, {
  elicitation: async () => ({ action: 'accept', content: { confirmed: true } }),
});
const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);
const SENT = '{"id":"sent1"}';

const SEND_ARGS = {
  to: 'alice@example.com',
  cc: 'carol@example.com',
  bcc: 'secret-bcc@example.com',
  subject: 'Quarterly numbers',
  body: 'Hi Alice,\n\nNumbers attached.\n\n— me',
};

const sendCalls = () => vi.mocked(runner.run).mock.calls.filter(([args]) => args[0] === 'gmail' && args[1] === 'send');

describe('gog_gmail_send — token fallback', () => {
  it('elicitation supported: unchanged — prompts and sends, confirmToken or not', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    vi.mocked(runner.run).mockResolvedValue(SENT);
    const harness = await withElicitation();
    const result = await harness.callTool('gog_gmail_send', { ...SEND_ARGS, confirmToken: 'not-a-real-token' });
    expect(result.content[0]!.text).toBe(SENT);
    expect(sendCalls()).toHaveLength(1);
  });

  it('unsupported + MCP_CONFIRM_MODE=refuse: refuses, naming the switch', async () => {

    process.env.MCP_CONFIRM_MODE = 'refuse';
    const harness = await noElicitation();
    const body = json(await harness.callTool('gog_gmail_send', SEND_ARGS));
    expect(body).toMatchObject({ confirmed: false, dispatched: false, reason: 'confirmation-unsupported' });
    expect(body.note).toContain('Set MCP_CONFIRM_MODE=ask-user');
    expect(runner.run).not.toHaveBeenCalled();
  });

  describe('unsupported + MCP_CONFIRM_MODE=ask-user', () => {
    beforeEach(() => { process.env.MCP_CONFIRM_MODE = 'ask-user'; });

    it('phase 1 previews everything (Bcc included, full body) and sends nothing', async () => {
      const long = `${'x'.repeat(5000)}END`;
      const harness = await noElicitation();
      const body = json(await harness.callTool('gog_gmail_send', {
        ...SEND_ARGS,
        body: long,
        threadId: 't1',
        replyToMessageId: 'm0',
        attachInline: [{ filename: 'q3.csv', contentBase64: Buffer.from('a,b\n1,2\n').toString('base64') }],
      }));
      expect(body.status).toBe('confirmation-required');
      expect(body.dispatched).toBe(false);
      expect(body.preview).toEqual({
        from: 'me@example.com',
        to: 'alice@example.com',
        cc: 'carol@example.com',
        bcc: 'secret-bcc@example.com',
        subject: 'Quarterly numbers',
        body: long,
        attachments: [{ name: 'q3.csv', size: 8 }],
        threadId: 't1',
        inReplyTo: 'm0',
        quotesOriginal: false,
      });
      expect(body.confirmToken).toMatch(/^mcpu\.token\.v1\./);
      expect(body.instruction).toMatch(/verbatim/);
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('phase 2 with a valid token sends, exactly once', async () => {
      vi.mocked(runner.run).mockResolvedValue(SENT);
      const harness = await noElicitation();
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', SEND_ARGS));
      const result = await harness.callTool('gog_gmail_send', { ...SEND_ARGS, confirmToken });
      expect(result.content[0]!.text).toBe(SENT);
      expect(sendCalls()).toHaveLength(1);
      expect(sendCalls()[0]![0]).toContain('--bcc=secret-bcc@example.com');

      const again = await harness.callTool('gog_gmail_send', { ...SEND_ARGS, confirmToken });
      expect(json(again)).toMatchObject({ error: 'TOKEN_REUSED', dispatched: false });
      expect(sendCalls()).toHaveLength(1);
    });

    it('phase 2 with ANY changed argument is DRAFT_CHANGED and sends nothing', async () => {
      const harness = await noElicitation();
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', SEND_ARGS));
      const body = json(await harness.callTool('gog_gmail_send', { ...SEND_ARGS, bcc: 'someone-else@example.com', confirmToken }));
      expect(body).toMatchObject({ error: 'DRAFT_CHANGED', reason: 'payload-changed', dispatched: false });
      expect(body.preview.bcc).toBe('someone-else@example.com');
      expect(sendCalls()).toHaveLength(0);
    });

    it('binds a server-side attachment by content: a same-size swap is DRAFT_CHANGED', async () => {
      const path = join(fileRoot, 'report.txt');
      writeFileSync(path, 'v1');
      const harness = await noElicitation();
      const first = json(await harness.callTool('gog_gmail_send', { ...SEND_ARGS, attach: [path] }));
      expect(first.preview.attachments).toEqual([{ name: path, size: 2 }]);
      writeFileSync(path, 'v2');
      const body = json(await harness.callTool('gog_gmail_send', { ...SEND_ARGS, attach: [path], confirmToken: first.confirmToken }));
      expect(body.error).toBe('DRAFT_CHANGED');
      expect(sendCalls()).toHaveLength(0);
    });

    it('rejects an expired token', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
      const harness = await noElicitation();
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', SEND_ARGS));
      vi.setSystemTime(new Date('2026-09-24T10:10:01Z'));
      expect(json(await harness.callTool('gog_gmail_send', { ...SEND_ARGS, confirmToken }))).toMatchObject({ error: 'TOKEN_EXPIRED' });
      expect(sendCalls()).toHaveLength(0);
    });

    it('rejects a tampered token', async () => {
      const harness = await noElicitation();
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', SEND_ARGS));
      const result = await harness.callTool('gog_gmail_send', { ...SEND_ARGS, confirmToken: `${confirmToken}x` });
      expect(result.isError).toBe(true);
      expect(json(result)).toMatchObject({ error: 'TOKEN_INVALID' });
      expect(sendCalls()).toHaveLength(0);
    });

    it('rejects a token issued to a different account', async () => {
      const harness = await noElicitation();
      const { confirmToken } = json(await harness.callTool('gog_gmail_send', { ...SEND_ARGS, account: 'other@example.com' }));
      expect(json(await harness.callTool('gog_gmail_send', { ...SEND_ARGS, confirmToken }))).toMatchObject({ error: 'TOKEN_INVALID' });
    });
  });
});

describe.each([
  ['gog_gmail_reply', 'reply'],
  ['gog_gmail_reply_all', 'reply-all'],
] as const)('%s — token fallback', (tool, subcommand) => {
  const metadata = (messageIdHeader = '<orig@mail.example.com>') => JSON.stringify({
    message: { id: 'm1', threadId: 't1' },
    headers: {
      from: 'Alice <alice@example.com>',
      to: 'me@example.com',
      cc: 'Carol <carol@example.com>',
      subject: 'Contract terms',
      message_id: messageIdHeader,
      references: '<root@mail.example.com>',
    },
  });
  const replyCalls = () => vi.mocked(runner.run).mock.calls.filter(([args]) => args[1] === subcommand);

  beforeEach(() => { process.env.MCP_CONFIRM_MODE = 'ask-user'; });

  it('phase 1 previews the resolved recipients, Bcc, full body and In-Reply-To; nothing sent', async () => {
    vi.mocked(runner.run).mockResolvedValue(metadata());
    const harness = await noElicitation();
    const body = json(await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.', bcc: ['auditor@example.com'] }));
    expect(body.status).toBe('confirmation-required');
    expect(body.preview).toMatchObject({
      from: 'me@example.com',
      to: subcommand === 'reply' ? ['alice@example.com'] : ['alice@example.com', 'me@example.com'],
      cc: subcommand === 'reply' ? [] : ['carol@example.com'],
      bcc: ['auditor@example.com'],
      subject: 'Re: Contract terms',
      body: 'Agreed.',
      quotesOriginal: true,
      threadId: 't1',
      inReplyTo: '<orig@mail.example.com>',
      replyingToMessageId: 'm1',
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(replyCalls()).toHaveLength(0);
  });

  it('phase 2 re-reads the original and sends with a valid token', async () => {
    vi.mocked(runner.run).mockResolvedValue(metadata());
    const harness = await noElicitation();
    const { confirmToken } = json(await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.' }));
    vi.mocked(runner.run).mockResolvedValueOnce(metadata()).mockResolvedValueOnce(SENT);
    const result = await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.', confirmToken });
    expect(result.content[0]!.text).toBe(SENT);
    expect(runner.run).toHaveBeenLastCalledWith(
      ['gmail', subcommand, pos('m1'), '--body=Agreed.', '--auto-from-addressed-alias=false'],
      { account: undefined },
    );
  });

  it('refuses when the original re-reads differently (DRAFT_CHANGED)', async () => {
    vi.mocked(runner.run).mockResolvedValue(metadata());
    const harness = await noElicitation();
    const { confirmToken } = json(await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.' }));
    vi.mocked(runner.run).mockResolvedValue(metadata('<different@mail.example.com>'));
    const body = json(await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.', confirmToken }));
    expect(body).toMatchObject({ error: 'DRAFT_CHANGED', dispatched: false });
    expect(replyCalls()).toHaveLength(0);
  });

  it('rejects a token issued for a different message', async () => {
    vi.mocked(runner.run).mockResolvedValue(metadata());
    const harness = await noElicitation();
    const { confirmToken } = json(await harness.callTool(tool, { messageId: 'm-other', body: 'Agreed.' }));
    expect(json(await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.', confirmToken }))).toMatchObject({ error: 'TOKEN_INVALID' });
    expect(replyCalls()).toHaveLength(0);
  });

  it('shows the alias choice, HTML body, file-backed body and signature when set', async () => {
    vi.mocked(runner.run).mockResolvedValue('not json');
    const htmlPath = join(fileRoot, 'body.html');
    writeFileSync(htmlPath, '<p>hi</p>');
    const harness = await noElicitation();
    const a = json(await harness.callTool(tool, { messageId: 'm1', bodyHtmlFile: htmlPath, autoFromAddressedAlias: true, signature: true, noQuote: true }));
    expect(a.preview).toMatchObject({
      from: 'the send-as alias the original was addressed to',
      bodyHtmlFile: htmlPath,
      signature: 'the Gmail signature of the sending address',
      quotesOriginal: false,
    });
    expect(a.preview.threadId).toBeUndefined();
    const b = json(await harness.callTool(tool, { messageId: 'm1', bodyHtml: '<b>x</b>', from: 'alias@example.com', signatureFrom: 'alias@example.com', remove: ['alice@example.com'] }));
    expect(b.preview).toMatchObject({ from: 'alias@example.com', bodyHtml: '<b>x</b>', signature: 'alias@example.com' });
  });

  it('elicitation supported: unchanged', async () => {
    vi.mocked(runner.run).mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata()).mockResolvedValueOnce(SENT);
    const harness = await withElicitation();
    const result = await harness.callTool(tool, { messageId: 'm1', body: 'Agreed.' });
    expect(result.content[0]!.text).toBe(SENT);
  });
});

describe('metadataThreadId', () => {
  it('reads message.threadId and ignores anything else', () => {
    expect(metadataThreadId('{"message":{"threadId":"t1"}}')).toBe('t1');
    expect(metadataThreadId('{"message":{"threadId":5}}')).toBeUndefined();
    expect(metadataThreadId('null')).toBeUndefined();
    expect(metadataThreadId('not json')).toBeUndefined();
  });
});
