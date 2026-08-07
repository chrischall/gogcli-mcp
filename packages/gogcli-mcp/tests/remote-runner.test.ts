import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRemoteGogRunner } from '../src/remote-runner.js';
import { runExecutor } from '../src/runner.js';

/**
 * The whole point of this seam is that a host without the `gog` binary can
 * still serve. Two ways it silently fails: a half-configured env that falls
 * back to spawning, and using `run()` instead of `enterWith()` so the store is
 * gone by the time a tool call arrives.
 */

afterEach(() => vi.unstubAllGlobals());

describe('useRemoteGogRunner', () => {
  it('does nothing unless BOTH variables are set, so local installs are untouched', () => {
    expect(useRemoteGogRunner({})).toBe(false);
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test' })).toBe(false);
    expect(useRemoteGogRunner({ GOG_RUNNER_KEY: 'k' })).toBe(false);
  });

  it('treats blank and unexpanded placeholders as unset', () => {
    // MCP hosts pass env blocks through verbatim; `${GOG_RUNNER_KEY}` arriving
    // literally must not be mistaken for a credential.
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: '  ', GOG_RUNNER_KEY: 'k' })).toBe(false);
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: '${GOG_RUNNER_KEY}' })).toBe(false);
  });

  it('installs an executor that survives into a LATER async callback', async () => {
    // The real failure mode this guards: with `run()` the store would be gone
    // by the time a tool call arrives as an I/O callback, and the server would
    // quietly go back to spawning a binary that is not installed.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stdout: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test/', GOG_RUNNER_KEY: 'secret' })).toBe(true);

    // Cross a macrotask boundary, the way a stdio tool call does.
    await new Promise((r) => setTimeout(r, 0));
    const store = runExecutor.getStore();
    expect(store?.executor).toBeTypeOf('function');

    await store!.executor([['--version']] as never, {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Trailing slash trimmed, so the endpoint is never `…//run`.
    expect(url).toBe('https://r.test/run');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });
});
