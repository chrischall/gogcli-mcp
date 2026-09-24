import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { issueConfirmToken, verifyConfirmToken } from '@chrischall/mcp-utils';
import {
  CONFIRM_TOKEN_TTL_DEFAULT_SECONDS,
  confirmSpentStore,
  confirmTokenKey,
  confirmTokenTtlSeconds,
  resetConfirmTokenState,
  sendConfirmFallbackEnabled,
} from '../src/send-confirm-token.js';

// The token mechanism itself (HMAC, TTL, single use, binding) lives in
// @chrischall/mcp-utils and is tested there. What stays here is what is
// gogcli-mcp's own: the three env vars and the key derived from them.

const ORIGINAL_ENV = { ...process.env };
const BINDING = { tool: 'gog_gmail_send', account: 'me@example.com', target: '', payloadHash: 'h' };

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

describe('confirmTokenKey', () => {
  it('is 32 random bytes per process: a "restart" invalidates every token', () => {
    const key = confirmTokenKey();
    expect(key).toHaveLength(32);
    expect(confirmTokenKey()).toBe(key);
    const { token } = issueConfirmToken(key, BINDING);
    resetConfirmTokenState();
    expect(verifyConfirmToken(confirmTokenKey(), token, BINDING, { spent: confirmSpentStore() }))
      .toEqual({ ok: false, error: 'TOKEN_INVALID' });
  });

  // mcp-utils requires a key of at least 32 bytes; GOG_CONFIRM_SECRET has
  // always accepted any value, so it is stretched rather than rejected.
  it('derives a stable 32-byte key from GOG_CONFIRM_SECRET of any length, surviving a restart', () => {
    process.env.GOG_CONFIRM_SECRET = 'short';
    const key = confirmTokenKey();
    expect(Buffer.from(key).equals(createHash('sha256').update('short', 'utf8').digest())).toBe(true);
    const { token } = issueConfirmToken(key, BINDING);
    resetConfirmTokenState();
    expect(verifyConfirmToken(confirmTokenKey(), token, BINDING, { spent: confirmSpentStore() })).toEqual({ ok: true });
  });
});

describe('confirmSpentStore', () => {
  it('is one store for the process, emptied by resetConfirmTokenState', () => {
    const { token } = issueConfirmToken(confirmTokenKey(), BINDING);
    expect(verifyConfirmToken(confirmTokenKey(), token, BINDING, { spent: confirmSpentStore() })).toEqual({ ok: true });
    expect(confirmSpentStore().size).toBe(1);
    resetConfirmTokenState();
    expect(confirmSpentStore().size).toBe(0);
  });
});
