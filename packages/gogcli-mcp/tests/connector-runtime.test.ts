import { describe, it, expect, vi, afterEach } from 'vitest';
import { run, runExecutor } from '../src/runner.js';
import type { GogArg, GogExecutor, GogFileArg } from '../src/runner.js';
import { makeFlyExecutor, wrapServer, RunnerTransportError, isRunnerTransportError } from '../src/connector-runtime.js';
import { runOrDiagnose } from '../src/tools/utils.js';
import { makeAccessTokenSource, clearAccessTokenCache } from '../src/google-token.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('wrapServer', () => {
  // Neutralize ambient GOG_ACCOUNT / GOG_READONLY so run()'s assembled arg list
  // is deterministic regardless of the shell the suite runs in.
  function stubEnv() {
    vi.stubEnv('GOG_ACCOUNT', '');
    vi.stubEnv('GOG_READONLY', '');
  }

  it('scopes each registerTool handler so run() forwards to the injected executor', async () => {
    stubEnv();
    let captured: ((...a: unknown[]) => unknown) | undefined;
    const server = {
      registerTool(_name: string, _config: unknown, handler: (...a: unknown[]) => unknown) {
        captured = handler;
        return 'registered';
      },
    };
    const executor: GogExecutor = vi.fn(async () => 'MOCK_STDOUT');

    const wrapped = wrapServer(server, executor);
    // The unchanged registrar registers a handler that calls run() — exactly
    // what the real base registrars do.
    const ret = wrapped.registerTool('gog_sheets_get', {}, async () =>
      run(['sheets', 'get', 'A1']),
    );
    expect(ret).toBe('registered'); // the original return flows back through

    // Invoking the wrapped handler must resolve run()'s executor to ours.
    const out = await captured!({ some: 'args' }, { extra: true });
    expect(out).toBe('MOCK_STDOUT');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(
      ['--json', '--color=never', '--no-input', 'sheets', 'get', 'A1'],
      expect.anything(),
    );
  });

  it('also intercepts the low-level `tool` registration method', async () => {
    stubEnv();
    let captured: ((...a: unknown[]) => unknown) | undefined;
    const server = {
      tool(_name: string, handler: (...a: unknown[]) => unknown) {
        captured = handler;
      },
    };
    const executor: GogExecutor = vi.fn(async () => 'VIA_TOOL');
    const wrapped = wrapServer(server, executor);
    wrapped.tool('t', async () => run(['gmail', 'search', 'q']));
    const out = await captured!();
    expect(out).toBe('VIA_TOOL');
    expect(executor).toHaveBeenCalledWith(
      ['--json', '--color=never', '--no-input', 'gmail', 'search', 'q'],
      expect.anything(),
    );
  });

  it('passes a non-function trailing arg straight through (no wrapping)', () => {
    const calls: unknown[][] = [];
    const server = {
      registerTool(...args: unknown[]) {
        calls.push(args);
        return 'ok';
      },
    };
    const executor: GogExecutor = vi.fn();
    const wrapped = wrapServer(server, executor);
    // Only a name, no handler — nothing to wrap.
    expect(wrapped.registerTool('just-a-name')).toBe('ok');
    expect(calls).toEqual([['just-a-name']]);
    expect(executor).not.toHaveBeenCalled();
  });

  it('proxies non-registration properties and methods through unchanged', () => {
    const server = {
      answer: 42,
      greet() {
        return 'hi';
      },
      registerTool() {},
    };
    const wrapped = wrapServer(server, vi.fn());
    expect(wrapped.answer).toBe(42);
    expect(wrapped.greet()).toBe('hi');
  });
});

describe('makeFlyExecutor', () => {
  const ENDPOINT = 'https://runner.example';
  const KEY = 'secret-key';

  it('POSTs the arg-array to /run with the bearer and returns stdout', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stdout: 'gog output' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    const out = await exec(['sheets', 'get', 'A1'], {});
    expect(out).toBe('gog output');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://runner.example/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe(JSON.stringify({ args: ['sheets', 'get', 'A1'] }));
  });

  // A hosted gog authenticates as whoever seeded the Fly volume, not as the
  // person calling it (#230). mcp-host can give each caller their own child
  // carrying their own GOG_ACCESS_TOKEN, so the missing link is the child
  // handing that token to the backend for ITS call only — never as something
  // ambient on the box, which would be the same shared identity from the other
  // direction.
  describe('per-request access token', () => {
    function okFetch() {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ stdout: 'ok' }) }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }
    function bodyOf(fetchMock: { mock: { calls: unknown[][] } }, i = 0): Record<string, unknown> {
      const [, init] = fetchMock.mock.calls[i] as [string, RequestInit];
      return JSON.parse(init.body as string) as Record<string, unknown>;
    }

    it('sends the token with the request when one is available', async () => {
      const fetchMock = okFetch();
      const exec = makeFlyExecutor(ENDPOINT, KEY, () => 'ya29.caller-token');
      await exec(['auth', 'status'], {});
      expect(bodyOf(fetchMock)).toEqual({ args: ['auth', 'status'], accessToken: 'ya29.caller-token' });
    });

    it('omits the field entirely when there is no token', async () => {
      // Absent, not null or "": the backend distinguishes "act as the caller"
      // from "act as the box", and a present-but-empty field would be a third
      // state neither side has a meaning for.
      const fetchMock = okFetch();
      for (const provider of [undefined, () => undefined, () => '']) {
        vi.clearAllMocks();
        const exec = makeFlyExecutor(ENDPOINT, KEY, provider as (() => string | undefined) | undefined);
        await exec(['auth', 'status'], {});
        expect(bodyOf(fetchMock)).toEqual({ args: ['auth', 'status'] });
      }
    });

    it('reads the token per CALL, not once when the executor is built', async () => {
      // The whole contract is "this token belongs to this request". Reading it
      // once at construction would pin the first caller's identity onto an
      // executor that outlives them — exactly the bug this closes, rebuilt.
      const fetchMock = okFetch();
      const tokens = ['first', 'second'];
      const exec = makeFlyExecutor(ENDPOINT, KEY, () => tokens.shift());
      await exec(['auth', 'status'], {});
      await exec(['auth', 'status'], {});
      expect(bodyOf(fetchMock, 0).accessToken).toBe('first');
      expect(bodyOf(fetchMock, 1).accessToken).toBe('second');
    });
  });

  // Everything below is the file-arg wire contract. The Worker has no filesystem
  // and no gog binary, so a GogFileArg must cross the wire STRUCTURED and be
  // materialized on the Fly runner. If this layer ever flattened it back into an
  // argv string, the >4 KiB payload it exists to carry would hit the arg cap again.
  describe('GogFileArg forwarding', () => {
    function bodyOf(fetchMock: { mock: { calls: unknown[][] } }): { args: GogArg[] } {
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return JSON.parse(init.body as string) as { args: GogArg[] };
    }

    function okFetch() {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ stdout: 'ok' }) }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('serializes a file arg into the request body with its contents intact', async () => {
      const fetchMock = okFetch();
      // Comfortably past the runner's 4 KiB single-arg cap — the whole point.
      const html = '<p>' + 'x'.repeat(10_000) + '</p>';
      const fileArg: GogFileArg = {
        kind: 'file',
        flag: 'body-html-file',
        contents: html,
        ext: 'html',
      };

      const exec = makeFlyExecutor(ENDPOINT, KEY);
      await exec(['gmail', 'drafts', 'create', fileArg], {});

      const { args } = bodyOf(fetchMock);
      expect(args[3]).toEqual(fileArg);
      // Byte-for-byte: no truncation, no re-encoding, no flattening to argv.
      expect((args[3] as GogFileArg).contents).toBe(html);
      expect((args[3] as GogFileArg).contents).toHaveLength(html.length);
      expect(typeof args[3]).toBe('object');
    });

    it('preserves order across a mixed array of strings and file args', async () => {
      const fetchMock = okFetch();
      const body: GogFileArg = { kind: 'file', flag: 'body-file', contents: 'plain body' };
      const notes: GogFileArg = {
        kind: 'file',
        flag: 'signature-file',
        contents: 'sig',
        ext: 'html',
      };
      const sent: GogArg[] = [
        '--json',
        'gmail',
        'send',
        '--to=a@example.com',
        body,
        '--subject=Hi',
        notes,
        '--no-input',
      ];

      const exec = makeFlyExecutor(ENDPOINT, KEY);
      await exec(sent, {});

      // Order is load-bearing: gog parses positionally, so a reordered array is
      // a different command.
      expect(bodyOf(fetchMock).args).toEqual(sent);
    });

    it('round-trips UTF-8 payloads — multibyte, emoji, and interior newlines', async () => {
      const fetchMock = okFetch();
      // Multibyte scripts, an astral-plane emoji (surrogate pair), and combining
      // marks: the classes most likely to be mangled by a naive re-encode.
      const contents = 'héllo wörld — naïve café\n日本語のテキスト\n🎉 emoji + ZWJ 👩‍💻\né\n';
      const fileArg: GogFileArg = { kind: 'file', flag: 'body-file', contents };

      const exec = makeFlyExecutor(ENDPOINT, KEY);
      await exec([fileArg], {});

      const got = bodyOf(fetchMock).args[0] as GogFileArg;
      expect(got.contents).toBe(contents);
      // Interior newlines survive; only gog's own per-command trailing-newline
      // trimming (on the runner) may alter the tail.
      expect(got.contents.split('\n')).toHaveLength(contents.split('\n').length);
    });

    it('omits ext when the caller omitted it, leaving the default to the runner', async () => {
      const fetchMock = okFetch();
      const exec = makeFlyExecutor(ENDPOINT, KEY);
      await exec([{ kind: 'file', flag: 'note-file', contents: 'n' }], {});

      const got = bodyOf(fetchMock).args[0] as GogFileArg;
      // Thresholding and defaulting live in ONE place each; this layer must not
      // invent an ext, or two boxes would disagree about the temp filename.
      expect('ext' in got).toBe(false);
    });

    it('still errors deterministically when a file-arg call fails on the runner', async () => {
      // Classification must not vary with arg shape: a 422 is "gog ran and
      // failed" whether or not the call carried a file arg.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 422,
          json: async () => ({ error: 'use only one of --body-html or --body-html-file' }),
        })),
      );
      const exec = makeFlyExecutor(ENDPOINT, KEY);
      const err = (await exec(
        [{ kind: 'file', flag: 'body-html-file', contents: 'x'.repeat(9000) }],
        {},
      ).catch((e: Error) => e)) as Error;
      expect(err.message).toContain('use only one of --body-html');
      expect(err.message).not.toMatch(/retry|transient/i);
    });

    it('gives a large payload no extra deadline beyond the standard grace', async () => {
      // Deliberate: upload is a datacenter hop measured in milliseconds, so the
      // runner must still win the race and return a real error.
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      okFetch();
      const exec = makeFlyExecutor(ENDPOINT, KEY);
      await exec([{ kind: 'file', flag: 'body-file', contents: 'y'.repeat(500_000) }], {});
      expect(timeoutSpy).toHaveBeenCalledWith(35_000);
      timeoutSpy.mockRestore();
    });
  });

  // A scale-to-zero Fly backend that never answers would otherwise hang the MCP
  // request forever: Workers' fetch has no default deadline, and the stdio path's
  // 30s kill lives in the child process we are NOT spawning here.
  it('arms a client-side deadline so a cold or wedged backend cannot hang forever', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ stdout: '' }) }));
    vi.stubGlobal('fetch', fetchMock);

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await exec(['x'], {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives the backend its own timeout plus headroom, so the server wins when it can', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ stdout: '' }) })));

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await exec(['x'], { timeout: 60_000 });

    expect(timeoutSpy).toHaveBeenCalledWith(65_000);
    timeoutSpy.mockRestore();
  });

  it('defaults to the stdio path\'s 30s budget (plus headroom) when no timeout is given', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ stdout: '' }) })));

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await exec(['x'], {});

    expect(timeoutSpy).toHaveBeenCalledWith(35_000);
    timeoutSpy.mockRestore();
  });

  it('reports an actionable timeout rather than a bare AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      }),
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['x'], {})).rejects.toThrow(/gog-runner did not respond within 35000ms/);
  });

  it('rethrows a non-timeout fetch failure verbatim, not as a timeout', async () => {
    // A real network error (DNS failure, connection refused) rejects with a
    // TypeError named 'TypeError' — neither TimeoutError nor AbortError — so it
    // must pass through untouched rather than be relabelled a timeout.
    const networkErr = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw networkErr; }));
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['x'], {})).rejects.toBe(networkErr);
  });

  it('rethrows a non-Error rejection verbatim', async () => {
    // Guards the `err instanceof Error ? err.name : ''` false branch: if fetch
    // ever rejects with a non-Error value, it is rethrown unchanged.
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'kaboom'; }));
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['x'], {})).rejects.toBe('kaboom');
  });

  // The runner reports "gog ran and exited non-zero" as 422 — deliberately NOT
  // a 5xx, so it can never be confused with Fly's edge failing to reach the
  // Machine, and so it never matches TRANSIENT_ERROR_PATTERN (/\b5\d\d\b/).
  it('surfaces gog stderr verbatim for a 422 and never advises a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'gog exited with code 1',
          stderr: 'invalid attachment id',
          retryable: false,
        }),
      })),
    );

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    const err = (await exec(['gmail', 'attachment'], {}).catch((e: Error) => e)) as Error;
    expect(err.message).toContain('gog exited with code 1');
    expect(err.message).toContain('invalid attachment id');
    // Deterministic: retrying cannot help, so nothing may invite it.
    expect(err.message).not.toMatch(/retry/i);
    expect(err.message).not.toMatch(/transient/i);
    // It reached gog — the executor must not claim otherwise.
    expect(err.message).not.toMatch(/never reached gog/i);
  });

  // The live repro that started this: an --out path from the caller's sandbox
  // does not exist on the runner, so gog cannot create it. No number of retries
  // makes the directory appear.
  it('reports an unwritable --out path as a plain deterministic gog error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'mkdir /home/claude: operation not supported',
          stderr: 'mkdir /home/claude: operation not supported',
          retryable: false,
        }),
      })),
    );

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    const err = (await exec(['gmail', 'attachment'], {}).catch((e: Error) => e)) as Error;
    expect(err.message).toContain('mkdir /home/claude');
    expect(err.message).not.toMatch(/retry|transient/i);
    // stderr duplicating error must not be echoed twice.
    expect(err.message.match(/mkdir \/home\/claude/g)).toHaveLength(1);
  });

  it('marks the runner drain 503 as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'gog-runner is shutting down', retryable: true }),
      })),
    );

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['gmail', 'attachment'], {})).rejects.toThrow(/restarting; retry/i);
  });

  it('still advises a retry on a drain 503 whose body is unreadable', async () => {
    // Covers the no-detail arm: a drain that races the response body away is
    // still the runner refusing work on purpose, so it stays retryable.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json');
        },
      })),
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    const err = (await exec(['x'], {}).catch((e: Error) => e)) as Error;
    expect(err.message).toBe('gog-runner is restarting; retry this call.');
  });

  // Fly's edge could not reach the Machine: no runner body at all (an HTML error
  // page or an empty response). This is the ONLY case that is genuinely transient.
  it('names the gateway hop when a 502 carries no runner body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('Fly returned HTML, not JSON');
        },
      })),
    );

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['gmail', 'attachment'], {})).rejects.toThrow(
      /never reached gog.*transient/s,
    );
  });

  // Belt and braces for the rollout window (and any future runner that answers
  // 5xx with real detail): if the runner did speak, repeat its words rather than
  // asserting the request never arrived.
  it('repeats the runner detail on a 5xx that does carry a body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => ({ error: 'gog exited with code 1', stderr: 'bad flag' }),
      })),
    );

    const exec = makeFlyExecutor(ENDPOINT, KEY);
    const err = (await exec(['bogus'], {}).catch((e: Error) => e)) as Error;
    expect(err.message).toContain('gog exited with code 1');
    expect(err.message).toContain('bad flag');
    expect(err.message).not.toMatch(/never reached gog/i);
    // A runner body proves gog ran, so this is deterministic — nothing may
    // invite a retry, exactly as for the 422 path.
    expect(err.message).not.toMatch(/retry|transient/i);
    // And the status digits must not leak into the message: a literal "502"
    // matches TRANSIENT_ERROR_PATTERN downstream and re-attaches the hint.
    expect(err.message).not.toMatch(/\b5\d\d\b/);
  });

  it('falls back to an HTTP-status message when the error body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      })),
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['x'], {})).rejects.toThrow('gog-runner HTTP 500');
  });

  it('handles a 422 whose body is unreadable without pretending it never ran', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => {
          throw new Error('not json');
        },
      })),
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['x'], {})).rejects.toThrow(/gog failed on the runner/i);
  });
});

// A failure the RUNNER authored — its own bearer check, its own request
// validation, its own drain — never reached gog and never showed a credential
// to Google. Those failures must be distinguishable by TYPE, because the layer
// that diagnoses them (tools/utils.ts) can only otherwise guess from prose, and
// guessing is what turned the runner's bare `unauthorized` body into "your
// Google sign-in expired, re-authorize".
describe('makeFlyExecutor runner-authored transport failures', () => {
  const ENDPOINT = 'https://gogcli-gog-runner.fly.dev';
  const KEY = 'k';

  function stubStatus(status: number, body?: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => {
          if (body === undefined) throw new Error('not json');
          return body;
        },
      })),
    );
  }

  async function thrownBy(status: number, body?: unknown): Promise<unknown> {
    stubStatus(status, body);
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    return exec(['gmail', 'search', 'q'], {}).catch((e: unknown) => e);
  }

  // The exact body fly-gog-runner/server.mjs sends when its bearer check fails
  // (server.mjs:450 /health, :460 /run) — nothing to do with Google.
  const RUNNER_401 = { error: 'unauthorized' };

  it('types the runner bearer rejection as transport auth, not a gog failure', async () => {
    const err = await thrownBy(401, RUNNER_401);
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-auth');
    expect((err as RunnerTransportError).status).toBe(401);
  });

  it('names the real cause — the runner key mismatch — and never the Google account', async () => {
    const err = (await thrownBy(401, RUNNER_401)) as Error;
    expect(err.message).toContain('GOG_RUNNER_KEY');
    expect(err.message).toContain('RUNNER_KEY');
    expect(err.message).not.toMatch(/gog_auth_add/i);
    // The runner's own body is the single word "unauthorized". Repeating it is
    // what fed DEFINITE_AUTH_PATTERN in tools/utils.ts; the status digits do the
    // same via /\b401\b/. Neither may appear, so that even if the TYPE is lost
    // at some future boundary the prose cannot be misread as Google's.
    expect(err.message).not.toMatch(/unauthorized/i);
    expect(err.message).not.toMatch(/\b401\b/);
  });

  it('types the runner request-validation 400s as transport-request, keeping their detail', async () => {
    for (const detail of [
      'request body too large',
      'failed to read request body',
      'body must be valid JSON',
      'args must be an array',
      'accessToken must not contain whitespace or control characters',
    ]) {
      const err = await thrownBy(400, { error: detail });
      expect(isRunnerTransportError(err)).toBe(true);
      expect((err as RunnerTransportError).kind).toBe('transport-request');
      expect((err as RunnerTransportError).status).toBe(400);
      expect((err as Error).message).toBe(detail);
    }
  });

  it('still says something when a 400 body is unreadable', async () => {
    const err = await thrownBy(400);
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-request');
    expect((err as Error).message).toMatch(/gog-runner rejected the request/i);
  });

  it('types the drain 503 as retryable transport, message unchanged', async () => {
    const err = await thrownBy(503, { error: 'gog-runner is shutting down', retryable: true });
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-retryable');
    expect((err as RunnerTransportError).status).toBe(503);
    expect((err as Error).message).toBe('gog-runner is restarting; retry this call. gog-runner is shutting down');
  });

  it('types a retryable-flagged 500 (a materialization failure) as retryable transport', async () => {
    const err = await thrownBy(500, {
      error: 'failed to write a file arg to disk: ENOSPC: no space left on device',
      retryable: true,
    });
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-retryable');
    expect((err as RunnerTransportError).status).toBe(500);
  });

  it('types a bodiless gateway failure as retryable transport', async () => {
    const err = await thrownBy(502);
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-retryable');
    expect((err as RunnerTransportError).status).toBe(502);
  });

  it('types the client-side deadline as retryable transport with no status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      }),
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    const err = await exec(['x'], {}).catch((e: unknown) => e);
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-retryable');
    expect((err as RunnerTransportError).status).toBeUndefined();
  });

  // The other half of the contract: an error that carries gog's/Google's OWN
  // words must stay untyped, so the prose classifier still gets to read it.
  it('leaves a 422 (gog ran and failed) untyped, for the prose classifier', async () => {
    const err = await thrownBy(422, { error: 'gog failed', stderr: 'Error 401: invalid_grant' });
    expect(err).toBeInstanceOf(Error);
    expect(isRunnerTransportError(err)).toBe(false);
  });

  it('leaves a detail-bearing non-2xx untyped', async () => {
    const err = await thrownBy(502, { error: 'gog exited with code 1', stderr: 'bad flag' });
    expect(isRunnerTransportError(err)).toBe(false);
  });

  it('recognises only branded errors', () => {
    expect(isRunnerTransportError(new Error('unauthorized'))).toBe(false);
    expect(isRunnerTransportError('unauthorized')).toBe(false);
    expect(isRunnerTransportError(new RunnerTransportError('x', 'transport-auth', 401))).toBe(true);
  });

  // The whole chain, end to end, with the REAL executor, the REAL run() and the
  // REAL diagnose(): the incident was a user told all session to re-authorize a
  // Google account that was never asked for a credential.
  it('does not tell the caller to re-authorize Google when the RUNNER rejected our bearer', async () => {
    vi.stubEnv('GOG_ACCOUNT', '');
    vi.stubEnv('GOG_READONLY', '');
    stubStatus(401, RUNNER_401);
    const executor = makeFlyExecutor(ENDPOINT, KEY);
    const result = await runExecutor.run({ executor }, () =>
      runOrDiagnose(['sheets', 'get', 'A1'], {}),
    );
    const text = result.content[0].text as string;
    expect(result.isError).toBe(true);
    expect(text).not.toMatch(/gog_auth_add/);
    expect(text).not.toMatch(/re-authorize the account/i);
    expect(text).toContain('GOG_RUNNER_KEY');
  });
});

// A Google 401 on the ACCESS token and a dead REFRESH token are opposite
// failures that used to be told to the user identically.
//
//   * The access token is ours to replace. Google rejecting it means "mint
//     another and try again" — automatic, no human, no re-authorization. Before
//     this, the rejected token stayed cached for the rest of its nominal hour
//     and NOTHING retried, so every call in that window failed the same way and
//     only reconnecting (a fresh isolate, an empty cache) appeared to help.
//   * invalid_grant means the refresh token is gone. No re-mint is possible and
//     a human must re-authorize. Retrying that is a loop against a credential
//     that can never work.
//
// So the re-mint is gated hard: gog must actually have run (422), the token must
// be one WE supplied, gog's own stderr must say Google rejected it, the call
// must be safe to replay, and our cache must still hold exactly that token.
describe('makeFlyExecutor re-mints a rejected access token and replays once', () => {
  const ENDPOINT = 'https://gogcli-gog-runner.fly.dev';
  const KEY = 'k';

  // gog v0.34.1's real words when the access token it was handed is rejected.
  const GOOGLE_401_STDERR =
    'Note: Using direct access token (expires in ~1 hour; no auto-refresh)\n' +
    'Google API error (401 authError): Request had invalid authentication credentials. ' +
    'Expected OAuth 2 access token, login cookie or other valid authentication credential.';

  // What the executor really receives: run()'s assembleArgs puts the global
  // flags in front of the service and subcommand.
  const READ = ['--json', '--color=never', '--no-input', 'gmail', 'search', 'q'];
  const WRITE = ['--json', '--color=never', '--no-input', 'gmail', 'send', '--to', 'a@b.c'];

  function gogFailed(stderr: string) {
    return {
      ok: false,
      status: 422,
      // `error` is Node's execFile message, which embeds the whole command line
      // AND stderr — see the command-line test below for why that matters.
      json: async () => ({
        error: `Command failed: gog gmail search q\n${stderr}`,
        stderr,
        retryable: false,
      }),
    };
  }
  function ok(stdout: string) {
    return { ok: true, json: async () => ({ stdout }) };
  }
  function bodyOf(fetchMock: { mock: { calls: unknown[][] } }, i: number): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }
  /** A token source that hands out `tokens` in order and can be invalidated. */
  function source(tokens: (string | undefined)[], evicted = true) {
    const fn = vi.fn(async () => tokens.shift());
    return Object.assign(fn, { invalidate: vi.fn(async () => evicted) });
  }

  it('mints a new token and replays the call, invisibly to the caller', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gogFailed(GOOGLE_401_STDERR))
      .mockResolvedValueOnce(ok('thread json'));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);

    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).resolves.toBe('thread json');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 0).accessToken).toBe('ya29.stale');
    expect(bodyOf(fetchMock, 1).accessToken).toBe('ya29.fresh');
    // Evicted by VALUE — only the token that was actually rejected.
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).toHaveBeenCalledWith('ya29.stale');
  });

  it('replays exactly once, so a genuinely dead credential cannot loop', async () => {
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh', 'ya29.third']);

    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/Google API error \(401/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Two evictions, one per token Google refused — the replay's included. The
    // ATTEMPT count is what "exactly once" is about, and it is still two.
    expect(readToken.invalidate).toHaveBeenCalledTimes(2);
  });

  it('does not replay when gog reported invalid_grant — only a human can fix that', async () => {
    // The stderr deliberately matches BOTH shapes, so this pins the exclusion
    // rather than the absence of a 401.
    const fetchMock = vi.fn(async () => gogFailed(`${GOOGLE_401_STDERR}\noauth2: "invalid_grant"`));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);

    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/invalid_grant/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).not.toHaveBeenCalled();
  });

  it('does not replay a call that supplied no token of ours', async () => {
    // Nothing was minted, so there is nothing to re-mint: gog used whatever
    // identity the backend volume holds, and only an operator can change that.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(READ, {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay when the token source cannot invalidate', async () => {
    // A bare `() => token` (the #230 direct-token wiring) has no cache behind
    // it, so replaying would re-send the identical rejected token.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const exec = makeFlyExecutor(ENDPOINT, KEY, () => 'ya29.direct');
    await expect(exec(READ, {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay when the cache no longer held the rejected token', async () => {
    // Another caller already refreshed it; the token we would send is the one
    // that is already in use, so a replay proves nothing.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh'], false);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
  });

  // A subcommand is only a leaf VERB some of the time. `gog tasks lists` is a
  // NAMESPACE — `lists list` reads, `lists create` writes — and the allow-list
  // is consulted with the namespace word, never the verb under it. So a
  // namespace word in the set hands the replay to every child it will ever
  // grow, including the ones that write.
  //
  // `tasks lists create <title> ...` is real in gog v0.34.1 today, and reachable
  // without any new gog: `gog_tasks_run({subcommand: 'lists', args: ['create',
  // 'A', 'B']})` assembles exactly this argv. It is variadic, so one invocation
  // makes N Google calls and a 401 on the second means the first already landed
  // — the precise double-apply the write rule exists to prevent.
  it('does not replay `tasks lists create`, a WRITE under a namespace-shaped word', async () => {
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(
      exec(['--json', '--color=never', '--no-input', 'tasks', 'lists', 'create', 'A', 'B'], {}),
    ).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The eviction still happens — it runs before the allow-list is consulted.
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
  });

  // The invariant the allow-list's comment states, pinned as behaviour so the
  // comment is no longer the only thing enforcing it. Every word here is a gog
  // NAMESPACE that already has, or can grow, a mutating child; none of them may
  // ever earn a replay, whichever verb follows.
  it.each([
    ['tasks', 'lists'],
    ['gmail', 'labels'],
    ['gmail', 'drafts'],
    ['gmail', 'filters'],
    ['gmail', 'sendas'],
    ['drive', 'permissions'],
    ['drive', 'revisions'],
    ['docs', 'comments'],
    ['docs', 'replies'],
  ])('never replays the namespace word %s %s, whatever verb follows it', async (service, namespace) => {
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(
      exec(['--json', '--color=never', '--no-input', service, namespace, 'create', 'x'], {}),
    ).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The eviction is unaffected: it runs before the allow-list is consulted.
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
  });

  // Symmetry with the rule the whole fix is built on: a token Google has
  // refused must not stay cached, and the very same 401 refused the replay's
  // token. This is NOT a round-trip saving — measured through the real chain
  // under a sustained non-invalid_grant refusal, a steady-state call costs two
  // /run round-trips either way, and this eviction adds a mint (2 rather than
  // 1) by emptying a cache the next call would have hit. What it buys is a
  // bound on how long a KNOWN-REFUSED token can be served: left cached it is
  // re-served for the rest of its nominal hour, and a write — which gets the
  // eviction and no replay — would be sent with it and fail on contact.
  it('evicts the replayed token too when Google refuses that one as well', async () => {
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/Google API error/);
    expect(readToken.invalidate.mock.calls).toEqual([['ya29.stale'], ['ya29.fresh']]);
  });

  // The other half of that rule, and the one that keeps this branch honest.
  //
  // A replay can fail without Google ever seeing the token: the Machine starts
  // draining between the two attempts, the client-side deadline fires, the
  // runner's own bearer is rotated mid-call. Evicting on THOSE would throw away
  // a token nothing has refused and — worse — emit `token.evicted` with
  // "Google rejected this access token", which is a lie about a service that
  // was never consulted. Misattributing a runner-side failure to Google is the
  // exact defect this branch exists to remove; re-introducing it in the log
  // would just move it from the user's screen to the operator's query.
  it('does not evict the replayed token when the replay never reached Google', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gogFailed(GOOGLE_401_STDERR))
      // The runner drains between the two attempts — a transport failure, not
      // a verdict on the freshly minted token.
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'gog-runner is shutting down', retryable: true }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    const err = await exec(READ, {}).catch((e: unknown) => e);
    // The replay's own error reaches the caller, and here that is the RIGHT
    // one to surface: "the runner is restarting, retry" is actionable, where
    // re-raising the superseded Google 401 would send the user off to
    // re-authorize an account that is fine.
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-retryable');
    // Only the token Google actually refused was dropped. `ya29.fresh` stays
    // cached: it is unproven, not refused, and the next call may well succeed
    // with it once the new Machine is up.
    expect(readToken.invalidate.mock.calls).toEqual([['ya29.stale']]);
  });

  // The mint is a first-class error surface on this branch, so the error it
  // raises has to reach the caller with the SAME specificity a gog-authored
  // invalid_grant gets: the 7-day Testing-mode cause and the headless re-auth
  // pair. It only does if the message carries the literal `invalid_grant`,
  // which is what tools/utils.ts keys the richer hint on.
  it('gives a mint-path invalid_grant the full re-auth guidance, not the generic hint', async () => {
    vi.stubEnv('GOG_ACCOUNT', '');
    vi.stubEnv('GOG_READONLY', '');
    clearAccessTokenCache();
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      return gogFailed('unreachable');
    });
    vi.stubGlobal('fetch', fetchMock);
    const executor = makeFlyExecutor(
      ENDPOINT,
      KEY,
      makeAccessTokenSource({
        GOG_CLIENT_ID: 'cid',
        GOG_CLIENT_SECRET: 'cs',
        GOG_REFRESH_TOKEN: 'rt-dead',
      }),
    );

    const result = await runExecutor.run({ executor }, () =>
      runOrDiagnose(['gmail', 'search', 'q'], {}),
    );
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    // Text unique to INVALID_GRANT_HINT — the durable fix. The generic
    // AUTH_HINT (which is what a message omitting `invalid_grant` earns) says
    // only "Authentication may have expired".
    expect(text).toContain('publish the OAuth consent screen to "In production"');
    expect(text).not.toContain('Authentication may have expired');
    clearAccessTokenCache();
  });

  it('does not replay a WRITE, but still evicts the token Google rejected', async () => {
    // The one case an automatic replay must never take. A `gog gmail send` that
    // failed AFTER the message went out would send it twice.
    //
    // The EVICTION is a different question, and the write rule must not answer
    // it. Refusing to evict is what leaves Google's rejected token in the cache
    // for the rest of its nominal hour, so every following call — write or read
    // — re-sends it and fails identically until the isolate is replaced. That
    // is DEFECT 2 itself, and it is the half a write path used to keep.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(WRITE, {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).toHaveBeenCalledWith('ya29.stale');
  });

  it('evicts for a READ whose subcommand is outside the allow-list', async () => {
    // `gog gmail labels list` arrives here as the subcommand `labels`, which is
    // deliberately not in READ_ONLY_SUBCOMMANDS (a later `labels create` would
    // inherit the replay). Costing that call its replay is the intended price;
    // costing it the eviction would poison every call after it.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(
      exec(['--json', '--color=never', '--no-input', 'gmail', 'labels', 'list'], {}),
    ).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
  });

  it('lets a second WRITE mint a fresh token, through the REAL token source', async () => {
    // The incident, reproduced end to end with nothing stubbed but the network:
    // two consecutive `gog gmail send` calls after Google has rejected the
    // cached token. Before the eviction was moved ahead of the write rule, BOTH
    // shipped `ya29.t1` and both failed, for up to ~58 minutes, and only a
    // reconnect helped.
    clearAccessTokenCache();
    let minted = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(
          JSON.stringify({ access_token: `ya29.t${(minted += 1)}`, expires_in: 3600 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return gogFailed(GOOGLE_401_STDERR);
    });
    vi.stubGlobal('fetch', fetchMock);

    const exec = makeFlyExecutor(
      ENDPOINT,
      KEY,
      makeAccessTokenSource({
        GOG_CLIENT_ID: 'cid',
        GOG_CLIENT_SECRET: 'cs',
        GOG_REFRESH_TOKEN: 'rt-1',
      }),
    );
    await expect(exec(WRITE, {})).rejects.toThrow(/Google API error/);
    await expect(exec(WRITE, {})).rejects.toThrow(/Google API error/);

    const runBodies = fetchMock.mock.calls
      .filter(([url]) => !String(url).includes('oauth2.googleapis.com'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string) as { accessToken: string });
    expect(runBodies.map((b) => b.accessToken)).toEqual(['ya29.t1', 'ya29.t2']);
    clearAccessTokenCache();
  });

  it('replays with what is LEFT of the deadline, not a second full one', async () => {
    // 30s default + 5s grace is one tool call's whole budget. Handing the
    // replay a fresh copy of it makes the worst case ~70s of wall clock, which
    // can outlast the MCP client's own request timeout and turn a self-healing
    // read into a client-side hang.
    const budgets: number[] = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      budgets.push(ms);
      return realTimeout(ms);
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gogFailed(GOOGLE_401_STDERR))
      .mockResolvedValueOnce(ok('threads'));
    vi.stubGlobal('fetch', fetchMock);
    const base = Date.now();
    // The clock is read once to fix the deadline, then once more to size the
    // replay; 5s of the budget is gone by then.
    vi.spyOn(Date, 'now').mockReturnValueOnce(base).mockReturnValue(base + 5_000);

    const exec = makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale', 'ya29.fresh']));
    await expect(exec(READ, {})).resolves.toBe('threads');
    expect(budgets).toEqual([35_000, 30_000]);
  });

  it('skips the replay when the first attempt used the whole deadline', async () => {
    // With no budget left, a replay can only end in an abort, and that
    // TimeoutError would REPLACE gog's own 401 — trading an actionable error
    // for an opaque one. The eviction is the durable half of the repair and it
    // has already happened, so the caller's own next call is the fresh one.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const base = Date.now();
    vi.spyOn(Date, 'now').mockReturnValueOnce(base).mockReturnValue(base + 34_900);

    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).toHaveBeenCalledTimes(1);
  });

  it('finds the subcommand past --account, whose value is not a subcommand', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gogFailed(GOOGLE_401_STDERR))
      .mockResolvedValueOnce(ok('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(
      exec(['--json', '--color=never', '--no-input', '--account', 'me@example.com', 'drive', 'ls'], {}),
    ).resolves.toBe('[]');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay an invocation with no subcommand to judge', async () => {
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(['--json', '--color=never', 'gmail'], {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads gog stderr, not the command line the runner echoed back', async () => {
    // execFile's message embeds the whole argv, so a caller's own text lands in
    // `error`. Classifying on that would let `--subject "invoice 401"` trigger a
    // replay of a call that failed for an unrelated reason — and if that call
    // were a write, replay it after it had partly applied.
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Command failed: gog gmail search "Google API error (401 authError)"\nno results',
        stderr: 'no results',
        retryable: false,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/no results/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).not.toHaveBeenCalled();
  });

  it('does not replay a gog failure that has nothing to do with auth', async () => {
    const fetchMock = vi.fn(async () => gogFailed('invalid attachment id'));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/invalid attachment id/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the original failure when the re-mint yields no token', async () => {
    // Sending the request without a token would run it as the BACKEND's
    // identity and hand this caller someone else's mailbox — never that.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', undefined]);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/Google API error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the re-mint failure, which is the more actionable one', async () => {
    // Evicting revealed that the refresh token is dead too. That message names
    // the real repair (re-authorize); gog's 401 does not.
    const fetchMock = vi.fn(async () => gogFailed(GOOGLE_401_STDERR));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = Object.assign(
      vi
        .fn<() => Promise<string | undefined>>()
        .mockResolvedValueOnce('ya29.stale')
        .mockRejectedValueOnce(new Error('the stored refresh token has expired or been revoked')),
      { invalidate: vi.fn(async () => true) },
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    await expect(exec(READ, {})).rejects.toThrow(/refresh token has expired or been revoked/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never re-mints for the RUNNER\'s own 401, which never reached Google', async () => {
    // The defect-1 failure. Its body is the bare word "unauthorized" and no
    // Google credential was even read, so minting a new one is pure waste — and
    // replaying would double every call during a key mismatch.
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const readToken = source(['ya29.stale', 'ya29.fresh']);
    const exec = makeFlyExecutor(ENDPOINT, KEY, readToken);
    const err = await exec(READ, {}).catch((e: unknown) => e);
    expect(isRunnerTransportError(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken.invalidate).not.toHaveBeenCalled();
  });

  // End to end through the REAL run() and the REAL diagnose(): the user-visible
  // property is that a stale access token produces no error and no advice at
  // all, because it healed itself.
  it('turns a stale-token failure into a plain success, with no re-auth advice', async () => {
    vi.stubEnv('GOG_ACCOUNT', '');
    vi.stubEnv('GOG_READONLY', '');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gogFailed(GOOGLE_401_STDERR))
      .mockResolvedValueOnce(ok('{"threads":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    const executor = makeFlyExecutor(ENDPOINT, KEY, source(['ya29.stale', 'ya29.fresh']));

    const result = await runExecutor.run({ executor }, () =>
      runOrDiagnose(['gmail', 'search', 'q'], {}),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('{"threads":[]}');
  });
});
