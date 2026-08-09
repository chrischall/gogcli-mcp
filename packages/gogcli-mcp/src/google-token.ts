import { parseBoolEnv, readEnvVar } from '@chrischall/mcp-utils';
import { credentialTag, logAuthTransition } from './auth-log.js';

/**
 * Mint short-lived Google access tokens from a long-lived refresh token, so a
 * hosted gog's identity belongs to the REGISTRATION rather than to the machine
 * the binary runs on (#241).
 *
 * The shape of the problem: `gog` reads credentials from a keyring at
 * `GOG_HOME`, on the box where it executes — which is why one Fly volume ended
 * up being every registration's identity. But `gog --access-token` bypasses the
 * keyring entirely, and #235 already carries such a token to the box per
 * request. The only missing piece was that an access token lives about an hour,
 * so it cannot be the thing you STORE. A refresh token can.
 *
 * So the refresh token stays here, in the child's environment, and only a
 * one-hour access token ever crosses the wire. That is strictly better than the
 * arrangement it replaces, where a permanent credential sat on a shared volume.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Replace a token this long before it actually expires. A token that dies
 * mid-flight is a failure the caller can do nothing about, and the exchange is
 * cheap next to a failed tool call.
 */
const EXPIRY_MARGIN_MS = 120_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Keyed by the CREDENTIAL, never a single "current token".
 *
 * A module-level current-token would be correct for one stdio process and
 * silently wrong everywhere else: a Worker isolate serves many callers, so the
 * first caller's identity would be handed to everyone after them. That is the
 * same failure as the captured executor in #235 and the ambient store in #233 —
 * three bugs, one shape, which is why this one is keyed from the start.
 *
 * The key is a hash rather than the token itself so that nothing which dumps or
 * iterates this map (a heap snapshot, a debugger, a future logging line) puts a
 * live credential in front of someone.
 */
const cache = new Map<string, CachedToken>();

/**
 * Exchanges currently in flight, so concurrent callers share ONE of them.
 *
 * Without this, `get` → `await exchange` → `set` has an await between the miss
 * and the fill: every caller that arrives during that window also misses, and
 * they all hit Google's token endpoint together. One process per caller hides
 * it, but a Worker isolate serving many callers — or simply several tool calls
 * in flight — turns a single refresh into a stampede, and being rate-limited
 * for it produces exactly the intermittent auth failures this was meant to end.
 *
 * Keyed identically to `cache`, so two different credentials never wait on each
 * other's exchange.
 */
const inFlight = new Map<string, Promise<CachedToken>>();

/** Test seam: both maps are process-wide, so they do not unwind between tests. */
export function clearAccessTokenCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * WebCrypto rather than `node:crypto`: this module is reachable from the Worker
 * build, which has no node builtins. Both runtimes expose `crypto.subtle`.
 */
async function cacheKey(refreshToken: string, clientId: string): Promise<string> {
  // NUL-separated, spelled as an escape so this source file stays text: it
  // keeps a (clientId, refreshToken) pair from colliding with a different
  // pair whose concatenation happens to match. Neither value can contain a
  // NUL, which is what makes the boundary unambiguous.
  const data = new TextEncoder().encode(`${clientId}\u0000${refreshToken}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What a token source is: something that answers "who is this call acting as",
 * or throws trying. It never answers `undefined` after being configured —
 * see the failure note below.
 *
 * It also answers a second question, which is what makes a rejected token
 * recoverable: `invalidate(rejected)` drops that token if it is still the one
 * cached for this credential, and REPORTS whether it dropped anything.
 *
 * `true` means the next read mints something new, so a replay is worth making;
 * `false` means a concurrent caller has already replaced the entry. Those are
 * the only two answers, and a source with nothing to mint from gives neither —
 * it omits the method entirely (see below).
 */
export interface AccessTokenSource {
  (): Promise<string | undefined>;
  /**
   * Evict `rejected` if it is still this credential's cached token; answer
   * whether anything was evicted.
   *
   * ABSENT exactly when this source holds nothing mintable — a directly-supplied
   * GOG_ACCESS_TOKEN, or a refresh token with no OAuth client beside it. The
   * absence has to be the signal, because an always-false return is not
   * distinguishable from the false a real cache gives when a concurrent caller
   * beat you to the refresh, and the connector records those as different
   * causes: "nothing here can mint a replacement" is the one configuration
   * where re-authorizing genuinely IS the repair, and it must not be logged as
   * somebody else's concurrent write.
   *
   * Scoped to ONE credential on purpose. `clearAccessTokenCache()` drops every
   * entry and exists only as a test seam — using it here would mean one
   * caller's dead token forced a re-mint on every other caller sharing the
   * isolate, which is the same shared-identity mistake this module is built
   * around, wearing a different hat.
   *
   * Matched by VALUE, not just by key. A concurrent caller may already have
   * replaced the entry while this call was in flight; evicting that fresh token
   * would waste a mint and let two callers keep undoing each other's work.
   */
  invalidate?: (rejected: string) => Promise<boolean>;
  /**
   * The log-safe name of the credential behind this source, for correlating
   * this module's records with the connector's (auth-log.ts).
   *
   * Optional, and absent exactly when there is no mintable credential to name.
   * A directly-supplied GOG_ACCESS_TOKEN emits no records here at all — nothing
   * is minted, cached or evicted — so a tag for it would identify a story that
   * is never told. Answering `undefined` says that honestly rather than
   * inventing an identifier for a credential this module does not hold.
   */
  credentialId?: () => Promise<string>;
}

export interface TokenEnv {
  GOG_ACCESS_TOKEN?: string;
  GOG_REFRESH_TOKEN?: string;
  GOG_CLIENT_ID?: string;
  GOG_CLIENT_SECRET?: string;
  [key: string]: string | undefined;
}

/**
 * Build the token source for this environment, or `undefined` when nothing is
 * configured — which leaves the backend acting as itself, exactly as every
 * registration did before this existed.
 *
 * Precedence puts a directly-supplied `GOG_ACCESS_TOKEN` first: someone who
 * already holds a token should not need an OAuth client to use it, and it keeps
 * the #230 path working untouched.
 */
export function makeAccessTokenSource(env: TokenEnv): AccessTokenSource | undefined {
  // A token handed to us whole. Nothing minted it here, so nothing here can
  // mint another — hence no `invalidate` at all, which is how the caller tells
  // this apart from a cache that merely lost a race. When THIS is the token
  // Google rejects, re-authorization really is the repair.
  const direct = readEnvVar('GOG_ACCESS_TOKEN', { env });
  if (direct) return async () => direct;

  const refreshToken = readEnvVar('GOG_REFRESH_TOKEN', { env });
  if (!refreshToken) return undefined;

  const clientId = readEnvVar('GOG_CLIENT_ID', { env });
  const clientSecret = readEnvVar('GOG_CLIENT_SECRET', { env });

  // A refresh token with no OAuth client cannot mint anything, and the WRONG
  // repair is to treat it as unconfigured: that falls back to the backend's own
  // identity, which is the precise confusion this feature exists to remove. So
  // the source exists and throws when used — `tools/list` still works, the
  // server still starts, and the first tool call says what is missing.
  if (!clientId || !clientSecret) {
    const missing = [!clientId && 'GOG_CLIENT_ID', !clientSecret && 'GOG_CLIENT_SECRET']
      .filter(Boolean)
      .join(' and ');
    return async () => {
      throw new Error(
        `GOG_REFRESH_TOKEN is set but ${missing} is not, so no access token can be minted. ` +
          'Set the OAuth client alongside the refresh token, or unset GOG_REFRESH_TOKEN to use the backend’s own identity.',
      );
    };
  }

  // Hashed ONCE per source rather than once per call. `read` and `invalidate`
  // each used to recompute the SHA-256 on every invocation, which is work this
  // module was already paying for on the request path; memoizing it also gives
  // the log records a credential tag for free. Lazy rather than eager so a
  // source that is never used never starts a promise nobody awaits.
  let keyPromise: Promise<string> | undefined;
  const key = (): Promise<string> => (keyPromise ??= cacheKey(refreshToken, clientId));

  // Every other transition in the set is an EVENT; a cache hit is the absence
  // of one. Narrating it writes a line per gog invocation — a Workers Logs line
  // (and its cost) for every tool call in healthy operation on the Worker, and
  // a stderr line per call in the MCP host's server log on stdio — which turns
  // the `gog-auth` stream from a log of transitions into a request log.
  //
  // It stays available for the investigation that has to prove WHICH token a
  // call was served (the shape the original incident took), behind a flag
  // nobody sets in normal operation. Read once per source rather than per call:
  // the env cannot change under a running process.
  const logCacheHits = parseBoolEnv('GOG_AUTH_LOG_CACHE_HITS', { env });

  const read = async (): Promise<string | undefined> => {
    const k = await key();
    const hit = cache.get(k);
    if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      if (logCacheHits) logAuthTransition('token.cache-hit', { credential: credentialTag(k) });
      return hit.accessToken;
    }

    // Join the exchange already running for this credential, or start the one
    // everyone else will join.
    let pending = inFlight.get(k);
    if (!pending) {
      pending = exchange(refreshToken, clientId, clientSecret)
        .then((minted) => {
          cache.set(k, minted);
          logAuthTransition('token.minted', {
            credential: credentialTag(k),
            reason: `valid for ${Math.round((minted.expiresAt - Date.now()) / 1000)}s`,
          });
          return minted;
        })
        // Only the caller that STARTED the exchange records it, because only one
        // exchange happened; the callers that joined it would otherwise turn one
        // mint into a burst of identical lines.
        //
        // Typed as TokenExchangeError rather than `unknown`: `exchange` catches
        // the fetch rejection and the JSON parse itself, so this is the only
        // thing that can arrive here, and pretending otherwise would add an arm
        // no test could ever reach.
        .catch((err: TokenExchangeError): never => {
          logAuthTransition(err.grantDead ? 'grant.dead' : 'token.mint-failed', {
            credential: credentialTag(k),
            reason: err.message,
          });
          throw err;
        })
        // Dropped whether it resolved OR threw. Keeping a rejected promise here
        // would make one transient failure permanent for every later caller —
        // the opposite of the "failures are not cached" rule above.
        .finally(() => inFlight.delete(k));
      inFlight.set(k, pending);
    }
    const minted = await pending;
    return minted.accessToken;
  };

  /**
   * Google rejected `rejected`; make sure the next read does not serve it again.
   *
   * The read guard above is purely about TIME, so without this a token Google
   * has already answered 401 to is re-served until its nominal expiry — up to
   * ~58 minutes of every call failing identically, which is exactly the incident
   * this closes. `inFlight` is deliberately untouched: an exchange that is
   * already running was started to produce a NEW token, and cancelling it would
   * only make the callers waiting on it mint again.
   */
  const invalidate = async (rejected: string): Promise<boolean> => {
    const k = await key();
    const hit = cache.get(k);
    if (!hit || hit.accessToken !== rejected) {
      // The two "nothing happened" cases are worth telling apart in a log: one
      // says a concurrent caller has already repaired this credential, the
      // other says the rejected token was never ours to begin with.
      logAuthTransition('token.evict-noop', {
        credential: credentialTag(k),
        reason: hit
          ? 'a concurrent caller had already replaced this credential’s token'
          : 'no token was cached for this credential',
      });
      return false;
    }
    cache.delete(k);
    logAuthTransition('token.evicted', {
      credential: credentialTag(k),
      reason: 'Google rejected this access token; the next read will mint a new one',
    });
    return true;
  };

  return Object.assign(read, {
    invalidate,
    credentialId: async () => credentialTag(await key()),
  });
}

/**
 * Exchange refresh -> access.
 *
 * THROWS on every failure, and never returns `undefined`. Returning nothing
 * would let the call proceed as the backend's identity, and the caller would
 * read someone else's mailbox while everything looked like success — the same
 * reasoning that made a malformed token a 400 rather than an ignore in #235.
 *
 * Nothing here is cached on failure either, so a transient Google outage does
 * not become a sticky one.
 */
class TokenExchangeError extends Error {
  /**
   * The REFRESH token is dead (Google's `invalid_grant`), not merely the access
   * token. Carried as a flag rather than re-read from the message, because
   * inferring the author of a failure from prose several authors can produce is
   * precisely the mistake this branch exists to undo. `instanceof` is safe: the
   * class is thrown and caught inside this one module.
   */
  readonly grantDead: boolean;

  constructor(message: string, grantDead: boolean) {
    super(message);
    this.grantDead = grantDead;
  }
}

async function exchange(refreshToken: string, clientId: string, clientSecret: string): Promise<CachedToken> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (err) {
    throw new TokenExchangeError(
      `the Google token exchange could not be reached: ${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    // invalid_grant is the one worth naming, because it is not a bug and not
    // transient: the credential is gone and a human has to enrol again. Google
    // expires refresh tokens after 7 days while a consent screen is still in
    // "Testing" mode, which is how this fleet has usually met it.
    //
    // The literal `invalid_grant` is in the message ON PURPOSE, and is load
    // bearing rather than decoration. This mint is a first-class error surface
    // — it propagates in place of gog's 401 (connector-runtime.ts) — and
    // tools/utils.ts picks INVALID_GRANT_HINT, the one that names the 7-day
    // Testing-mode cause and the gog_auth_add_url/gog_auth_add_complete pair,
    // by matching that exact token. Prose alone does not qualify: the previous
    // wording ("token has expired or been revoked") missed
    // INVALID_GRANT_PATTERN's second alternative ("token has been expired or
    // revoked") by one word, so a dead refresh token surfaced here earned only
    // the generic "authentication may have expired" advice while the identical
    // failure reported BY gog earned the specific guidance.
    if (body.error === 'invalid_grant') {
      throw new TokenExchangeError(
        'the stored refresh token was rejected (invalid_grant): it has expired or been revoked, so ' +
          'this account must be re-authorized ' +
          '(commonly the 7-day limit on OAuth consent screens still in "Testing" mode). ' +
          'Re-enrol with gog_auth_add_url + gog_auth_add_complete and store the new refresh token.',
        true,
      );
    }
    // The refresh token is deliberately absent from this message — it is a
    // long-lived credential and an error string travels into logs and model
    // context.
    throw new TokenExchangeError(
      `the access token could not be refreshed (HTTP ${res.status}${body.error ? `, ${body.error}` : ''})`,
      false,
    );
  }

  if (!body.access_token) {
    throw new TokenExchangeError(
      'the access token could not be refreshed: Google returned no access_token',
      false,
    );
  }

  // Default to an hour if Google omits expires_in; the margin above covers the
  // difference between that guess and reality.
  const expiresInMs = (body.expires_in ?? 3600) * 1000;
  return { accessToken: body.access_token, expiresAt: Date.now() + expiresInMs };
}
