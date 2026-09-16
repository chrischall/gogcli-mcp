import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawTextResult } from '@chrischall/mcp-utils';
import {
  confirmedParam,
  dispatchPreviewResult,
  extractEmails,
  logGmailDispatch,
  resultText,
} from '../src/gmail-dispatch-guard.js';

describe('confirmedParam', () => {
  it('is optional and defaults to undefined (unconfirmed)', () => {
    expect(confirmedParam.parse(undefined)).toBeUndefined();
    expect(confirmedParam.parse(true)).toBe(true);
    expect(confirmedParam.parse(false)).toBe(false);
  });
});

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

describe('dispatchPreviewResult', () => {
  it('marks the result as an unsent preview and carries the supplied details', () => {
    const result = dispatchPreviewResult('gmail.send', { recipients: ['a@b.com'], recipientCount: 1 });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.preview).toBe(true);
    expect(parsed.sent).toBe(false);
    expect(parsed.op).toBe('gmail.send');
    expect(parsed.recipients).toEqual(['a@b.com']);
    expect(parsed.recipientCount).toBe(1);
    expect(parsed.note).toContain('confirmed: true');
  });

  it('is never flagged as an error result', () => {
    const result = dispatchPreviewResult('gmail.reply', {});
    expect(result.isError).toBeUndefined();
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

  it('treats a recipient with no @ as external, not a crash', () => {
    logGmailDispatch('gog_gmail_send', ['not-an-email'], 'me@example.com');
    const event = loggedEvent();
    expect(event.externalRecipients).toEqual(['not-an-email']);
  });
});
