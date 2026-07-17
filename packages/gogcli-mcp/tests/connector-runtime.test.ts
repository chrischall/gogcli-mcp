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

    expect(fetchMock).toHaveBeenCalledWith('https://runner.example/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: ['sheets', 'get', 'A1'] }),
    });
  });

  it('throws the backend error message on a non-2xx with a body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => ({ error: 'gog exited with code 1' }),
      })),
    );
    const exec = makeFlyExecutor(ENDPOINT, KEY);
    await expect(exec(['bogus'], {})).rejects.toThrow('gog exited with code 1');
  });

  it('falls back to an HTTP-status message when the error body is unreadable', async () => {
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
    await expect(exec(['x'], {})).rejects.toThrow('gog-runner HTTP 503');
  });
});
