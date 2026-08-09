import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  gogAuth,
  CONNECTOR_INSTRUCTIONS,
  GOOGLE_PROBE_TIMEOUT_MS,
  LOGIN_ATTEMPT_TIMEOUT_MS,
  LOGIN_RETRY_DELAY_MS,
} from '../src/connector-auth.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = { FLY_ENDPOINT: 'https://runner.example' };

/** A `fetch` that answers layer 1 and layer 2 separately. */
function routedFetch(googleProbe: () => unknown) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return { ok: true, status: 200 };
    if (url.endsWith('/health/google')) return googleProbe();
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** A probe response object shaped like the runner's JSON answer. */
const probeBody = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const PREFIX = 'gog-auth ';

/**
 * Capture the two stderr-safe console methods, and the four Node routes to
 * STDOUT — which is the JSON-RPC channel, so this module must never touch them.
 */
function captureLog() {
  const emitted: Array<{ method: 'warn' | 'error'; line: string }> = [];
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
    records(): Record<string, unknown>[] {
      return emitted.map((e) => {
        expect(e.line.startsWith(PREFIX)).toBe(true);
        return JSON.parse(e.line.slice(PREFIX.length)) as Record<string, unknown>;
      });
    },
  };
}

describe('gogAuth.login', () => {
  it('verifies the key against the backend /health and returns the props', async () => {
    captureLog();
    const fetchMock = routedFetch(() => probeBody({ ok: true, measured: true, accounts: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const props = await gogAuth.login({ key: 'my-key' }, env);
    expect(props).toEqual({ key: 'my-key' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://runner.example/health');
    expect(init.headers).toEqual({ Authorization: 'Bearer my-key' });
    // A key check that can hang forever is a login the user abandons.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(LOGIN_ATTEMPT_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('throws when the backend rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(gogAuth.login({ key: 'bad' }, env)).rejects.toThrow(
      'Invalid connector key',
    );
  });
});

/**
 * DEFECT 1: the status check measured nothing it reported.
 *
 * `login()` verified the connector key against `/health`, an endpoint whose own
 * comment says it "does not depend on gog" — so a successful login proved layer
 * 1 (the bearer key reaches the box) and NOTHING about layer 2 (whether Google
 * still accepts the refresh token on the Fly volume). The user was told
 * "connected", twice, and the next Gmail call failed with a Google 401.
 *
 * These tests pin the fix and, more importantly, its shape: the connect path
 * now MEASURES the Google layer and RECORDS what it found — and never, under
 * any outcome, refuses the login on the strength of that measurement.
 */
describe('the connect-time Google-layer measurement', () => {
  it('probes layer 2 after the key check, with the same bearer and a bounded timeout', async () => {
    captureLog();
    const fetchMock = routedFetch(() => probeBody({ ok: true, measured: true, accounts: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await gogAuth.login({ key: 'my-key' }, env);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://runner.example/health/google');
    expect(init.headers).toEqual({ Authorization: 'Bearer my-key' });
    // A login that hangs on a status probe is a login the user abandons.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GOOGLE_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('records a healthy Google layer as its own transition', async () => {
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => probeBody({ ok: true, measured: true, accounts: [{ email: 'a@b.c' }] })));

    await gogAuth.login({ key: 'my-key' }, env);

    expect(log.records()).toHaveLength(1);
    const [record] = log.records();
    expect(record.event).toBe('connect.google-ok');
    expect(record.endpoint).toBe('https://runner.example');
    expect(log.emitted[0].method).toBe('warn');
    expect(log.toStdout).toEqual([]);
  });

  it('THE LOCKOUT GUARD: a dead Google credential is recorded, never used to refuse the login', async () => {
    // The re-authorization tools (gog_auth_add_url / gog_auth_add_complete) are
    // MCP tools, reachable only AFTER the connector is connected. Failing login
    // on a dead Google credential would lock the user out of the only path that
    // repairs it. Honesty is achieved by RECORDING, not by refusing.
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => probeBody({
      ok: false,
      // The runner states this explicitly: gog reached Google and Google said
      // no. Only that assertion licenses the `-unhealthy` verdict below.
      measured: true,
      accounts: [],
      error: 'invalid_grant: the stored Google refresh token is expired or revoked — re-authorize the account',
    })));

    const props = await gogAuth.login({ key: 'my-key' }, env);

    expect(props).toEqual({ key: 'my-key' });
    const [record] = log.records();
    expect(record.event).toBe('connect.google-unhealthy');
    expect(record.reason).toContain('invalid_grant');
    // A dead grant is a failure, so it goes to console.error, not console.warn.
    expect(log.emitted[0].method).toBe('error');
  });

  it('a runner that claims ok WITHOUT claiming it measured is recorded as unmeasured', async () => {
    // `connect.google-ok` asserts the credential was measured live and passed,
    // and its counterpart `refusal.google-ok` is the record documented as "the
    // one record that means we cannot explain this" — logged at error level and
    // held up as the only evidence that could justify automatic recovery on the
    // hosted path. Neither may be built on a bare `ok:true`: an affirmative
    // field is still only a claim, and a health claim with no measurement
    // behind it is exactly the defect this branch exists to delete. No current
    // runner emits this shape (the endpoint always sends both fields), which is
    // precisely why it needs a test rather than a reviewer.
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => probeBody({ ok: true, accounts: [{ email: 'a@b.c' }] })));

    // Still connects — recording is never refusing. See THE LOCKOUT GUARD.
    await expect(gogAuth.login({ key: 'my-key' }, env)).resolves.toEqual({ key: 'my-key' });

    const [record] = log.records();
    expect(record.event).toBe('connect.google-unmeasured');
    expect(record.reason).toMatch(/did not report whether/i);
  });

  it('says so plainly when the runner reports unhealthy without a cause', async () => {
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => probeBody({ ok: false, measured: true })));

    await gogAuth.login({ key: 'my-key' }, env);

    const [record] = log.records();
    expect(record.event).toBe('connect.google-unhealthy');
    expect(record.reason).toMatch(/no cause/i);
  });

  it('REVIEW DEFECT: a probe that could not RUN is never recorded as "Google refused"', async () => {
    // The mirror image of the defect this branch fixes. `server.mjs` answers
    // `ok:false` for causes that describe the PROBE — it timed out, it could not
    // be run at all (no `gog` on PATH, no `credentials.json` on the volume), its
    // output could not be parsed — and reading `ok !== true` as a refusal filed
    // every one of them at error level under an event that means "Google was
    // asked and refused". An operator grepping event names would close the
    // incident on evidence nobody gathered.
    const log = captureLog();
    for (const error of [
      'the Google probe timed out before gog answered',
      'the Google probe could not be run',
      'gog auth list --check returned unrecognized output',
      'gog did not report token validity',
      'gog reported an account it explicitly did not check',
    ]) {
      log.emitted.length = 0;
      vi.stubGlobal('fetch', routedFetch(() => probeBody({ ok: false, measured: false, error })));

      const props = await gogAuth.login({ key: 'my-key' }, env);

      expect(props).toEqual({ key: 'my-key' });
      const [record] = log.records();
      expect(record.event).toBe('connect.google-unmeasured');
      // The runner's own words still ride along — under-claiming the verdict
      // costs the operator nothing, because the cause is on the same line.
      expect(record.reason).toBe(error);
      // warn, not error: the absence of a measurement is not evidence.
      expect(log.emitted[0].method).toBe('warn');
    }
  });

  it('will not claim ill health from a runner that never said it measured', async () => {
    // Silence is not a measurement, so `ok:false` alone buys no verdict.
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => probeBody({ ok: false, error: 'something went wrong' })));

    await gogAuth.login({ key: 'my-key' }, env);

    const [record] = log.records();
    expect(record.event).toBe('connect.google-unmeasured');
    expect(record.reason).toContain('something went wrong');
  });

  it('calls a runner that cannot answer the probe UNMEASURED, never unhealthy', async () => {
    // A runner older than the probe endpoint answers 404. Reporting that as
    // "your Google credential is dead" would rebuild the very defect this
    // measurement exists to remove: a claim about health nobody measured.
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => probeBody({}, 404)));

    const props = await gogAuth.login({ key: 'my-key' }, env);

    expect(props).toEqual({ key: 'my-key' });
    const [record] = log.records();
    expect(record.event).toBe('connect.google-unmeasured');
    expect(record.reason).toContain('404');
    expect(log.emitted[0].method).toBe('warn');
  });

  it('swallows a probe whose fetch rejects, and still logs in', async () => {
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }));

    const props = await gogAuth.login({ key: 'my-key' }, env);

    expect(props).toEqual({ key: 'my-key' });
    const [record] = log.records();
    expect(record.event).toBe('connect.google-unmeasured');
    expect(record.reason).toContain('aborted');
  });

  it('swallows a non-Error rejection too', async () => {
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'socket hang up';
    }));

    await expect(gogAuth.login({ key: 'my-key' }, env)).resolves.toEqual({ key: 'my-key' });
    expect(log.records()[0].reason).toContain('socket hang up');
  });

  it('treats a body it cannot parse as unmeasured', async () => {
    // A proxy or an error page in front of the runner answers 200 with HTML.
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    })));

    await expect(gogAuth.login({ key: 'my-key' }, env)).resolves.toEqual({ key: 'my-key' });
    expect(log.records()[0].event).toBe('connect.google-unmeasured');
  });

  it('never lets the probe leak the connector key into a log line', async () => {
    const log = captureLog();
    vi.stubGlobal('fetch', routedFetch(() => {
      throw new Error('connect ECONNREFUSED using Bearer sk-connector-key-secret');
    }));

    await gogAuth.login({ key: 'sk-connector-key-secret' }, env);

    const line = log.emitted.map((e) => e.line).join('\n');
    expect(line).not.toContain('sk-connector-key-secret');
    expect(line).toContain('[REDACTED]');
  });
});

/**
 * The wording half of the same defect. claude.ai's "connected" / "refreshed" is
 * out of our control — `ConnectorAuth` exposes only a `login` hook, so
 * "refreshed" is an OAuth refresh inside OAUTH_KV that contacts neither Fly nor
 * Google. What IS in our control is every sentence the connector itself writes.
 */
describe('CONNECTOR_INSTRUCTIONS', () => {
  it('tells the model what a connected connector does and does not prove', () => {
    expect(CONNECTOR_INSTRUCTIONS).toMatch(/connected|refreshed/i);
    expect(CONNECTOR_INSTRUCTIONS).toMatch(/does not|never/i);
    // The one tool that performs a live refresh against Google.
    expect(CONNECTOR_INSTRUCTIONS).toContain('gog_auth_health');
    // And the repair path, so a reader who finds a dead grant is not stranded.
    expect(CONNECTOR_INSTRUCTIONS).toContain('gog_auth_add_url');
    expect(CONNECTOR_INSTRUCTIONS).toContain('gog_auth_add_complete');
  });

  it('is wired into every hosted agent, not merely exported', () => {
    // worker.ts cannot load under the node pool (it imports the Worker-only
    // `agents` runtime), so its wiring is asserted as source text — the same
    // technique the runner suite uses to pin fly.toml's min_machines_running.
    const worker = readFileSync(
      fileURLToPath(new URL('../src/worker.ts', import.meta.url)),
      'utf8',
    );
    expect(worker).toContain('CONNECTOR_INSTRUCTIONS');
    expect(worker).toMatch(/instructions:\s*CONNECTOR_INSTRUCTIONS/);
  });
});

/**
 * DEFECT 4: a connector that never completed enrolment.
 *
 * `gog_docs` (and, in the same inventory, `gog_sheets` and `gog_drive`) exposed
 * only `authenticate` / `complete_authentication` — the signature of a connector
 * whose LAYER 1 enrolment never finished. Nothing about that is docs-specific,
 * which points away from the docs tools and at the one place enrolment can fail:
 * `login()`.
 *
 * And `login()` had exactly one failure mode. Every non-2xx — and only a non-2xx,
 * because a rejected `fetch` was not caught at all — produced "Invalid connector
 * key (backend rejected it)". But the runner answers 503 `{retryable:true}` for
 * the whole of its drain window, i.e. during EVERY deploy (`server.mjs`, the
 * `server.shuttingDown` guard), and Fly's proxy answers 502 while a stopped
 * Machine boots. A user who enrolled during either was told their key was wrong.
 * The rational response to "your key is wrong" is to stop, which leaves precisely
 * the half-enrolled connector observed.
 *
 * So the fix is to tell the truth about WHICH layer refused, and — because the
 * transient case is a normal consequence of deploying — to absorb it by retrying
 * rather than reporting it at all.
 *
 * Note the direction of travel: this makes login STRICTLY MORE permissive. It can
 * only turn a refusal into a success, never the reverse, so it cannot strand a
 * user outside the connector the way a Google-layer gate would.
 */
describe('login() tells a rejected key apart from an unreachable backend', () => {
  /** A `/health` that answers `results` in order, then repeats the last one. */
  function healthSequence(...results: Array<() => unknown>) {
    let i = 0;
    return vi.fn(async (url: string) => {
      if (url.endsWith('/health/google')) return probeBody({ ok: true, measured: true, accounts: [] });
      const step = results[Math.min(i, results.length - 1)];
      i += 1;
      return step();
    });
  }

  const reject = (err: unknown) => () => {
    throw err;
  };
  const status = (code: number) => () => ({ ok: false, status: code });

  it('the retry is short enough that the user never sees it as a hang', () => {
    // login() runs inside the /authorize POST the human is watching and
    // claude.ai is timing. Two attempts plus one delay must stay well inside
    // any sane authorize budget.
    expect(LOGIN_RETRY_DELAY_MS).toBeLessThan(1_000);
    expect(2 * LOGIN_ATTEMPT_TIMEOUT_MS + LOGIN_RETRY_DELAY_MS).toBeLessThanOrEqual(20_000);
  });

  it('the WHOLE of login() stays inside the authorize budget, probe included', () => {
    // The bound above covered only the key check, but login() also runs the
    // Google probe — and the two worst cases compose: an unreachable Machine
    // burns both attempts and the delay, and THEN the probe hangs to its own
    // timeout. That total is the number the human actually waits, so it is the
    // number that gets asserted. Chosen, not inherited: 5s + 0.25s + 5s + 4s.
    const worstCaseMs =
      2 * LOGIN_ATTEMPT_TIMEOUT_MS + LOGIN_RETRY_DELAY_MS + GOOGLE_PROBE_TIMEOUT_MS;
    expect(worstCaseMs).toBeLessThanOrEqual(20_000);
    // And the probe is never the dominant term: a diagnostic that outweighs the
    // check it follows has stopped being a diagnostic.
    expect(GOOGLE_PROBE_TIMEOUT_MS).toBeLessThan(LOGIN_ATTEMPT_TIMEOUT_MS);
  });

  it('probes once per enrolment — deliberately unthrottled, unlike the refusal probe', async () => {
    // connector-runtime.ts throttles ITS probe to one a minute because a model
    // retrying a refused call can fire it in a loop. This one cannot loop: it is
    // reached only by a human completing an enrolment, at most once per
    // connector. Five connectors set up back to back means five `gog auth list
    // --check` spawns spread across five human interactions, which the Fly box
    // handles comfortably. So the throttle is omitted on purpose, not by
    // oversight — and this test fails if login() ever grows a second probe.
    captureLog();
    const fetchMock = routedFetch(() => probeBody({ ok: true, measured: true, accounts: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await gogAuth.login({ key: 'my-key' }, env);
    await gogAuth.login({ key: 'my-key' }, env);

    const probes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/health/google'));
    expect(probes).toHaveLength(2);
  });

  it('blames the key ONLY on 401, and does not retry a settled answer', async () => {
    const log = captureLog();
    const fetchMock = healthSequence(status(401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(gogAuth.login({ key: 'bad' }, env)).rejects.toThrow(
      'Invalid connector key (backend rejected it)',
    );
    // A rejection is an answer. Asking again would only be slower.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.records()[0].event).toBe('connect.key-rejected');
    expect(log.emitted[0].method).toBe('error');
  });

  it('blames the key on 403 too', async () => {
    captureLog();
    vi.stubGlobal('fetch', healthSequence(status(403)));
    await expect(gogAuth.login({ key: 'bad' }, env)).rejects.toThrow(
      'Invalid connector key',
    );
  });

  it('a 503 from the drain window is retried, and a redeploy stops costing an enrolment', async () => {
    // This is the whole defect in one test: the runner returns exactly this for
    // the length of every deploy, and it used to end the user's enrolment.
    const log = captureLog();
    const fetchMock = healthSequence(status(503), () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(gogAuth.login({ key: 'good' }, env)).resolves.toEqual({ key: 'good' });
    // /health twice, then the Google probe.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://runner.example/health',
      'https://runner.example/health',
      'https://runner.example/health/google',
    ]);
    // A transient blip that the retry absorbed is not an auth failure.
    expect(log.records().map((r) => r.event)).toEqual(['connect.google-ok']);
  });

  it('says the backend is unreachable — never that the key is wrong — when it stays down', async () => {
    const log = captureLog();
    const fetchMock = healthSequence(status(503));
    vi.stubGlobal('fetch', fetchMock);

    const err = await gogAuth.login({ key: 'good' }, env).catch((e: Error) => e);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('503');
    expect(message).toMatch(/NOT rejected/);
    expect(message).toMatch(/try again/i);
    expect(message).not.toMatch(/invalid connector key/i);
    expect(log.records()[0].event).toBe('connect.runner-unreachable');
  });

  it('MUST NOT REGRESS: an unreachable backend never produces Google re-auth advice', async () => {
    // The layer the user cannot see is Google; the layer that just failed is
    // transport. Conflating them is the exact defect 2.21.1 fixed on the /run
    // path, and it must not reappear on the enrolment path.
    captureLog();
    vi.stubGlobal('fetch', healthSequence(status(502)));

    const err = await gogAuth.login({ key: 'good' }, env).catch((e: Error) => e);

    expect((err as Error).message).not.toMatch(/google|re-?authoriz|refresh token|invalid_grant/i);
  });

  it('treats a rejected fetch as unreachable, not as a bad key', async () => {
    // This case did not merely report the wrong cause — it was never caught at
    // all, so it surfaced as an unhandled failure inside /authorize.
    const log = captureLog();
    const fetchMock = healthSequence(reject(new Error('connect ECONNREFUSED 10.0.0.1:8080')));
    vi.stubGlobal('fetch', fetchMock);

    const err = await gogAuth.login({ key: 'good' }, env).catch((e: Error) => e);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((err as Error).message).toContain('ECONNREFUSED');
    expect((err as Error).message).not.toMatch(/invalid connector key/i);
    expect(log.records()[0].event).toBe('connect.runner-unreachable');
  });

  it('survives a non-Error rejection', async () => {
    captureLog();
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    vi.stubGlobal('fetch', healthSequence(reject('socket hang up')));

    const err = await gogAuth.login({ key: 'good' }, env).catch((e: Error) => e);

    expect((err as Error).message).toContain('socket hang up');
  });

  it('recovers when the first attempt cannot connect and the second can', async () => {
    captureLog();
    const fetchMock = healthSequence(reject(new Error('network error')), () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(gogAuth.login({ key: 'good' }, env)).resolves.toEqual({ key: 'good' });
  });

  it('FAILS SAFE: a response carrying no status is transient, never a bad key', async () => {
    // Anything that reaches here without a status is something we do not
    // recognise. The costly mistake is telling a user with a perfectly good key
    // that it is wrong, so an unknown answer resolves toward "try again".
    const log = captureLog();
    const fetchMock = healthSequence(() => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await gogAuth.login({ key: 'good' }, env).catch((e: Error) => e);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((err as Error).message).not.toMatch(/invalid connector key/i);
    expect((err as Error).message).toMatch(/no HTTP status/i);
    expect(log.records()[0].event).toBe('connect.runner-unreachable');
  });

  it('never lets the connector key reach the error the login page shows', async () => {
    const log = captureLog();
    vi.stubGlobal('fetch', healthSequence(
      reject(new Error('proxy error while sending Bearer sk-connector-key-secret')),
    ));

    const err = await gogAuth.login({ key: 'sk-connector-key-secret' }, env).catch((e: Error) => e);

    expect((err as Error).message).not.toContain('sk-connector-key-secret');
    expect((err as Error).message).toContain('[REDACTED]');
    expect(log.emitted.map((e) => e.line).join('\n')).not.toContain('sk-connector-key-secret');
  });

  it('does not probe the Google layer when enrolment itself failed', async () => {
    // Nothing may be recorded about Google on a login that never happened.
    const log = captureLog();
    const fetchMock = healthSequence(status(401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(gogAuth.login({ key: 'bad' }, env)).rejects.toThrow();

    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/health/google'))).toBe(false);
    expect(log.records().every((r) => !String(r.event).startsWith('connect.google'))).toBe(true);
  });
});
