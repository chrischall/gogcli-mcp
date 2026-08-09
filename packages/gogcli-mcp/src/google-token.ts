import { readEnvVar } from '@chrischall/mcp-utils';

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
 */
export type AccessTokenSource = () => Promise<string | undefined>;

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

  return async () => {
    const key = await cacheKey(refreshToken, clientId);
    const hit = cache.get(key);
    if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.accessToken;

    // Join the exchange already running for this credential, or start the one
    // everyone else will join.
    let pending = inFlight.get(key);
    if (!pending) {
      pending = exchange(refreshToken, clientId, clientSecret)
        .then((minted) => {
          cache.set(key, minted);
          return minted;
        })
        // Dropped whether it resolved OR threw. Keeping a rejected promise here
        // would make one transient failure permanent for every later caller —
        // the opposite of the "failures are not cached" rule above.
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const minted = await pending;
    return minted.accessToken;
  };
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
    throw new Error(
      `the Google token exchange could not be reached: ${err instanceof Error ? err.message : String(err)}`,
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
    if (body.error === 'invalid_grant') {
      throw new Error(
        'the stored refresh token has expired or been revoked, so this account must be re-authorized ' +
          '(commonly the 7-day limit on OAuth consent screens still in "Testing" mode). ' +
          'Re-enrol with gog_auth_add_url + gog_auth_add_complete and store the new refresh token.',
      );
    }
    // The refresh token is deliberately absent from this message — it is a
    // long-lived credential and an error string travels into logs and model
    // context.
    throw new Error(
      `the access token could not be refreshed (HTTP ${res.status}${body.error ? `, ${body.error}` : ''})`,
    );
  }

  if (!body.access_token) {
    throw new Error('the access token could not be refreshed: Google returned no access_token');
  }

  // Default to an hour if Google omits expires_in; the margin above covers the
  // difference between that guess and reality.
  const expiresInMs = (body.expires_in ?? 3600) * 1000;
  return { accessToken: body.access_token, expiresAt: Date.now() + expiresInMs };
}
