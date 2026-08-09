import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logAuthTransition, credentialTag } from '../src/auth-log.js';
import { makeAccessTokenSource, clearAccessTokenCache } from '../src/google-token.js';
import { makeFlyExecutor } from '../src/connector-runtime.js';

/**
 * DEFECT 4: the auth path completed in total silence.
 *
 * Every outcome that mattered — a transport 401 from the runner's own bearer
 * check, a token minted, a token served from cache, a token evicted because
 * Google rejected it, a dead refresh grant — happened with no record anywhere.
 * `wrangler.jsonc` sets `observability.enabled = true`, so the Worker has had a
 * live Workers Logs sink since it shipped, and nothing ever wrote to it. The
 * owner could not correlate the reported incident against anything because
 * nothing recorded an auth-state transition.
 *
 * Two properties are being pinned here, and the second is the hard one:
 *
 *   1. Each transition emits exactly one record, carrying WHEN, WHICH
 *      credential (as a non-reversible tag), WHAT changed, and WHY.
 *   2. No credential material can reach a log line. Not the refresh token, not
 *      the client secret, not the access token — including when a token is
 *      quoted verbatim inside an error message this module is asked to record.
 */

const CLIENT = {
  GOG_CLIENT_ID: 'cid.apps.googleusercontent.com',
  GOG_CLIENT_SECRET: 'cs-super-secret-client-secret',
};
const REFRESH = 'rt-super-secret-refresh-value';
const ACCESS_1 = 'ya29.super-secret-access-token-one';
const ACCESS_2 = 'ya29.super-secret-access-token-two';

/** Every string this module can be blamed for putting in front of a human. */
const CREDENTIAL_MATERIAL = [REFRESH, CLIENT.GOG_CLIENT_SECRET, ACCESS_1, ACCESS_2];

const PREFIX = 'gog-auth ';

interface Emitted {
  method: 'warn' | 'error';
  line: string;
}

/**
 * Capture the two stderr-safe console methods, and separately capture the four
 * that Node routes to STDOUT — because stdout is the JSON-RPC channel on the
 * stdio transport, so a single `console.log` there corrupts the protocol. The
 * test asserts the stdout set stays empty.
 */
function captureLog() {
  const emitted: Emitted[] = [];
  const toStdout: string[] = [];
  for (const method of ['warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      emitted.push({ method, line: args.map(String).join(' ') });
    });
  }
  for (const method of ['log', 'info', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      toStdout.push(args.map(String).join(' '));
    });
  }
  return {
    emitted,
    toStdout,
    /** Every emitted line, parsed back out of its `gog-auth {...}` envelope. */
    records(): Record<string, unknown>[] {
      return emitted.map((e) => {
        expect(e.line.startsWith(PREFIX)).toBe(true);
        return JSON.parse(e.line.slice(PREFIX.length)) as Record<string, unknown>;
      });
    },
    events(): unknown[] {
      return this.records().map((r) => r.event);
    },
    /** Everything written anywhere, for the leak assertion. */
    allText(): string {
      return [...emitted.map((e) => e.line), ...toStdout].join('\n');
    },
  };
}

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => clearAccessTokenCache());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('logAuthTransition', () => {
  it('writes one greppable JSON record carrying when, which credential, what and why', () => {
    const log = captureLog();
    logAuthTransition('token.minted', {
      credential: 'a1b2c3d4e5f6',
      service: 'gmail',
      reason: 'minted, expires in 3600s',
    });

    expect(log.emitted).toHaveLength(1);
    const [record] = log.records();
    expect(record.event).toBe('token.minted');
    expect(record.credential).toBe('a1b2c3d4e5f6');
    expect(record.service).toBe('gmail');
    expect(record.reason).toBe('minted, expires in 3600s');
    // A timestamp, because correlating an incident against a log with no clock
    // is the thing that could not be done before.
    expect(Date.parse(record.at as string)).not.toBeNaN();
  });

  it('never writes to stdout, which is the JSON-RPC channel on the stdio transport', () => {
    const log = captureLog();
    logAuthTransition('token.cache-hit', { credential: 'abc' });
    logAuthTransition('grant.dead', { credential: 'abc', reason: 'invalid_grant' });
    expect(log.toStdout).toEqual([]);
    expect(log.emitted).toHaveLength(2);
  });

  it('routes routine transitions and failures to different console levels', () => {
    const log = captureLog();
    logAuthTransition('token.cache-hit', { credential: 'abc' });
    logAuthTransition('runner.auth-failed', { endpoint: 'https://runner.example' });
    expect(log.emitted.map((e) => e.method)).toEqual(['warn', 'error']);
  });

  it('separates a MEASURED dead Google layer from one nobody could measure', () => {
    // The connect-time probe has three honest answers, and conflating the last
    // two is exactly the defect it exists to remove: "I asked Google and it said
    // no" is a failure, while "I could not ask" is not evidence of anything.
    const log = captureLog();
    logAuthTransition('connect.google-ok', { endpoint: 'https://runner.example' });
    logAuthTransition('connect.google-unhealthy', { endpoint: 'https://runner.example', reason: 'invalid_grant' });
    logAuthTransition('connect.google-unmeasured', { endpoint: 'https://runner.example', reason: 'HTTP 404' });

    expect(log.events()).toEqual(['connect.google-ok', 'connect.google-unhealthy', 'connect.google-unmeasured']);
    expect(log.emitted.map((e) => e.method)).toEqual(['warn', 'error', 'warn']);
    expect(log.toStdout).toEqual([]);
  });

  it('omits absent context rather than writing nulls', () => {
    const log = captureLog();
    logAuthTransition('token.evicted', { credential: 'abc' });
    const [record] = log.records();
    expect(Object.keys(record).sort()).toEqual(['at', 'credential', 'event']);
  });

  it('redacts a Google token quoted inside a reason it is asked to record', () => {
    // The reason strings are built from error text — gog's stderr, Google's
    // response — which this layer does not author and cannot vet. So the whole
    // serialized line goes through the repo's existing redactor.
    const log = captureLog();
    logAuthTransition('replay.failed', {
      credential: 'abc',
      reason: `Google API error (401): token ${ACCESS_1} was refused; refresh 1//0gLeAkEdReFrEsH also shown`,
    });
    const line = log.allText();
    expect(line).not.toContain(ACCESS_1);
    expect(line).not.toContain('1//0gLeAkEdReFrEsH');
    expect(line).toContain('[REDACTED]');
    // Still a readable record, not a mangled one.
    expect(log.records()[0].event).toBe('replay.failed');
  });
});

describe('credentialTag', () => {
  it('is a short, stable, non-reversible slice of the hash that already keys the cache', () => {
    const hash = 'f'.repeat(64);
    expect(credentialTag(hash)).toBe('f'.repeat(12));
    expect(credentialTag(hash)).toBe(credentialTag(hash));
  });
});

describe('google-token records every access-token transition', () => {
  it('names minted, cache-hit, evicted and evict-noop, tagged with one stable credential', async () => {
    let minted = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse((minted += 1) === 1 ? ACCESS_1 : ACCESS_2)),
    );
    const log = captureLog();
    const source = makeAccessTokenSource({
      ...CLIENT,
      GOG_REFRESH_TOKEN: REFRESH,
      GOG_AUTH_LOG_CACHE_HITS: '1',
    })!;

    expect(await source()).toBe(ACCESS_1);
    expect(await source()).toBe(ACCESS_1);
    expect(await source.invalidate!(ACCESS_1)).toBe(true);
    expect(await source.invalidate!(ACCESS_1)).toBe(false);

    expect(log.events()).toEqual([
      'token.minted',
      'token.cache-hit',
      'token.evicted',
      'token.evict-noop',
    ]);
    // One credential, one tag, on every record — this is what makes a sequence
    // readable as a story about ONE account rather than four unrelated lines.
    const tags = new Set(log.records().map((r) => r.credential));
    expect(tags.size).toBe(1);
    expect(await source.credentialId!()).toBe([...tags][0]);
  });

  it('says nothing on a cache hit unless asked, so the stream stays a log of transitions', async () => {
    // A cache hit is the STEADY STATE, not an event: narrating it writes one
    // Workers Logs line (and its cost) per gog invocation on the Worker, and one
    // stderr line per invocation in the MCP host's server log on stdio. It stays
    // available for an investigation that has to prove which token a call was
    // served, behind a flag nobody sets in normal operation.
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse(ACCESS_1)));
    const log = captureLog();
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: REFRESH })!;
    expect(await source()).toBe(ACCESS_1);
    expect(await source()).toBe(ACCESS_1);
    expect(await source()).toBe(ACCESS_1);
    expect(log.events()).toEqual(['token.minted']);
  });

  it('distinguishes a superseded token from a credential with nothing cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse(ACCESS_1)));
    const log = captureLog();
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: REFRESH })!;
    await source();
    // The ABA case: a concurrent caller already replaced the entry.
    expect(await source.invalidate!(ACCESS_2)).toBe(false);
    const reasons = log.records().map((r) => r.reason);
    expect(reasons[1]).toMatch(/already replaced/i);
  });

  it('separates a dead refresh grant from an ordinary mint failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const dead = captureLog();
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: REFRESH })!;
    await expect(source()).rejects.toThrow(/re-authorized/);
    expect(dead.events()).toEqual(['grant.dead']);
    expect(dead.emitted[0].method).toBe('error');

    vi.restoreAllMocks();
    clearAccessTokenCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'backend_error' }), { status: 500 })),
    );
    const failed = captureLog();
    const other = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: REFRESH })!;
    await expect(other()).rejects.toThrow(/could not be refreshed/);
    expect(failed.events()).toEqual(['token.mint-failed']);
    expect(failed.emitted[0].method).toBe('error');
  });

  it('gives different credentials different tags', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse(ACCESS_1)));
    const log = captureLog();
    const alice = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-alice' })!;
    const bob = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: 'rt-bob' })!;
    await alice();
    await bob();
    const [a, b] = log.records().map((r) => r.credential);
    expect(a).not.toBe(b);
  });

  it('leaves a source that can mint nothing without a credential tag to promise', () => {
    // A directly-supplied GOG_ACCESS_TOKEN has no refresh credential behind it,
    // and it emits no records — so there is nothing for a tag to correlate.
    const direct = makeAccessTokenSource({ GOG_ACCESS_TOKEN: ACCESS_1 })!;
    expect(direct.credentialId).toBeUndefined();
  });
});

describe('connector-runtime records the transitions the runner path authors', () => {
  const ENDPOINT = 'https://gogcli-gog-runner.fly.dev';
  const KEY = 'k';
  const GOOGLE_401_STDERR =
    'Google API error (401 authError): Request had invalid authentication credentials.';
  const READ = ['--json', '--color=never', '--no-input', 'gmail', 'search', 'q'];
  const WRITE = ['--json', '--color=never', '--no-input', 'gmail', 'send', '--to', 'a@b.c'];

  function gogFailed(stderr: string) {
    return { ok: false, status: 422, json: async () => ({ error: `Command failed\n${stderr}`, stderr }) };
  }
  const ok = (stdout: string) => ({ ok: true, json: async () => ({ stdout }) });
  function source(tokens: (string | undefined)[], evicted = true) {
    return Object.assign(vi.fn(async () => tokens.shift()), {
      invalidate: vi.fn(async () => evicted),
      credentialId: async () => 'cafebabe0001',
    });
  }

  it('records the runner bearer rejection as a TRANSPORT failure, naming no credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })));
    const log = captureLog();
    await expect(makeFlyExecutor(ENDPOINT, KEY, source(['ya29.x']))(READ, {})).rejects.toThrow();

    expect(log.events()).toEqual(['runner.auth-failed']);
    const [record] = log.records();
    expect(record.endpoint).toBe(ENDPOINT);
    expect(record.service).toBe('gmail');
    expect(record.credential).toBeUndefined();
    // The record must not re-create defect 1 for a human reading the log.
    expect(record.reason).toMatch(/never ran|no Google credential/i);
  });

  it('records the replay it attempts and the replay that works', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(gogFailed(GOOGLE_401_STDERR)).mockResolvedValueOnce(ok('threads')),
    );
    const log = captureLog();
    await expect(makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale', 'ya29.fresh']))(READ, {})).resolves.toBe(
      'threads',
    );
    expect(log.events()).toEqual(['replay.attempted', 'replay.succeeded']);
    expect(log.records()[0].credential).toBe('cafebabe0001');
    expect(log.records()[0].service).toBe('gmail');
  });

  it('records a replay that still failed, so a genuinely dead credential is visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gogFailed(GOOGLE_401_STDERR)));
    const log = captureLog();
    await expect(
      makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale', 'ya29.fresh']))(READ, {}),
    ).rejects.toThrow(/401/);
    expect(log.events()).toEqual(['replay.attempted', 'replay.failed']);
    expect(log.emitted[1].method).toBe('error');
  });

  it('records WHY a replay was declined, one machine-readable reason each', async () => {
    const cases: [string, () => Promise<unknown>, RegExp][] = [
      [
        'invalid_grant',
        () => makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale']))(READ, {}),
        /re-authoriz/i,
      ],
      ['no token', () => makeFlyExecutor(ENDPOINT, KEY)(READ, {}), /no access token/i],
      [
        'cannot re-mint',
        () => makeFlyExecutor(ENDPOINT, KEY, () => 'ya29.direct')(READ, {}),
        /cannot mint/i,
      ],
      [
        // The same refusal reached through the source the PRODUCTION direct
        // config actually builds. It used to fall past this rule and be
        // recorded as "already superseded" — blaming a concurrent caller for
        // the one config where re-authorizing really is the repair.
        'real GOG_ACCESS_TOKEN source',
        () =>
          makeFlyExecutor(
            ENDPOINT,
            KEY,
            makeAccessTokenSource({ GOG_ACCESS_TOKEN: 'ya29.direct' }),
          )(READ, {}),
        /cannot mint/i,
      ],
      [
        'write',
        () => makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale']))(WRITE, {}),
        /write/i,
      ],
      [
        'superseded',
        () => makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale'], false))(READ, {}),
        /superseded|already replaced/i,
      ],
      [
        'nothing minted',
        () => makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale', undefined]))(READ, {}),
        /no token/i,
      ],
    ];

    for (const [name, invoke, expected] of cases) {
      vi.restoreAllMocks();
      const stderr = name === 'invalid_grant' ? `${GOOGLE_401_STDERR}\noauth2: "invalid_grant"` : GOOGLE_401_STDERR;
      vi.stubGlobal('fetch', vi.fn(async () => gogFailed(stderr)));
      const log = captureLog();
      await expect(invoke()).rejects.toThrow();
      // The 'no token' case — the HOSTED shape — now writes a second record
      // BEFORE its decision: the live reading of the Google layer this branch
      // added, which here reports `refusal.google-unmeasured` because the stub
      // answers /health/google with the same non-2xx it answers /run with. The
      // decision is still the LAST word in every case, which is what this test
      // is about.
      const records = log.records();
      expect(records.length, name).toBe(name === 'no token' ? 2 : 1);
      if (name === 'no token') expect(records[0].event).toBe('refusal.google-unmeasured');
      const record = records[records.length - 1];
      expect(record.event, name).toBe(name === 'invalid_grant' ? 'grant.dead' : 'replay.declined');
      expect(record.reason as string, name).toMatch(expected);
    }
  });

  it('stays silent for a gog failure that has nothing to do with auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gogFailed('invalid attachment id')));
    const log = captureLog();
    await expect(
      makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale']))(READ, {}),
    ).rejects.toThrow(/invalid attachment/);
    // An auth log that also carries every bad-message-id is an auth log nobody
    // reads. Only failures a credential could explain are recorded.
    expect(log.emitted).toEqual([]);
  });

  it('records a service even when the invocation carries no subcommand to judge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gogFailed(GOOGLE_401_STDERR)));
    const log = captureLog();
    await expect(
      makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale']))(['--json', 'gmail'], {}),
    ).rejects.toThrow();
    expect(log.records()[0].service).toBe('gmail');
  });
});

describe('the hard requirement: credential material cannot reach a log line', () => {
  it('survives a full mint → reject → evict → re-mint → replay lifecycle without leaking', async () => {
    // The real token source, the real executor, the real error text — including
    // a gog stderr that quotes the access token verbatim, which is the way a
    // token realistically gets near a log at all.
    let minted = 0;
    const runResponses = [
      {
        ok: false,
        status: 422,
        json: async () => ({
          error: `Command failed: gog gmail search q --token ${ACCESS_1}`,
          stderr: `Google API error (401 authError): token ${ACCESS_1} had invalid authentication credentials.`,
        }),
      },
      { ok: true, json: async () => ({ stdout: '{"threads":[]}' }) },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).includes('oauth2.googleapis.com')) {
          return tokenResponse((minted += 1) === 1 ? ACCESS_1 : ACCESS_2);
        }
        return runResponses.shift();
      }),
    );

    const log = captureLog();
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: REFRESH })!;
    const exec = makeFlyExecutor('https://gogcli-gog-runner.fly.dev', 'runner-key', source);
    await expect(exec(['--json', '--color=never', '--no-input', 'gmail', 'search', 'q'], {})).resolves.toBe(
      '{"threads":[]}',
    );

    // The whole story got recorded...
    expect(log.events()).toEqual([
      'token.minted',
      'token.evicted',
      'token.minted',
      'replay.attempted',
      'replay.succeeded',
    ]);
    // ...and not one byte of credential material is in any of it.
    const everything = log.allText();
    for (const secret of CREDENTIAL_MATERIAL) {
      expect(everything, secret).not.toContain(secret);
    }
    // Nor the runner's own bearer, which is a credential too.
    expect(everything).not.toContain('runner-key');
    expect(log.toStdout).toEqual([]);
  });

  it('cannot leak a token that a failure message quotes verbatim', async () => {
    // The realistic way a token gets near a log at all: the replay fails too,
    // and the record of that failure is built from gog's own error text, which
    // embeds the whole command line — access token included. Nothing in this
    // layer authored that string, so nothing in this layer can vet it; the only
    // thing standing between it and the log is the redactor.
    let minted = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).includes('oauth2.googleapis.com')) {
          return tokenResponse((minted += 1) === 1 ? ACCESS_1 : ACCESS_2);
        }
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: `Command failed: gog gmail search q --access-token ${minted === 1 ? ACCESS_1 : ACCESS_2}`,
            stderr:
              `Google API error (401 authError): token ${minted === 1 ? ACCESS_1 : ACCESS_2} ` +
              'had invalid authentication credentials.',
          }),
        };
      }),
    );

    const log = captureLog();
    const source = makeAccessTokenSource({ ...CLIENT, GOG_REFRESH_TOKEN: REFRESH })!;
    const exec = makeFlyExecutor('https://gogcli-gog-runner.fly.dev', 'runner-key', source);
    await expect(
      exec(['--json', '--color=never', '--no-input', 'gmail', 'search', 'q'], {}),
    ).rejects.toThrow(/invalid authentication credentials/);

    expect(log.events()).toEqual([
      'token.minted',
      'token.evicted',
      'token.minted',
      'replay.attempted',
      'replay.failed',
      // The replay's own token was refused too, so it leaves the cache exactly
      // as the first one did. Without this trailing eviction the cache keeps
      // serving a token that has now failed twice, and every following call
      // pays a mint and two /run round-trips to rediscover that.
      'token.evicted',
    ]);
    // The failure record really did carry the offending text through...
    const failed = log.records().at(-2)!;
    expect(failed.reason as string).toMatch(/invalid authentication credentials/);
    // ...with the token itself replaced.
    expect(failed.reason as string).toContain('[REDACTED]');
    const everything = log.allText();
    for (const secret of CREDENTIAL_MATERIAL) {
      expect(everything, secret).not.toContain(secret);
    }
  });
});
