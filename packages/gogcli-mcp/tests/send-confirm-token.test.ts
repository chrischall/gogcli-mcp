import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CONFIRM_TOKEN_TTL_DEFAULT_SECONDS,
  confirmTokenTtlSeconds,
  hashSendPayload,
  issueConfirmToken,
  resetConfirmTokenState,
  sendConfirmFallbackEnabled,
  verifyConfirmToken,
  type ConfirmBinding,
} from '../src/send-confirm-token.js';

const ORIGINAL_ENV = { ...process.env };

const BINDING: ConfirmBinding = {
  tool: 'gog_gmail_drafts_send',
  account: 'me@example.com',
  target: 'r123',
  revision: 'msg-1',
  payloadHash: hashSendPayload({ to: 'a@example.com', body: 'hello' }),
};

const NOW = 1_800_000_000_000;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GOG_SEND_CONFIRM_FALLBACK;
  delete process.env.GOG_CONFIRM_SECRET;
  delete process.env.GOG_CONFIRM_TTL_SECONDS;
  resetConfirmTokenState();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  resetConfirmTokenState();
});

describe('hashSendPayload', () => {
  it('is independent of key order, so a re-read payload hashes the same', () => {
    expect(hashSendPayload({ a: 1, b: { c: 2, d: [1, 2] } }))
      .toBe(hashSendPayload({ b: { d: [1, 2], c: 2 }, a: 1 }));
  });

  it('changes when any value changes, including array order', () => {
    const base = hashSendPayload({ to: ['a', 'b'], body: 'x' });
    expect(hashSendPayload({ to: ['b', 'a'], body: 'x' })).not.toBe(base);
    expect(hashSendPayload({ to: ['a', 'b'], body: 'x ' })).not.toBe(base);
  });

  it('treats an undefined field as absent', () => {
    expect(hashSendPayload({ a: 1, b: undefined })).toBe(hashSendPayload({ a: 1 }));
  });

  it('distinguishes null from absent', () => {
    expect(hashSendPayload({ a: null })).not.toBe(hashSendPayload({}));
  });
});

describe('sendConfirmFallbackEnabled', () => {
  it('is off unless GOG_SEND_CONFIRM_FALLBACK is exactly "token" (case-insensitive)', () => {
    expect(sendConfirmFallbackEnabled()).toBe(false);
    process.env.GOG_SEND_CONFIRM_FALLBACK = '1';
    expect(sendConfirmFallbackEnabled()).toBe(false);
    process.env.GOG_SEND_CONFIRM_FALLBACK = ' Token ';
    expect(sendConfirmFallbackEnabled()).toBe(true);
  });

  it('treats an unresolved .mcpb placeholder as unset', () => {
    process.env.GOG_SEND_CONFIRM_FALLBACK = '${user_config.send_confirm_fallback}';
    expect(sendConfirmFallbackEnabled()).toBe(false);
  });
});

describe('confirmTokenTtlSeconds', () => {
  it('defaults to ten minutes', () => {
    expect(CONFIRM_TOKEN_TTL_DEFAULT_SECONDS).toBe(600);
    expect(confirmTokenTtlSeconds()).toBe(600);
  });

  it('honours a positive integer GOG_CONFIRM_TTL_SECONDS', () => {
    process.env.GOG_CONFIRM_TTL_SECONDS = '30';
    expect(confirmTokenTtlSeconds()).toBe(30);
  });

  it.each(['0', '-5', 'abc', '1.5', ''])('falls back to the default for %j', (value) => {
    process.env.GOG_CONFIRM_TTL_SECONDS = value;
    expect(confirmTokenTtlSeconds()).toBe(600);
  });
});

describe('issueConfirmToken / verifyConfirmToken', () => {
  it('accepts a fresh token for the exact binding it was issued for', () => {
    const { token, expiresAt } = issueConfirmToken(BINDING, NOW);
    expect(expiresAt).toBe(new Date(NOW + 600_000).toISOString());
    expect(verifyConfirmToken(token, BINDING, NOW + 1_000)).toEqual({ ok: true });
  });

  it('is single-use: the second presentation is TOKEN_REUSED', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    expect(verifyConfirmToken(token, BINDING, NOW)).toEqual({ ok: true });
    expect(verifyConfirmToken(token, BINDING, NOW)).toMatchObject({ ok: false, error: 'TOKEN_REUSED' });
  });

  it('expires after the TTL', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    expect(verifyConfirmToken(token, BINDING, NOW + 600_001)).toMatchObject({ ok: false, error: 'TOKEN_EXPIRED' });
  });

  it('uses GOG_CONFIRM_TTL_SECONDS at issue time', () => {
    process.env.GOG_CONFIRM_TTL_SECONDS = '5';
    const { token } = issueConfirmToken(BINDING, NOW);
    expect(verifyConfirmToken(token, BINDING, NOW + 5_001)).toMatchObject({ ok: false, error: 'TOKEN_EXPIRED' });
  });

  it('does not consume a token that failed verification', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    const changed = { ...BINDING, payloadHash: hashSendPayload({ to: 'b@example.com' }) };
    expect(verifyConfirmToken(token, changed, NOW)).toMatchObject({ ok: false, error: 'DRAFT_CHANGED' });
    expect(verifyConfirmToken(token, BINDING, NOW)).toEqual({ ok: true });
  });

  it('reports DRAFT_CHANGED with reason payload-changed when the payload hash differs', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    const changed = { ...BINDING, payloadHash: hashSendPayload({ to: 'a@example.com', body: 'HELLO' }) };
    expect(verifyConfirmToken(token, changed, NOW)).toEqual({ ok: false, error: 'DRAFT_CHANGED', reason: 'payload-changed' });
  });

  it('reports DRAFT_CHANGED with reason message-id-rotated when the revision rotated', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    expect(verifyConfirmToken(token, { ...BINDING, revision: 'msg-2' }, NOW))
      .toEqual({ ok: false, error: 'DRAFT_CHANGED', reason: 'message-id-rotated' });
  });

  it.each([
    ['tool', { tool: 'gog_gmail_send' }],
    ['account', { account: 'other@example.com' }],
    ['draft/message', { target: 'r999' }],
  ] as const)('never accepts a token issued for a different %s', (_label, override) => {
    const { token } = issueConfirmToken(BINDING, NOW);
    expect(verifyConfirmToken(token, { ...BINDING, ...override }, NOW)).toMatchObject({ ok: false, error: 'TOKEN_INVALID' });
  });

  it('rejects a tampered claim as TOKEN_INVALID', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    const [prefix, claims, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(claims!, 'base64url').toString('utf8'));
    decoded.exp += 3_600_000;
    const forged = `${prefix}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
    expect(verifyConfirmToken(forged, BINDING, NOW)).toMatchObject({ ok: false, error: 'TOKEN_INVALID' });
  });

  it('rejects a tampered signature as TOKEN_INVALID', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyConfirmToken(flipped, BINDING, NOW)).toMatchObject({ ok: false, error: 'TOKEN_INVALID' });
  });

  it.each(['', 'garbage', 'gct1.a.b', 'x.y.z', 'gct1..', 'gct1.a.b.c'])('rejects malformed token %j as TOKEN_INVALID', (token) => {
    expect(verifyConfirmToken(token, BINDING, NOW)).toMatchObject({ ok: false, error: 'TOKEN_INVALID' });
  });

  it('rejects a correctly signed token whose claims are not JSON', async () => {
    const { createHmac } = await import('node:crypto');
    process.env.GOG_CONFIRM_SECRET = 'a-shared-secret';
    resetConfirmTokenState();
    const claims = Buffer.from('not json').toString('base64url');
    const sig = createHmac('sha256', 'a-shared-secret').update(`gct1.${claims}`).digest('base64url');
    expect(verifyConfirmToken(`gct1.${claims}.${sig}`, BINDING, NOW)).toMatchObject({ ok: false, error: 'TOKEN_INVALID' });
  });

  it('rejects a token signed by a previous process (per-process secret)', () => {
    const { token } = issueConfirmToken(BINDING, NOW);
    resetConfirmTokenState();
    expect(verifyConfirmToken(token, BINDING, NOW)).toMatchObject({ ok: false, error: 'TOKEN_INVALID' });
  });

  it('with GOG_CONFIRM_SECRET set, a token survives a restart', () => {
    process.env.GOG_CONFIRM_SECRET = 'a-shared-secret';
    resetConfirmTokenState();
    const { token } = issueConfirmToken(BINDING, NOW);
    resetConfirmTokenState();
    expect(verifyConfirmToken(token, BINDING, NOW)).toEqual({ ok: true });
  });

  it('binds a revision-less subject too', () => {
    const noRevision = { ...BINDING, revision: undefined };
    const { token } = issueConfirmToken(noRevision, NOW);
    expect(verifyConfirmToken(token, noRevision, NOW)).toEqual({ ok: true });
  });

  it('forgets used tokens once they would have expired anyway', () => {
    const first = issueConfirmToken(BINDING, NOW);
    expect(verifyConfirmToken(first.token, BINDING, NOW)).toEqual({ ok: true });
    // A later verification prunes the spent entry; the old token is then
    // rejected as expired rather than remembered forever.
    const second = issueConfirmToken(BINDING, NOW + 700_000);
    expect(verifyConfirmToken(second.token, BINDING, NOW + 700_000)).toEqual({ ok: true });
    expect(verifyConfirmToken(first.token, BINDING, NOW + 700_000)).toMatchObject({ ok: false, error: 'TOKEN_EXPIRED' });
  });
});
