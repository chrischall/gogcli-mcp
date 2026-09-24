import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawTextResult } from '@chrischall/mcp-utils';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfirmTokenState } from '../src/send-confirm-token.js';
import {
  GMAIL_DISPATCH_OPS,
  BODY_PREVIEW_MAX,
  CONFIRM_INSTRUCTION,
  attachmentDetails,
  attachmentPreview,
  attachmentNames,
  bodyPreview,
  senderPreview,
  extractEmails,
  logGmailDispatch,
  replyDispatchOp,
  requireGmailDispatchConfirmation,
  resultText,
} from '../src/gmail-dispatch-guard.js';
import type { DispatchTokenFallback, GmailDispatchOp, TokenSubject } from '../src/gmail-dispatch-guard.js';

describe('extractEmails', () => {
  it('extracts a bare address', () => {
    expect(extractEmails('a@example.com')).toEqual(['a@example.com']);
  });

  it('extracts multiple addresses from a display-name header value', () => {
    expect(extractEmails('"Alice" <alice@example.com>, "Bob" <bob@example.org>'))
      .toEqual(['alice@example.com', 'bob@example.org']);
  });

  it('lowercases and dedupes across multiple arguments', () => {
    expect(extractEmails('Alice@Example.com', 'bob@x.com, alice@example.com'))
      .toEqual(['alice@example.com', 'bob@x.com']);
  });

  it('ignores undefined, null, and empty-string inputs', () => {
    expect(extractEmails(undefined, null, '', 'a@b.com')).toEqual(['a@b.com']);
  });

  it('returns an empty array when nothing looks like an email', () => {
    expect(extractEmails('no addresses here', undefined)).toEqual([]);
  });
});

describe('resultText', () => {
  it('reads the text out of a CallToolResult', () => {
    expect(resultText(rawTextResult('{"a":1}'))).toBe('{"a":1}');
  });

  it('falls back to an empty object for a non-text content block', () => {
    expect(resultText({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] })).toBe('{}');
  });

  it('falls back to an empty object when content is empty', () => {
    expect(resultText({ content: [] })).toBe('{}');
  });
});

describe('logGmailDispatch', () => {
  const ORIGINAL_ENV = { ...process.env };
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GOG_GMAIL_TRUSTED_DOMAINS;
    delete process.env.GOG_ACCOUNT;
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    writeSpy.mockRestore();
  });

  function loggedEvent(): Record<string, unknown> {
    expect(writeSpy).toHaveBeenCalledTimes(1);
    return JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
  }

  it('logs a distinguishable gmail_dispatch event with the recipient count', () => {
    logGmailDispatch('gog_gmail_send', ['a@example.com', 'b@example.com']);
    const event = loggedEvent();
    expect(event.event).toBe('gmail_dispatch');
    expect(event.tool).toBe('gog_gmail_send');
    expect(event.recipientCount).toBe(2);
    expect(typeof event.timestamp).toBe('string');
  });

  it('treats the account\'s own domain as trusted by default', () => {
    logGmailDispatch('gog_gmail_reply', ['me@example.com', 'outside@other.com'], 'me@example.com');
    const event = loggedEvent();
    expect(event.hasExternalRecipients).toBe(true);
    expect(event.externalRecipients).toEqual(['outside@other.com']);
    expect(event.externalRecipientCount).toBe(1);
  });

  it('falls back to GOG_ACCOUNT when no account param is passed', () => {
    process.env.GOG_ACCOUNT = 'me@example.com';
    logGmailDispatch('gog_gmail_send', ['me@example.com', 'outside@other.com']);
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual(['outside@other.com']);
  });

  it('adds every domain in GOG_GMAIL_TRUSTED_DOMAINS on top of the account domain', () => {
    process.env.GOG_GMAIL_TRUSTED_DOMAINS = 'law-firm.example, partner.example';
    logGmailDispatch('gog_gmail_reply_all', ['counsel@law-firm.example', 'stranger@random.example'], 'me@example.com');
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual(['stranger@random.example']);
  });

  it('reports no external recipients when every address is trusted', () => {
    logGmailDispatch('gog_gmail_forward', ['me@example.com'], 'me@example.com');
    const event = loggedEvent();
    expect(event.hasExternalRecipients).toBe(false);
    expect(event.externalRecipients).toEqual([]);
  });

  it('treats an account with no @ as contributing no trusted domain', () => {
    logGmailDispatch('gog_gmail_send', ['a@example.com'], 'not-an-email');
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual(['a@example.com']);
  });

  it('ignores an empty segment in GOG_GMAIL_TRUSTED_DOMAINS (e.g. a trailing comma)', () => {
    process.env.GOG_GMAIL_TRUSTED_DOMAINS = 'law-firm.example,,';
    logGmailDispatch('gog_gmail_send', ['counsel@law-firm.example'], 'me@example.com');
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual([]);
  });

  it('treats unresolved desktop placeholders as unset env vars', () => {
    process.env.GOG_GMAIL_TRUSTED_DOMAINS = '${user_config.trusted_domains}';
    process.env.GOG_ACCOUNT = '${user_config.account}';
    logGmailDispatch('gog_gmail_send', ['person@user_config.trusted_domains']);
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual(['person@user_config.trusted_domains']);
  });

  it('treats a recipient with no @ as external, not a crash', () => {
    logGmailDispatch('gog_gmail_send', ['not-an-email'], 'me@example.com');
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual(['not-an-email']);
  });
});

// ============================================================================
// The refusal a client that cannot be asked gets. From #358 until this landed
// it got a protocol -32021 instead, which claude.ai — which declares no MCP
// elicitation capability — rendered as "Error occurred during tool execution".
// ============================================================================
/** A 2026-07-28 request whose envelope declares the CALLER's capabilities. */
function ctxDeclaring(capabilities: unknown): ServerContext {
  return {
    mcpReq: {
      envelope: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': capabilities,
      },
    },
  } as unknown as ServerContext;
}

/** claude.ai's measured shape: extensions and nothing else. */
const CANNOT_BE_ASKED = ctxDeclaring({ extensions: {} });

async function refusalNote(op: GmailDispatchOp): Promise<string> {
  const result = await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, op, {}) as CallToolResult;
  return JSON.parse(resultText(result)).note as string;
}

/**
 * The twin each op must name. Written against `GMAIL_DISPATCH_OPS` rather than
 * as a list of its own, so a sixth dispatch added later fails here until
 * somebody decides whether it stages — `null` being the deliberate "it does
 * not" that `gmail.autoreply` is the only member of today.
 */
const EXPECTED_TWIN: Record<GmailDispatchOp, string | null> = {
  'gmail.send': 'gog_gmail_drafts_create',
  'gmail.reply': 'gog_gmail_drafts_reply',
  'gmail.reply-all': 'gog_gmail_drafts_reply_all',
  'gmail.forward': 'gog_gmail_drafts_forward',
  'gmail.autoreply': null,
  // Sending a draft IS the end of the staging path, and a forwarding filter
  // routes future mail: neither has anything to stage instead.
  'gmail.drafts-send': null,
  'gmail.filter-forward': null,
};

describe('requireGmailDispatchConfirmation on a client that cannot be asked', () => {
  it.each(GMAIL_DISPATCH_OPS.map((op) => [op, EXPECTED_TWIN[op]] as const))(
    'answers %s with its staging twin %s',
    async (op, twin) => {
      const note = await refusalNote(op);
      expect(note).toContain('cannot show a confirmation prompt');
      if (twin === null) {
        // A bulk auto-reply over a search has no draft twin, and naming a tool
        // that does not exist would be worse than saying nothing.
        expect(note).not.toContain('Stage it with');
      } else {
        expect(note).toContain(`Stage it with ${twin} instead`);
        expect(note).toContain('gog_gmail_drafts_send');
      }
    },
  );

  // THE OP COMES FROM THE CALL PATH, NOT FROM THIS FILE. `sendReply` builds it
  // as `gmail.${kind}` off the same `'reply' | 'reply-all'` union the command
  // line uses, so the first cut's `gmail.reply_all` key matched nothing and
  // reply-all silently lost its note — invisible to a test that spelled the op
  // itself. Going through the helper the call site now calls is what closes it.
  it.each([
    ['reply', 'gog_gmail_drafts_reply'],
    ['reply-all', 'gog_gmail_drafts_reply_all'],
  ] as const)('derives the %s op from the real call path', async (kind, twin) => {
    expect(await refusalNote(replyDispatchOp(kind))).toContain(`Stage it with ${twin} instead`);
  });

  // Every staging twin used to point at gog_gmail_drafts_send, which now asks
  // for confirmation too — so on a client that cannot be asked, the way through
  // is the user sending the saved draft from Gmail themselves.
  it('tells a client that cannot be asked that the user sends the staged draft from Gmail', async () => {
    expect(await refusalNote('gmail.send')).toMatch(/send it from Gmail/);
    expect(await refusalNote('gmail.drafts-send')).toMatch(/still saved.*send it from Gmail/);
  });

  it('refuses rather than dispatching, and says so in the payload', async () => {
    const result = await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.forward', {
      messageId: 'm1',
      to: 'someone@example.com',
    }) as CallToolResult;

    expect(JSON.parse(resultText(result))).toMatchObject({
      confirmed: false,
      dispatched: false,
      action: 'gmail.forward',
      reason: 'confirmation-unsupported',
    });
  });

  it('still asks a client that declares form elicitation', async () => {
    expect(await requireGmailDispatchConfirmation(ctxDeclaring({ elicitation: { form: {} } }), 'gmail.forward', {}))
      .toMatchObject({ resultType: 'input_required' });
  });
});

// SEC-5: a confirmation that shows only a body LENGTH lets a prompt-injected
// agent stuff private data into an otherwise-benign reply. The prompt carries
// a bounded preview of the text and the name of every attachment.
describe('bodyPreview', () => {
  it('returns a short body verbatim', () => {
    expect(bodyPreview('Hello there')).toBe('Hello there');
  });

  it('bounds a long body and says how much was cut', () => {
    const long = 'x'.repeat(BODY_PREVIEW_MAX + 500);
    const preview = bodyPreview(long)!;
    expect(preview.startsWith('x'.repeat(BODY_PREVIEW_MAX))).toBe(true);
    expect(preview).toContain('[500 more characters not shown]');
  });

  it('returns undefined when there is no body', () => {
    expect(bodyPreview(undefined)).toBeUndefined();
    expect(bodyPreview('')).toBeUndefined();
  });
});

describe('attachmentNames', () => {
  it('lists server paths in full and inline attachments by filename', () => {
    expect(attachmentNames(['/tmp/a.pdf'], [{ filename: 'b.png' }])).toEqual(['/tmp/a.pdf', 'b.png']);
  });

  it('is empty when nothing is attached', () => {
    expect(attachmentNames(undefined, undefined)).toEqual([]);
  });
});

describe('attachmentDetails', () => {
  it('stats a server path and measures + fingerprints inline bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gct-'));
    const path = join(dir, 'a.txt');
    writeFileSync(path, 'hello');
    const details = attachmentDetails([path, join(dir, 'missing.pdf')], [{ filename: 'b.png', contentBase64: Buffer.from('abc').toString('base64') }]);
    expect(details[0]).toEqual({ name: path, size: 5 });
    expect(details[1]).toEqual({ name: join(dir, 'missing.pdf'), size: null });
    expect(details[2]).toMatchObject({ name: 'b.png', size: 3 });
    expect(details[2]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(attachmentPreview(details)[2]).toEqual({ name: 'b.png', size: 3 });
  });

  it('is empty when nothing is attached', () => {
    expect(attachmentDetails(undefined, undefined)).toEqual([]);
  });
});

// ============================================================================
// THE TOKEN FALLBACK (GOG_SEND_CONFIRM_FALLBACK=token). Elicitation stays the
// primary rail; this only replaces the REFUSAL a client that cannot be prompted
// would otherwise get.
// ============================================================================
describe('requireGmailDispatchConfirmation — token fallback', () => {
  const ORIGINAL_ENV = { ...process.env };
  const CAN_BE_ASKED = ctxDeclaring({ elicitation: { form: {} } });

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GOG_SEND_CONFIRM_FALLBACK;
    delete process.env.GOG_CONFIRM_TTL_SECONDS;
    delete process.env.GOG_CONFIRM_SECRET;
    process.env.GOG_ACCOUNT = 'me@example.com';
    resetConfirmTokenState();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.useRealTimers();
  });

  const subjectOf = (overrides: Partial<TokenSubject> = {}): TokenSubject => ({
    target: 'r1',
    revision: 'msg-1',
    payload: { to: 'a@example.com', bcc: 'hidden@example.com', body: 'hello' },
    preview: { to: 'a@example.com', bcc: 'hidden@example.com', body: 'hello' },
    ...overrides,
  });

  const fallback = (confirmToken?: string, subject: TokenSubject | CallToolResult = subjectOf(), tool = 'gog_gmail_drafts_send'): DispatchTokenFallback => ({
    tool,
    confirmToken,
    subject: vi.fn(() => subject),
  });

  const parse = (r: unknown) => JSON.parse(resultText(r as CallToolResult));

  async function phaseOne(subject = subjectOf(), tool = 'gog_gmail_drafts_send') {
    const r = await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(undefined, subject, tool));
    return parse(r);
  }

  it('with the env unset, keeps the refusal and names the switch', async () => {
    const fb = fallback();
    const r = parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fb));
    expect(r.reason).toBe('confirmation-unsupported');
    expect(r.note).toContain('set GOG_SEND_CONFIRM_FALLBACK=token to enable two-step confirmation');
    expect(r.note).toContain('still saved');
    expect(fb.subject).not.toHaveBeenCalled();
  });

  it('names the switch even for an op with no other note (autoreply)', async () => {
    const r = parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.autoreply', {}, fallback()));
    expect(r.note).toContain('GOG_SEND_CONFIRM_FALLBACK=token');
  });

  it('never offers the switch to a caller that passed no fallback (a forwarding filter)', async () => {
    process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
    const r = parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.filter-forward', {}));
    expect(r.reason).toBe('confirmation-unsupported');
    expect(r.note).not.toContain('GOG_SEND_CONFIRM_FALLBACK');
  });

  it('leaves elicitation untouched even with the env set and a token passed', async () => {
    process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
    const fb = fallback('gct1.anything.here');
    expect(await requireGmailDispatchConfirmation(CAN_BE_ASKED, 'gmail.drafts-send', {}, fb))
      .toMatchObject({ resultType: 'input_required' });
    expect(fb.subject).not.toHaveBeenCalled();
  });

  describe('with GOG_SEND_CONFIRM_FALLBACK=token', () => {
    beforeEach(() => { process.env.GOG_SEND_CONFIRM_FALLBACK = 'token'; });

    it('phase 1 returns the full preview, a token and the instruction, and does not proceed', async () => {
      const r = await phaseOne();
      expect(r).toMatchObject({
        status: 'confirmation-required',
        confirmed: false,
        dispatched: false,
        action: 'gmail.drafts-send',
        preview: { to: 'a@example.com', bcc: 'hidden@example.com', body: 'hello' },
        ttlSeconds: 600,
        instruction: CONFIRM_INSTRUCTION,
      });
      expect(r.instruction).toBe('Show this preview to the user verbatim and send only after they explicitly approve in chat. Then call again with confirmToken.');
      expect(r.confirmToken).toMatch(/^gct1\./);
      expect(typeof r.expiresAt).toBe('string');
    });

    it('phase 2 with a valid token proceeds (undefined)', async () => {
      const { confirmToken } = await phaseOne();
      expect(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken))).toBeUndefined();
    });

    it('DRAFT_CHANGED on a rotated messageId, with a fresh preview and a token that works', async () => {
      const { confirmToken } = await phaseOne();
      const rotated = subjectOf({ revision: 'msg-2' });
      const r = await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken, rotated));
      expect((r as CallToolResult).isError).toBe(true);
      const body = parse(r);
      expect(body).toMatchObject({ status: 'confirmation-rejected', error: 'DRAFT_CHANGED', reason: 'message-id-rotated', dispatched: false, instruction: CONFIRM_INSTRUCTION });
      expect(body.note).toMatch(/messageId/);
      expect(body.confirmToken).not.toBe(confirmToken);
      expect(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(body.confirmToken, rotated))).toBeUndefined();
    });

    it('DRAFT_CHANGED on a changed payload', async () => {
      const { confirmToken } = await phaseOne();
      const edited = subjectOf({ payload: { to: 'a@example.com', body: 'hello!' }, preview: { body: 'hello!' } });
      const body = parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken, edited)));
      expect(body).toMatchObject({ error: 'DRAFT_CHANGED', reason: 'payload-changed', preview: { body: 'hello!' } });
    });

    it('TOKEN_REUSED on a second presentation', async () => {
      const { confirmToken } = await phaseOne();
      await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken));
      const r = await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken));
      expect((r as CallToolResult).isError).toBe(true);
      expect(parse(r)).toMatchObject({ status: 'confirmation-rejected', error: 'TOKEN_REUSED', dispatched: false, action: 'gmail.drafts-send' });
    });

    it('TOKEN_EXPIRED after the TTL', async () => {
      process.env.GOG_CONFIRM_TTL_SECONDS = '60';
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
      const { confirmToken } = await phaseOne();
      vi.setSystemTime(new Date('2026-09-24T10:01:01Z'));
      expect(parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken))))
        .toMatchObject({ error: 'TOKEN_EXPIRED', dispatched: false });
    });

    it('TOKEN_INVALID for a tampered token', async () => {
      const { confirmToken } = await phaseOne();
      const tampered = `${confirmToken.slice(0, -3)}xyz`;
      expect(parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(tampered))))
        .toMatchObject({ error: 'TOKEN_INVALID' });
    });

    it('TOKEN_INVALID for a token issued for a different draft', async () => {
      const { confirmToken } = await phaseOne(subjectOf({ target: 'r-other' }));
      expect(parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken))))
        .toMatchObject({ error: 'TOKEN_INVALID' });
    });

    it('TOKEN_INVALID for a token issued by a different tool', async () => {
      const { confirmToken } = await phaseOne(subjectOf(), 'gog_gmail_send');
      expect(parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken))))
        .toMatchObject({ error: 'TOKEN_INVALID' });
    });

    it('binds the account: an explicit account wins over GOG_ACCOUNT', async () => {
      const issued = parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, { ...fallback(), account: 'other@example.com' }));
      expect(parse(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(issued.confirmToken))))
        .toMatchObject({ error: 'TOKEN_INVALID' });
    });

    it('binds to an empty account when none is configured', async () => {
      delete process.env.GOG_ACCOUNT;
      const { confirmToken } = await phaseOne(subjectOf({ revision: undefined }));
      expect(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(confirmToken, subjectOf({ revision: undefined })))).toBeUndefined();
    });

    it('passes back an error result from the subject read unchanged', async () => {
      const failure: CallToolResult = { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
      expect(await requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.drafts-send', {}, fallback(undefined, failure))).toBe(failure);
    });
  });
});

describe('senderPreview', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('prefers an explicit alias, then the account, then GOG_ACCOUNT, then says it is the default', () => {
    process.env = { ...ORIGINAL_ENV, GOG_ACCOUNT: 'env@example.com' };
    expect(senderPreview('acct@example.com', 'alias@example.com')).toBe('alias@example.com');
    expect(senderPreview('acct@example.com')).toBe('acct@example.com');
    expect(senderPreview(undefined)).toBe('env@example.com');
    delete process.env.GOG_ACCOUNT;
    expect(senderPreview(undefined)).toBe("the gog account's default address");
  });
});
