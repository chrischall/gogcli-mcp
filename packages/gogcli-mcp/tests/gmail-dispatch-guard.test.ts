import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawTextResult } from '@chrischall/mcp-utils';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import {
  GMAIL_DISPATCH_OPS,
  extractEmails,
  logGmailDispatch,
  replyDispatchOp,
  requireGmailDispatchConfirmation,
  resultText,
} from '../src/gmail-dispatch-guard.js';
import type { GmailDispatchOp } from '../src/gmail-dispatch-guard.js';

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

function refusalNote(op: GmailDispatchOp): string {
  const result = requireGmailDispatchConfirmation(CANNOT_BE_ASKED, op, {}) as CallToolResult;
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
};

describe('requireGmailDispatchConfirmation on a client that cannot be asked', () => {
  it.each(GMAIL_DISPATCH_OPS.map((op) => [op, EXPECTED_TWIN[op]] as const))(
    'answers %s with its staging twin %s',
    (op, twin) => {
      const note = refusalNote(op);
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
  ] as const)('derives the %s op from the real call path', (kind, twin) => {
    expect(refusalNote(replyDispatchOp(kind))).toContain(`Stage it with ${twin} instead`);
  });

  it('refuses rather than dispatching, and says so in the payload', () => {
    const result = requireGmailDispatchConfirmation(CANNOT_BE_ASKED, 'gmail.forward', {
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

  it('still asks a client that declares form elicitation', () => {
    expect(requireGmailDispatchConfirmation(ctxDeclaring({ elicitation: { form: {} } }), 'gmail.forward', {}))
      .toMatchObject({ resultType: 'input_required' });
  });
});
