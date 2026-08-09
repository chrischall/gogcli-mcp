import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRemoteGogRunner } from '../src/remote-runner.js';
import { run, runBinary, runExecutor, setDefaultGogExecutor } from '../src/runner.js';

/**
 * The whole point of this seam is that a host without the `gog` binary can
 * still serve. Every way it has silently failed so far: a half-configured env
 * that falls back to spawning; a bin that never calls `useRemoteGogRunner()`;
 * and — the one that shipped in 2.19.x — parking the executor in an
 * AsyncLocalStorage that the tool calls never inherit, so the seam reported
 * success and then spawned anyway.
 *
 * They share a shape worth naming: every one of them fails by falling back to
 * the local binary, which on a laptop is invisible and on a host is total. So
 * these tests assert on where a call ACTUALLY went, never on whether the wiring
 * step was performed.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // The executor is process-wide BY DESIGN now, so unlike an ALS store it does
  // not unwind when a test ends — without this, the first test to install one
  // would silently hand it to every test that ran after it.
  setDefaultGogExecutor(undefined);
});

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

  it('addresses and authenticates the backend correctly', async () => {
    // Asserted THROUGH run(), not by reading whichever slot the executor is
    // parked in. The previous version of this test fetched
    // `runExecutor.getStore()` and called what it found, so it was really a
    // test that `enterWith` had been called — which stayed green while the
    // shipped bins routed every call to a local binary (see the next test).
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stdout: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GOG_PATH', '/nonexistent/gog');

    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test/', GOG_RUNNER_KEY: 'secret' })).toBe(true);

    // Cross a macrotask boundary, the way a stdio tool call does.
    await new Promise((r) => setTimeout(r, 0));
    expect(await run(['--version'])).toBe('ok');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Trailing slash trimmed, so the endpoint is never `…//run`.
    expect(url).toBe('https://r.test/run');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('still routes remotely from a context the store never reached', async () => {
    // THE ONE THE TEST ABOVE CANNOT CATCH, and it shipped broken.
    //
    // `enterWith` mutates the store of the async resource that is current when
    // it runs. The test above calls useRemoteGogRunner() itself, so everything
    // it awaits afterwards is a descendant of that resource and inherits the
    // store — it passes whether or not the seam works where it matters.
    //
    // A bin does something different: it calls useRemoteGogRunner() while the
    // ES module is evaluating, and then `await runMcp(...)` starts serving. The
    // tool calls arrive later as I/O events on the transport's own async
    // resources, which are NOT descendants of module evaluation, so
    // `getStore()` is undefined by the time `run()` asks. Verified against the
    // published 2.19.1 bin: `useRemoteGogRunner()` returned true, and at call
    // time the store was undefined — every hosted gog MCP answered
    // "gog executable not found" while pointed at a healthy backend.
    //
    // `runExecutor.exit()` is that condition exactly, and deterministically:
    // run the call where the ALS store does not apply.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stdout: 'remote' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // So the spawn fallback cannot accidentally succeed on a machine that has
    // gog installed and make this pass for the wrong reason.
    vi.stubEnv('GOG_PATH', '/nonexistent/gog');

    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: 'secret' })).toBe(true);

    const output = await runExecutor.exit(() => run(['auth', 'status']));
    expect(output).toBe('remote');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards its own GOG_ACCESS_TOKEN so a hosted gog acts as its caller', async () => {
    // Under mcp-host's perUserChild, THIS PROCESS belongs to one caller and
    // holds their token (#230). The backend has one Google identity on its
    // volume, so without forwarding, every caller of a hosted gog acts as
    // whoever seeded it.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stdout: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GOG_PATH', '/nonexistent/gog');

    expect(
      useRemoteGogRunner({
        GOG_RUNNER_URL: 'https://r.test',
        GOG_RUNNER_KEY: 'secret',
        GOG_ACCESS_TOKEN: 'ya29.the-caller',
      }),
    ).toBe(true);

    await runExecutor.exit(() => run(['auth', 'status']));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).accessToken).toBe('ya29.the-caller');
  });

  it('sends no token when the caller has not supplied one', async () => {
    // Absent, not empty: the backend distinguishes "act as this caller" from
    // "act as the box", and every registration that predates per-caller auth is
    // the second case.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stdout: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GOG_PATH', '/nonexistent/gog');

    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: 'secret' })).toBe(true);

    await runExecutor.exit(() => run(['auth', 'status']));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The KEY must be absent, not present-and-empty. Asserted on its own rather
    // than by matching the whole body: `assembleArgs` folds in ambient settings
    // like GOG_ACCOUNT, so a whole-body match passes or fails depending on the
    // developer's shell.
    expect(JSON.parse(init.body as string)).not.toHaveProperty('accessToken');
  });

  it('lets a per-request store beat the process-wide default', async () => {
    // The Worker path scopes every request in `runExecutor.run({ executor })`
    // because one isolate serves many callers (connector-runtime.ts). A
    // process-wide default must never shadow that: it is the fallback for a
    // stdio bin, not a second answer to "whose backend is this".
    const perRequest = vi.fn(async () => 'per-request');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stdout: 'default' }), { status: 200 })));
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: 'secret' })).toBe(true);

    const output = await runExecutor.run({ executor: perRequest }, () => run(['auth', 'status']));
    expect(output).toBe('per-request');
    expect(perRequest).toHaveBeenCalledTimes(1);
  });

  it('still refuses binary retrieval when the default is a remote executor', async () => {
    // runBinary's guard asks the same question ("is a text-only forward
    // installed?") and must read the same answer, or a hosted bin would fall
    // through to spawning for bytes while every text call went remote.
    vi.stubEnv('GOG_PATH', '/nonexistent/gog');
    expect(useRemoteGogRunner({ GOG_RUNNER_URL: 'https://r.test', GOG_RUNNER_KEY: 'secret' })).toBe(true);

    await expect(runExecutor.exit(() => runBinary(['drive', 'read']))).rejects.toThrow(/text-only/);
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
