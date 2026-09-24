import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readEnvVar } from '@chrischall/mcp-utils';

// ============================================================================
// THE TOKEN FALLBACK for the Gmail dispatch rail (gmail-dispatch-guard.ts).
//
// A client with no MCP elicitation (claude.ai, measured) cannot be shown the
// confirmation prompt, so every send is refused there. With
// GOG_SEND_CONFIRM_FALLBACK=token the rail instead runs two phases: phase 1
// returns the full preview plus a token and sends nothing; phase 2 presents the
// token, the tool RE-READS what it would send, and dispatches only if that still
// hashes to what the token was issued for.
//
// WHAT THIS DOES AND DOES NOT PROVE. Unlike elicitation, the approval here is a
// tool argument, so the gate is the model honouring "show this to the user and
// wait". The token cannot make the model ask; what it guarantees is that the
// thing sent is byte-for-byte the thing previewed — a draft edited in a mail
// client, a rotated messageId, a changed recipient or a swapped attachment
// between the two calls all refuse — and that one approval sends once, for one
// tool, account and draft, within the TTL. That is why the mode is opt-in.
// ============================================================================

export type ConfirmTokenError = 'DRAFT_CHANGED' | 'TOKEN_EXPIRED' | 'TOKEN_REUSED' | 'TOKEN_INVALID';

/** What a token is bound to. Every field must match on phase 2. */
export interface ConfirmBinding {
  tool: string;
  account: string;
  /** The draftId / messageId / query the dispatch acts on. */
  target: string;
  /** A version of the target that rotates on edit — a draft's messageId. */
  revision?: string;
  /** {@link hashSendPayload} of the canonical send payload. */
  payloadHash: string;
}

export type ConfirmTokenVerdict =
  | { ok: true }
  | { ok: false; error: ConfirmTokenError; reason?: 'payload-changed' | 'message-id-rotated' };

export const CONFIRM_TOKEN_TTL_DEFAULT_SECONDS = 600;

const PREFIX = 'gct1';

type Claims = { t: string; a: string; g: string; r?: string; h: string; iat: number; exp: number; n: string };

let secret: Buffer | undefined;
// nonce → expiry (ms). Entries are dropped once they would have expired
// anyway, so the set is bounded by the tokens spent within one TTL.
const spent = new Map<string, number>();

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

// GOG_CONFIRM_SECRET ends in _SECRET, so runner.ts strips it from every gog
// child — it never leaves this process.
function hmacKey(): Buffer {
  if (!secret) {
    const configured = readEnvVar('GOG_CONFIRM_SECRET');
    secret = configured ? Buffer.from(configured, 'utf8') : randomBytes(32);
  }
  return secret;
}

/** Test seam: forget the secret (a "restart") and every spent token. */
export function resetConfirmTokenState(): void {
  secret = undefined;
  spent.clear();
}

// Sorted keys, undefined dropped: the same payload re-read on phase 2 must
// hash identically however its object was assembled.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 (hex) of the canonical JSON of a send payload. */
export function hashSendPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function sign(body: string): string {
  return createHmac('sha256', hmacKey()).update(`${PREFIX}.${body}`).digest('base64url');
}

export function issueConfirmToken(binding: ConfirmBinding, now = Date.now()): { token: string; expiresAt: string } {
  const exp = now + confirmTokenTtlSeconds() * 1000;
  const claims: Claims = {
    t: binding.tool,
    a: binding.account,
    g: binding.target,
    ...(binding.revision === undefined ? {} : { r: binding.revision }),
    h: binding.payloadHash,
    iat: now,
    exp,
    n: randomBytes(16).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { token: `${PREFIX}.${body}.${sign(body)}`, expiresAt: new Date(exp).toISOString() };
}

function signatureMatches(body: string, sig: string): boolean {
  const expected = Buffer.from(sign(body), 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseClaims(body: string): Claims | undefined {
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
  } catch {
    return undefined;
  }
}

/**
 * Check a phase-2 token against the binding recomputed from a fresh re-read.
 * Only an `ok` verdict consumes the token; a DRAFT_CHANGED leaves it unspent,
 * because the approval it carries is still true of the content it names.
 */
export function verifyConfirmToken(token: string, binding: ConfirmBinding, now = Date.now()): ConfirmTokenVerdict {
  for (const [nonce, exp] of spent) if (exp < now) spent.delete(nonce);

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) return { ok: false, error: 'TOKEN_INVALID' };
  const [, body, sig] = parts as [string, string, string];
  if (!signatureMatches(body, sig)) return { ok: false, error: 'TOKEN_INVALID' };
  const claims = parseClaims(body);
  if (!claims) return { ok: false, error: 'TOKEN_INVALID' };

  if (claims.t !== binding.tool || claims.a !== binding.account || claims.g !== binding.target) {
    return { ok: false, error: 'TOKEN_INVALID' };
  }
  if (spent.has(claims.n)) return { ok: false, error: 'TOKEN_REUSED' };
  if (now > claims.exp) return { ok: false, error: 'TOKEN_EXPIRED' };
  if (claims.r !== binding.revision) return { ok: false, error: 'DRAFT_CHANGED', reason: 'message-id-rotated' };
  if (claims.h !== binding.payloadHash) return { ok: false, error: 'DRAFT_CHANGED', reason: 'payload-changed' };

  spent.set(claims.n, claims.exp);
  return { ok: true };
}
