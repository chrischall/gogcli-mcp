import { createHash, randomBytes } from 'node:crypto';
import { createSpentTokenStore, readEnvVar, type SpentTokenStore } from '@chrischall/mcp-utils';

// ============================================================================
// THE TOKEN FALLBACK's gogcli-mcp half. The mechanism — HMAC-bound, expiring,
// single-use confirm tokens, and the two-phase flow for a client that cannot
// show an elicitation prompt — lives in @chrischall/mcp-utils
// (`requireConfirmationWithFallback`), which deliberately reads no env. What
// is this server's own is the configuration:
//
//   GOG_SEND_CONFIRM_FALLBACK=token  turns it on (off by default)
//   GOG_CONFIRM_TTL_SECONDS          token lifetime, default 600
//   GOG_CONFIRM_SECRET               HMAC key; default random per process
//
// WHAT THIS DOES AND DOES NOT PROVE: see mcp-utils' confirm-token module. The
// approval is a tool argument, so the gate is the model honouring "show this
// to the user and wait"; the token guarantees what happens matches what was
// previewed, once, for one tool, account and target. Spent tokens are in
// memory, so with a shared GOG_CONFIRM_SECRET a restart or a second instance
// would accept a spent token again until it expires. That is why it is opt-in.
// ============================================================================

export const CONFIRM_TOKEN_TTL_DEFAULT_SECONDS = 600;

let key: Uint8Array | undefined;
const spent = createSpentTokenStore();

/** GOG_SEND_CONFIRM_FALLBACK=token turns the fallback on. Anything else is off. */
export function sendConfirmFallbackEnabled(): boolean {
  return readEnvVar('GOG_SEND_CONFIRM_FALLBACK')?.trim().toLowerCase() === 'token';
}

export function confirmTokenTtlSeconds(): number {
  const raw = readEnvVar('GOG_CONFIRM_TTL_SECONDS')?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return CONFIRM_TOKEN_TTL_DEFAULT_SECONDS;
}

/**
 * The HMAC key. mcp-utils requires at least 32 bytes, and GOG_CONFIRM_SECRET
 * has always accepted any value, so a configured secret is stretched through
 * SHA-256 rather than rejected. GOG_CONFIRM_SECRET ends in _SECRET, so
 * runner.ts strips it from every gog child — it never leaves this process.
 */
export function confirmTokenKey(): Uint8Array {
  if (!key) {
    const configured = readEnvVar('GOG_CONFIRM_SECRET');
    key = configured ? createHash('sha256').update(configured, 'utf8').digest() : randomBytes(32);
  }
  return key;
}

/** This server's spent-token store (one per process). */
export function confirmSpentStore(): SpentTokenStore {
  return spent;
}

/** Test seam: forget the key (a "restart") and every spent token. */
export function resetConfirmTokenState(): void {
  key = undefined;
  spent.clear();
}
