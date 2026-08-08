import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('treats blanks, placeholders and stringified nothings as unset', () => {
    // MCP hosts pass env blocks through verbatim, so all three of these arrive
    // in practice: a blank, a literal `${...}` that never expanded, and the
    // string "undefined" from a host that stringified a missing value. The
    // shared readEnvVar knows all three; a hand-rolled trim knew only the first
    // two, which is why this uses the shared one.
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: '  ', GOG_RUNNER_KEY: 'k' })).toBe(false);
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: '${GOG_RUNNER_KEY}' })).toBe(false);
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: 'undefined' })).toBe(false);
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'null', GOG_RUNNER_KEY: 'k' })).toBe(false);
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

    await store!.executor(['--version'], {});
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Trailing slash trimmed, so the endpoint is never `…//run`.
    expect(url).toBe('https://r.test/run');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });
});

/**
 * The seam is opt-in PER BIN — `useRemoteGogRunner()` is a call in each
 * package's `index.ts`, and a package that omits it spawns the binary no
 * matter what the host sets. That shipped: 2.19.0 wired base, sheets, docs,
 * drive and gmail, and left calendar, classroom, contacts and slides behind,
 * so those four answered every tool call on mcp-host with "gog executable not
 * found" — a host with no binary and no way to ask for the backend.
 *
 * Nothing caught it because each package's suite covers its TOOLS, and
 * `src/index.ts` is excluded from the coverage gate in every package (it is
 * the bin: it boots a server and cannot be imported under test). So this
 * asserts on the source text instead, across the whole workspace — the one
 * check that scales to the next sub-package, which will otherwise be added by
 * copying an index.ts that predates the seam.
 */
describe('every package bin', () => {
  const packagesDir = fileURLToPath(new URL('../../', import.meta.url));
  const bins = readdirSync(packagesDir)
    .filter((name) => name.startsWith('gogcli-mcp'))
    .map((name) => [name, join(packagesDir, name, 'src', 'index.ts')] as const);

  it('finds every package (guards the glob itself against silently matching nothing)', () => {
    expect(bins.length).toBeGreaterThanOrEqual(9);
  });

  it.each(bins)('%s installs the remote executor before starting the server', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('useRemoteGogRunner()');
    // Order matters as much as presence: `runMcp` starts serving, so a call
    // placed after it could be beaten by a tool call and fall back to spawning.
    expect(source.indexOf('useRemoteGogRunner()')).toBeLessThan(source.indexOf('runMcp({'));
  });
});
