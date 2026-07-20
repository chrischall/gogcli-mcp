import { describe, it, expect, vi, afterEach } from 'vitest';
import { run } from '../src/runner.js';
import type { GogExecutor } from '../src/runner.js';
import { makeFlyExecutor, wrapServer } from '../src/connector-runtime.js';

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
