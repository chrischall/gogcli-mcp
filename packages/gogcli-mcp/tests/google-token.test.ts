import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeAccessTokenSource, clearAccessTokenCache } from '../src/google-token.js';

/**
 * Minting a short-lived access token from a long-lived refresh token is what
 * lets a hosted gog's identity belong to the REGISTRATION instead of to the Fly
 * box's volume (#241). The access token is what crosses the wire; the refresh
 * token never leaves this process.
 *
 * Two properties carry the whole design, and both are about NOT quietly doing
 * the wrong thing:
 *
 *   1. One caller's token must never be served to another. The cache is keyed
 *      by the credential, not held as a single "current token" — a Worker
 *      isolate serves many callers, and a global would hand the first caller's
 *      identity to everyone after them.
 *   2. A failure must fail the CALL. Returning nothing would run the command as
 *      the box's identity, and the caller would read someone else's mailbox
 *      while everything looked like success.
 */

const CLIENT = { GOG_CLIENT_ID: 'cid.apps.googleusercontent.com', GOG_CLIENT_SECRET: 'cs' };

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => clearAccessTokenCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('makeAccessTokenSource', () => {
  it('is absent when nothing is configured, so the box keeps acting as itself', () => {
    expect(makeAccessTokenSource({})).toBeUndefined();
  });

  it('passes through a directly-supplied access token without contacting Google', async () => {
    // The #230 path. Still supported: a caller who already holds a token should
    // not need an OAuth client to use it.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const source = makeAccessTokenSource({ GOG_ACCESS_TOKEN: 'ya29.direct' })!;
    expect(await source()).toBe('ya29.direct');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mints an access token from the refresh token, then serves it from cache', async () => {
    const fetchMock = vi.fn(async () => tokenResponse('ya29.minted'));
    vi.stubGlobal('fetch', fetchMock);
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;

    expect(await source()).toBe('ya29.minted');
    expect(await source()).toBe('ya29.minted');
    // A token exchange per tool call would be both slow and a good way to get
    // rate-limited by Google.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('rt-1');
    expect(sent.get('client_id')).toBe(CLIENT.GOG_CLIENT_ID);
  });

  it('never serves one credential holder the other one’s token', async () => {
    // THE one that matters. A module-level "current access token" passes every
    // other test in this file and fails this one — and on the Worker path,
    // where a single isolate serves many callers, that is a cross-account leak
    // rather than a bug.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('ya29.alice'))
      .mockResolvedValueOnce(tokenResponse('ya29.bob'));
    vi.stubGlobal('fetch', fetchMock);

    const alice = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-alice' })!;
    const bob = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-bob' })!;

    expect(await alice()).toBe('ya29.alice');
    expect(await bob()).toBe('ya29.bob');
    // And each keeps its own on a second read.
    expect(await alice()).toBe('ya29.alice');
    expect(await bob()).toBe('ya29.bob');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-mints once the token is close to expiring', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('ya29.first', 3600))
      .mockResolvedValueOnce(tokenResponse('ya29.second', 3600));
    vi.stubGlobal('fetch', fetchMock);
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;

    expect(await source()).toBe('ya29.first');
    // Just inside the safety margin: a token that expires mid-flight is a
    // failure the caller cannot do anything about, so it is replaced early.
    vi.advanceTimersByTime((3600 - 60) * 1000);
    expect(await source()).toBe('ya29.second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('THROWS when the exchange fails, rather than returning nothing', async () => {
    // Returning undefined here would run the command as the box's identity.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })),
    );
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;
    await expect(source()).rejects.toThrow(/could not be refreshed|token exchange/i);
  });

  it('explains an invalid_grant instead of surfacing a bare OAuth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), {
            status: 400,
          }),
      ),
    );
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-dead' })!;
    await expect(source()).rejects.toThrow(/expired or been revoked|re-?enrol|re-?authoriz/i);
  });

  it('does not cache a failure, so a transient outage is not sticky', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(tokenResponse('ya29.recovered'));
    vi.stubGlobal('fetch', fetchMock);
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;

    await expect(source()).rejects.toThrow();
    expect(await source()).toBe('ya29.recovered');
  });

  it('fails loudly on a half-configured credential instead of acting as the box', async () => {
    // A refresh token with no OAuth client cannot mint anything. Treating it as
    // "unconfigured" would silently fall back to the box's identity, which is
    // the exact confusion this feature exists to remove — so the source exists
    // and throws when used, leaving tools/list working and the reason visible.
    for (const partial of [
      { GOG_REFRESH_TOKEN: 'rt-1' },
      { GOG_REFRESH_TOKEN: 'rt-1', GOG_CLIENT_ID: 'cid' },
      { GOG_REFRESH_TOKEN: 'rt-1', GOG_CLIENT_SECRET: 'cs' },
    ]) {
      const source = makeAccessTokenSource(partial);
      expect(source).toBeTypeOf('function');
      await expect(source!()).rejects.toThrow(/GOG_CLIENT_ID|GOG_CLIENT_SECRET/);
    }
  });

  it('says the exchange was unreachable when the network itself fails', async () => {
    // Distinct from a rejection BY Google: nothing was evaluated, so the
    // credential may be perfectly good and the right response is to retry, not
    // to tell the owner to re-enrol.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;
    await expect(source()).rejects.toThrow(/could not be reached.*fetch failed/i);
  });

  it('survives a thrown non-Error without masking it with a TypeError', async () => {
    // `err.message` on a thrown string is undefined, and the template would
    // then hide the real failure behind a crash inside the error path.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw 'socket closed';
      }),
    );
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;
    await expect(source()).rejects.toThrow(/could not be reached.*socket closed/i);
  });

  it('refuses a 200 that carries no access_token', async () => {
    // A success status with nothing usable in it would otherwise cache
    // `undefined` and send no token at all — a silent downgrade to the
    // backend's identity, wearing a 200.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 })));
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;
    await expect(source()).rejects.toThrow(/no access_token/i);
  });

  it('assumes an hour when Google omits expires_in', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'ya29.nolife' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;

    expect(await source()).toBe('ya29.nolife');
    // Still cached half an hour later — i.e. it did not treat "no expiry" as
    // "already expired" and re-mint on every single call.
    vi.advanceTimersByTime(1800 * 1000);
    expect(await source()).toBe('ya29.nolife');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the status when the body is not JSON at all', async () => {
    // An edge proxy answering a 502 with an HTML error page is the realistic
    // case. Parsing that would throw inside the error path and bury the status,
    // which is the only useful thing such a response carries.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    );
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;
    await expect(source()).rejects.toThrow(/could not be refreshed \(HTTP 502/);
  });

  it('coalesces concurrent callers into ONE token exchange', async () => {
    // The reported bug was several per-service servers flapping into needs-auth
    // independently. This is the version of that failure that lives in OUR
    // code: `get` → `await exchange` → `set` has an await between the miss and
    // the fill, so N calls arriving together all miss and all exchange.
    //
    // One process per caller hides it; a Worker isolate serving many callers,
    // or simply several tool calls in flight at once, turns one refresh into N
    // simultaneous hits on Google's token endpoint — which is a good way to be
    // rate-limited into exactly the intermittent auth errors being debugged.
    let inFlight = 0;
    let maxConcurrent = 0;
    const fetchMock = vi.fn(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return tokenResponse('ya29.shared');
    });
    vi.stubGlobal('fetch', fetchMock);

    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;
    const results = await Promise.all(Array.from({ length: 8 }, () => source()));

    expect(results).toEqual(Array(8).fill('ya29.shared'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
  });

  it('lets a later caller retry after a concurrent exchange failed', async () => {
    // Coalescing must not make one failure permanent for everyone: the shared
    // attempt is dropped when it settles, so the next call starts a fresh one.
    // The failure has to take a tick. An exchange that rejects instantly can
    // finish and clear itself before the second caller even looks, so that
    // caller correctly starts its own attempt — which would make this test pass
    // without any sharing having happened. A real exchange is a network round
    // trip, so the shared-failure case is the one worth pinning.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('boom');
      })
      .mockResolvedValueOnce(tokenResponse('ya29.after'));
    vi.stubGlobal('fetch', fetchMock);
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-1' })!;

    const settled = await Promise.allSettled([source(), source()]);
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    // Both shared ONE failed exchange rather than each making their own...
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // ...and the failure was not cached, so the next caller recovers.
    expect(await source()).toBe('ya29.after');
  });

  it('does not let two different credentials share one in-flight exchange', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('ya29.alice'))
      .mockResolvedValueOnce(tokenResponse('ya29.bob'));
    vi.stubGlobal('fetch', fetchMock);
    const alice = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-alice' })!;
    const bob = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-bob' })!;

    const [a, b] = await Promise.all([alice(), bob()]);
    expect(a).toBe('ya29.alice');
    expect(b).toBe('ya29.bob');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never puts the refresh token in the error it throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-super-secret-value' })!;
    await expect(source()).rejects.toThrow(
      expect.not.stringContaining('rt-super-secret-value') as unknown as string,
    );
  });
});
