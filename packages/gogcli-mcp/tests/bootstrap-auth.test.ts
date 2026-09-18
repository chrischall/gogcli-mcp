import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { bootstrapGogAuth, AUTH_BOOTSTRAP_MARKER } from '../src/bootstrap-auth.js';
import type { Spawner } from '../src/runner.js';

const FULL = {
  GOG_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOG_CLIENT_SECRET: 'GOCSPX-client-secret-value',
  GOG_REFRESH_TOKEN: '1//refresh-token-value',
  GOG_ACCOUNT: 'someone@example.com',
};

function fingerprint(env: typeof FULL): string {
  return createHash('sha256')
    .update([env.GOG_CLIENT_ID, env.GOG_CLIENT_SECRET, env.GOG_REFRESH_TOKEN, env.GOG_ACCOUNT].join('\0'))
    .digest('hex');
}

interface Call {
  argv: string[];
  env: NodeJS.ProcessEnv;
  /** Contents of every temp-file path in argv, read while the child "runs". */
  files: string[];
}

type Reply = { code: number; stdout?: string; stderr?: string } | { error: Error };

function makeSpawner(reply: (argv: string[]) => Reply): { spawner: Spawner; calls: Call[] } {
  const calls: Call[] = [];
  const spawner = vi.fn((_cmd: string, argv: string[], opts: { env: NodeJS.ProcessEnv }) => {
    const files = argv.filter((a) => a.includes('gogcli-mcp-') && existsSync(a)).map((p) => readFileSync(p, 'utf8'));
    calls.push({ argv, env: opts.env, files });
    const proc = new EventEmitter() as ReturnType<Spawner>;
    const io = proc as unknown as { stdout: EventEmitter; stderr: EventEmitter };
    io.stdout = new EventEmitter();
    io.stderr = new EventEmitter();
    proc.kill = vi.fn();
    const r = reply(argv);
    setTimeout(() => {
      if ('error' in r) {
        proc.emit('error', r.error);
        return;
      }
      if (r.stdout) io.stdout.emit('data', Buffer.from(r.stdout));
      if (r.stderr) io.stderr.emit('data', Buffer.from(r.stderr));
      proc.emit('close', r.code);
    }, 0);
    return proc;
  }) as unknown as Spawner;
  return { spawner, calls };
}

const listing = (...emails: string[]): string => JSON.stringify({ accounts: emails.map((email) => ({ email })) });

const isList = (argv: string[]): boolean => argv.includes('list');

describe('bootstrapGogAuth', () => {
  let home: string;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bootstrap-auth-test-'));
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    rmSync(home, { recursive: true, force: true });
  });

  const stderrText = (): string => stderr.mock.calls.map((c: unknown[]) => String(c[0])).join('');

  it('does nothing when none of the variables is set', async () => {
    const { spawner, calls } = makeSpawner(() => ({ code: 0 }));
    const status = await bootstrapGogAuth({}, { spawner, home });
    expect(status).toBe('unconfigured');
    expect(calls).toHaveLength(0);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('treats blank and unresolved-placeholder values as unset', async () => {
    const { spawner, calls } = makeSpawner(() => ({ code: 0 }));
    const status = await bootstrapGogAuth(
      { GOG_CLIENT_ID: '', GOG_CLIENT_SECRET: '${user_config.secret}', GOG_REFRESH_TOKEN: 'undefined', GOG_ACCOUNT: '  ' },
      { spawner, home },
    );
    expect(status).toBe('unconfigured');
    expect(calls).toHaveLength(0);
  });

  it('names the missing variables, and never a value, when only some are set', async () => {
    const { spawner, calls } = makeSpawner(() => ({ code: 0 }));
    const status = await bootstrapGogAuth(
      { GOG_CLIENT_ID: FULL.GOG_CLIENT_ID, GOG_REFRESH_TOKEN: FULL.GOG_REFRESH_TOKEN },
      { spawner, home },
    );
    expect(status).toBe('incomplete');
    expect(calls).toHaveLength(0);
    const out = stderrText();
    expect(out).toContain('GOG_CLIENT_SECRET');
    expect(out).toContain('GOG_ACCOUNT');
    expect(out).not.toContain(FULL.GOG_CLIENT_ID);
    expect(out).not.toContain(FULL.GOG_REFRESH_TOKEN);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('imports credentials then the token, only via temp files, and writes a private marker', async () => {
    const { spawner, calls } = makeSpawner(() => ({ code: 0, stdout: '{}' }));
    const status = await bootstrapGogAuth({ ...FULL }, { spawner, home });
    expect(status).toBe('imported');
    expect(calls).toHaveLength(2);

    const [creds, tokens] = calls;
    expect(creds.argv).toEqual(expect.arrayContaining(['auth', 'credentials', 'set']));
    expect(JSON.parse(creds.files[0])).toEqual({
      installed: { client_id: FULL.GOG_CLIENT_ID, client_secret: FULL.GOG_CLIENT_SECRET },
    });
    expect(tokens.argv).toEqual(expect.arrayContaining(['auth', 'tokens', 'import']));
    expect(JSON.parse(tokens.files[0])).toEqual({ email: FULL.GOG_ACCOUNT, refresh_token: FULL.GOG_REFRESH_TOKEN });

    // The temp file is the LAST argv element: the positional <path> gog reads.
    for (const call of calls) {
      expect(call.files).toHaveLength(1);
      expect(existsSync(call.argv[call.argv.length - 1])).toBe(false); // cleaned up afterwards
      const argvText = call.argv.join(' ');
      expect(argvText).not.toContain(FULL.GOG_CLIENT_SECRET);
      expect(argvText).not.toContain(FULL.GOG_REFRESH_TOKEN);
      const envText = JSON.stringify(call.env);
      expect(envText).not.toContain(FULL.GOG_CLIENT_SECRET);
      expect(envText).not.toContain(FULL.GOG_REFRESH_TOKEN);
    }

    const markerDir = join(home, '.gogcli-mcp');
    const marker = join(markerDir, AUTH_BOOTSTRAP_MARKER);
    expect(readFileSync(marker, 'utf8')).toBe(fingerprint(FULL));
    expect(statSync(markerDir).mode & 0o777).toBe(0o700);
    expect(statSync(marker).mode & 0o777).toBe(0o600);
  });

  it('reports present and does nothing when the marker matches and gog lists the account', async () => {
    mkdirSync(join(home, '.gogcli-mcp'));
    writeFileSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER), fingerprint(FULL));
    const { spawner, calls } = makeSpawner(() => ({ code: 0, stdout: listing('other@example.com', 'SomeOne@Example.com') }));
    const status = await bootstrapGogAuth({ ...FULL }, { spawner, home });
    expect(status).toBe('present');
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(expect.arrayContaining(['auth', 'list']));
  });

  it('re-imports when the marker matches but gog no longer lists the account', async () => {
    mkdirSync(join(home, '.gogcli-mcp'));
    writeFileSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER), fingerprint(FULL));
    const { spawner, calls } = makeSpawner((argv) => ({ code: 0, stdout: isList(argv) ? listing('other@example.com') : '{}' }));
    expect(await bootstrapGogAuth({ ...FULL }, { spawner, home })).toBe('imported');
    expect(calls.map((c) => c.argv.includes('list'))).toEqual([true, false, false]);
  });

  it.each([
    ['an unparseable listing', { code: 0, stdout: 'not json' }],
    ['a listing without accounts', { code: 0, stdout: '{"accounts":null}' }],
    ['a listing whose entries carry no email', { code: 0, stdout: '{"accounts":[{}]}' }],
    ['a failing listing', { code: 1, stderr: 'keyring locked' }],
  ])('re-imports when the marker matches but gog returns %s', async (_label, listReply) => {
    mkdirSync(join(home, '.gogcli-mcp'));
    writeFileSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER), fingerprint(FULL));
    const { spawner, calls } = makeSpawner((argv) => (isList(argv) ? listReply : { code: 0, stdout: '{}' }));
    expect(await bootstrapGogAuth({ ...FULL }, { spawner, home })).toBe('imported');
    expect(calls).toHaveLength(3);
  });

  it('re-imports without listing when the secret was rotated (marker differs)', async () => {
    mkdirSync(join(home, '.gogcli-mcp'));
    writeFileSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER), 'stale-fingerprint');
    const { spawner, calls } = makeSpawner(() => ({ code: 0, stdout: '{}' }));
    expect(await bootstrapGogAuth({ ...FULL }, { spawner, home })).toBe('imported');
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.argv.includes('list'))).toBe(false);
    expect(readFileSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER), 'utf8')).toBe(fingerprint(FULL));
  });

  it('fails without throwing, redacts, and writes no marker when gog rejects the import', async () => {
    const { spawner } = makeSpawner((argv) =>
      argv.includes('tokens')
        ? { code: 1, stderr: `bad token ${FULL.GOG_REFRESH_TOKEN} for secret ${FULL.GOG_CLIENT_SECRET}` }
        : { code: 0, stdout: '{}' },
    );
    expect(await bootstrapGogAuth({ ...FULL }, { spawner, home })).toBe('failed');
    const out = stderrText();
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(out).toContain('bad token');
    expect(out).not.toContain(FULL.GOG_REFRESH_TOKEN);
    expect(out).not.toContain(FULL.GOG_CLIENT_SECRET);
    expect(existsSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER))).toBe(false);
  });

  it('fails without throwing when gog is not installed', async () => {
    const enoent = Object.assign(new Error('spawn gog ENOENT'), { code: 'ENOENT' });
    const { spawner } = makeSpawner(() => ({ error: enoent }));
    expect(await bootstrapGogAuth({ ...FULL }, { spawner, home })).toBe('failed');
    expect(stderrText()).toContain('gog executable not found');
  });

  it('fails without throwing when the marker cannot be written', async () => {
    writeFileSync(join(home, '.gogcli-mcp'), 'a file where the directory should be');
    const { spawner } = makeSpawner(() => ({ code: 0, stdout: '{}' }));
    expect(await bootstrapGogAuth({ ...FULL }, { spawner, home })).toBe('failed');
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('stringifies a non-Error failure', async () => {
    const throwing = vi.fn(() => {
      throw 'plain string failure';
    }) as unknown as Spawner;
    expect(await bootstrapGogAuth({ ...FULL }, { spawner: throwing, home })).toBe('failed');
    expect(stderrText()).toContain('plain string failure');
  });

  it('puts the marker under the OS home directory by default', async () => {
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const { spawner } = makeSpawner(() => ({ code: 0, stdout: '{}' }));
      expect(await bootstrapGogAuth({ ...FULL }, { spawner })).toBe('imported');
      expect(readFileSync(join(home, '.gogcli-mcp', AUTH_BOOTSTRAP_MARKER), 'utf8')).toBe(fingerprint(FULL));
    } finally {
      process.env.HOME = savedHome;
    }
  });

  it('defaults to process.env', async () => {
    // With none of the four variables set the default path is a no-op, so this
    // proves the defaults are wired without touching the real home directory.
    const saved = Object.fromEntries(Object.keys(FULL).map((k) => [k, process.env[k]]));
    for (const k of Object.keys(FULL)) delete process.env[k];
    try {
      expect(await bootstrapGogAuth()).toBe('unconfigured');
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  });
});
