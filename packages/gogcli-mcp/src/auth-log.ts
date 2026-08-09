import { redactSecrets } from './runner.js';

/**
 * One line per auth-state transition, on the paths where a Google credential is
 * minted, served, evicted, replaced or refused.
 *
 * ## Why this exists
 *
 * The incident that produced this branch could not be investigated. `gog`
 * connectors told a user all session to re-authorize a Google account whose
 * grant was healthy, and nothing anywhere had recorded a single auth-state
 * transition: not the runner's transport 401, not a mint, not a cache hit, not
 * a dead grant. `wrangler.jsonc` has set `observability.enabled = true` since
 * the Worker shipped, so a Workers Logs sink was live the whole time with
 * nothing writing to it.
 *
 * The other three fixes on this branch made those outcomes DISTINGUISHABLE —
 * a transport 401 is now a typed RunnerTransportError, a rejected access token
 * is evicted and re-minted, `invalid_grant` is separated from a token that
 * merely expired. This one makes them VISIBLE, which is what turns "the user
 * says it was broken yesterday" into a query.
 *
 * ## Why console, and why never console.log
 *
 * Workers Logs captures `console.*` and nothing else — there is no other sink
 * available to a Worker without adding a dependency and a network hop to the
 * request path.
 *
 * But this module also loads in the stdio servers (`useRemoteGogRunner` wires
 * the same executor and the same token source into a plain Node process), and
 * there STDOUT IS THE JSON-RPC CHANNEL. Node routes `console.log`, `.info`,
 * `.debug` and `.trace` to fd 1, so any one of them would interleave a log line
 * with the protocol frames and break the session. Only `.warn` and `.error` go
 * to fd 2. That is the whole reason routine transitions are emitted at `warn`
 * rather than at `info` where their severity belongs: `warn` is the least-severe
 * console method that Node does not send down the wire. The record carries its
 * own `event` name, so a log consumer classifies on that rather than on level.
 *
 * ## Why the whole line is redacted
 *
 * `reason` is built from text this layer did not author — gog's stderr, Google's
 * error body, a rejected fetch's message — and any of those can quote a token
 * verbatim. Redacting per-field would leave the next field someone adds
 * unprotected, so the SERIALIZED record goes through the repo's existing
 * `redactSecrets` (the shared mcp-utils redactor plus this repo's Google
 * `ya29.…` / `1//…` shapes) as one string. A credential can therefore only
 * appear in a log line if it survives the same redactor that guards every error
 * this repo returns to a client.
 *
 * Credentials are never IDENTIFIED by value either: `credentialTag` derives the
 * identifier from the SHA-256 that already keys the token cache, which is the
 * hash-keying precedent google-token.ts set for exactly this reason.
 */

/**
 * What changed. Named after the transition rather than after the code site, so
 * a query reads as a story about a credential rather than about a call stack.
 */
export type AuthTransition =
  /** A fresh access token was obtained from the refresh token. */
  | 'token.minted'
  /** An unexpired cached access token was served without contacting Google. */
  | 'token.cache-hit'
  /** The exchange failed for a reason that is not a dead grant. */
  | 'token.mint-failed'
  /** A rejected access token was dropped, so the next read mints a new one. */
  | 'token.evicted'
  /** Nothing was dropped: the credential holds no token, or a different one. */
  | 'token.evict-noop'
  /** The REFRESH token is gone. Nothing can be minted; a human must re-enrol. */
  | 'grant.dead'
  /** Google refused our token, but this call is not one we may replay. */
  | 'replay.declined'
  /** Replaying the call once with a freshly minted token. */
  | 'replay.attempted'
  /** The replay succeeded — the caller saw no error at all. */
  | 'replay.succeeded'
  /** The replay failed too; the original failure reaches the caller. */
  | 'replay.failed'
  /** The RUNNER rejected our bearer. gog never ran; no Google credential read. */
  | 'runner.auth-failed'
  /** Enrolment: the runner refused the connector key itself (401/403). Layer 1. */
  | 'connect.key-rejected'
  /**
   * Enrolment: the runner never answered, so the key was never judged. A user
   * who saw this was previously told their key was invalid — see
   * `connector-auth.ts`. It is filed separately because the two demand opposite
   * actions from the user: fetch a new key, versus wait and retry.
   */
  | 'connect.runner-unreachable'
  /** Connect time: the Google layer was measured live and answered healthy. */
  | 'connect.google-ok'
  /**
   * Connect time: the probe reached a VERDICT and the verdict is bad — Google
   * refused the credential, or there is none. The user is connected anyway.
   * Emitted only when the runner asserts `measured:true`; see google-probe.ts.
   */
  | 'connect.google-unhealthy'
  /** Connect time: the Google layer could NOT be measured. Not evidence of anything. */
  | 'connect.google-unmeasured'
  /**
   * Google refused a call, and a live check taken at that moment says the
   * credential is HEALTHY. The refusal is therefore unexplained.
   */
  | 'refusal.google-ok'
  /**
   * Google refused a call, and a live check that REACHED A VERDICT
   * (`measured:true`) confirms the credential is refused too.
   */
  | 'refusal.google-unhealthy'
  /** Google refused a call and the live check could not be taken. Not evidence of anything. */
  | 'refusal.google-unmeasured';

/**
 * Which credential, which service, which backend, and why — every field
 * optional because each call site honestly knows a different subset. A
 * transport 401 has no credential to name; a mint has no service.
 */
export interface AuthContext {
  /** `credentialTag` of the hash that keys the token cache. Never a token. */
  credential?: string;
  /** The `gog` service word (gmail, drive, sheets…), when there is one. */
  service?: string;
  /** The gog-runner base URL. Configuration, not a secret. */
  endpoint?: string;
  /** Prose. Redacted with everything else — see the module note. */
  reason?: string;
}

/**
 * Transitions that describe something going WRONG, routed to `console.error`.
 * Everything else is routine and goes to `console.warn` (see the module note on
 * why not `console.info`).
 *
 * `token.evicted` is deliberately NOT here: an eviction is the repair working.
 * `replay.declined` is not either — declining is usually the correct, safe
 * answer (a write, a superseded token), and only reads as a failure alongside
 * the record that follows it.
 */
const FAILURES: ReadonlySet<AuthTransition> = new Set<AuthTransition>([
  'token.mint-failed',
  'grant.dead',
  'replay.failed',
  'runner.auth-failed',
  'connect.key-rejected',
  // An enrolment that could not proceed is a failure even though nobody is at
  // fault: it is the only trace a half-enrolled connector leaves behind, and
  // the absence of exactly this record is why DEFECT 4 could not be explained.
  'connect.runner-unreachable',
  'connect.google-unhealthy',
  'refusal.google-unhealthy',
  // The loudest record on this branch, and the only one that means "we cannot
  // explain this". Google refused a real call while a live check of the same
  // credential, taken seconds later, succeeded — so neither the 7-day cliff nor
  // a revoked grant accounts for it. It is filed as a failure precisely because
  // it is the record nobody may scroll past: it is the only evidence that could
  // ever justify building something on the hosted path, and its absence over
  // time is what retires that theory for good.
  'refusal.google-ok',
]);

// `connect.google-unmeasured` and `refusal.google-unmeasured` are deliberately
// NOT failures, and the distinction
// is the entire point of the connect-time probe. "Google was asked and said no"
// is a fact about the user's credential; "the probe did not run" is a fact about
// the probe. Filing the second under the first would rebuild the defect being
// fixed — a claim about health that nothing measured — with the alarm inverted.
//
// That is not a distinction a call site may re-derive by eye: it was got wrong
// once, at both call sites, by reading the runner's `ok` field alone. It is now
// decided in exactly one place — `google-probe.ts`, which reads the runner's
// `measured` field first — and the events below are only names for its verdicts.

/** Marker so one `grep gog-auth` finds every record and nothing else. */
const PREFIX = 'gog-auth ';

/**
 * How many hex characters of the cache key identify a credential in a log.
 *
 * 12 hex characters is 48 bits — far past collision risk for the handful of
 * credentials one deployment holds, and short enough to read across lines. The
 * input is already a SHA-256 of (clientId, refreshToken), so truncating it can
 * only ever remove information.
 */
const TAG_CHARS = 12;

/** The log-safe name for a credential, from the hash that already keys it. */
export function credentialTag(cacheKeyHash: string): string {
  return cacheKeyHash.slice(0, TAG_CHARS);
}

/**
 * Emit one record. Deliberately synchronous, allocation-light and
 * exception-free by construction: this sits on the request path, and an
 * observability call that can fail or block would be worse than the silence it
 * replaces.
 */
export function logAuthTransition(event: AuthTransition, context: AuthContext): void {
  // `at` and `event` first so the line reads left to right; JSON.stringify
  // drops the context keys whose value is undefined, which is why an absent
  // credential produces no `"credential":null` noise.
  const record = JSON.stringify({ at: new Date().toISOString(), event, ...context });
  const write = FAILURES.has(event) ? console.error : console.warn;
  write(PREFIX + redactSecrets(record));
}
