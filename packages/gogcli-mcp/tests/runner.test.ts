import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn as mockedSpawn } from 'node:child_process';
import { run, runBinary, runExecutor, RunnerTransportError, isRunnerTransportError } from '../src/runner.js';
import type { Spawner, GogExecutor } from '../src/runner.js';

// The real spawn is dynamically imported inside runner's default executor.
// Mock it so the no-spawner/no-executor fallback can be exercised without
// touching a real `gog` binary.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function makeProc(exitCode: number, stdout = '', stderr = ''): ReturnType<Spawner> {
  const proc = new EventEmitter() as ReturnType<Spawner>;
  (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
  (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
  setTimeout(() => {
    (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
    (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  }, 0);
  return proc;
}

function makeSpawner(exitCode: number, stdout = '', stderr = ''): Spawner {
  return vi.fn(() => makeProc(exitCode, stdout, stderr)) as unknown as Spawner;
}

describe('run', () => {
  it('passes --json --color=never --no-input before service args', async () => {
    const spawner = makeSpawner(0, '{"ok":true}');
    await run(['sheets', 'get', 'id1', 'A1'], { spawner });
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--color=never', '--no-input', 'sheets', 'get', 'id1', 'A1'],
      expect.objectContaining({ env: expect.any(Object) }),
    );
  });

  it('injects --account from options.account', async () => {
    const spawner = makeSpawner(0, '{}');
    await run(['sheets', 'metadata', 'id1'], { account: 'me@gmail.com', spawner });
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--color=never', '--no-input', '--account', 'me@gmail.com', 'sheets', 'metadata', 'id1'],
      expect.any(Object),
    );
  });

  it('injects --account from GOG_ACCOUNT env var when no options.account', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    process.env.GOG_ACCOUNT = 'env@gmail.com';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      expect(spawner).toHaveBeenCalledWith(
        'gog',
        ['--json', '--color=never', '--no-input', '--account', 'env@gmail.com', 'sheets', 'metadata', 'id1'],
        expect.any(Object),
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_ACCOUNT;
      } else {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('options.account takes precedence over GOG_ACCOUNT env var', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    process.env.GOG_ACCOUNT = 'env@gmail.com';
    try {
      await run(['sheets', 'metadata', 'id1'], { account: 'override@gmail.com', spawner });
      expect(spawner).toHaveBeenCalledWith(
        'gog',
        ['--json', '--color=never', '--no-input', '--account', 'override@gmail.com', 'sheets', 'metadata', 'id1'],
        expect.any(Object),
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_ACCOUNT;
      } else {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('omits --account when neither options.account nor GOG_ACCOUNT is set', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    delete process.env.GOG_ACCOUNT;
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(callArgs).not.toContain('--account');
    } finally {
      if (originalEnv !== undefined) {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('uses GOG_PATH env var as the executable when set', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_PATH;
    process.env.GOG_PATH = '/usr/local/bin/gog';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      expect(spawner).toHaveBeenCalledWith(
        '/usr/local/bin/gog',
        expect.any(Array),
        expect.any(Object),
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_PATH;
      } else {
        process.env.GOG_PATH = originalEnv;
      }
    }
  });

  it('falls back to "gog" on PATH when GOG_PATH is unset', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_PATH;
    delete process.env.GOG_PATH;
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      expect(spawner).toHaveBeenCalledWith('gog', expect.any(Array), expect.any(Object));
    } finally {
      if (originalEnv !== undefined) {
        process.env.GOG_PATH = originalEnv;
      }
    }
  });

  it('falls back to "gog" on PATH when GOG_PATH is set to empty string', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_PATH;
    process.env.GOG_PATH = '';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      expect(spawner).toHaveBeenCalledWith('gog', expect.any(Array), expect.any(Object));
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_PATH;
      } else {
        process.env.GOG_PATH = originalEnv;
      }
    }
  });

  it('falls back to "gog" on PATH when GOG_PATH is an unresolved .mcpb placeholder', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_PATH;
    process.env.GOG_PATH = '${user_config.gog_path}';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      expect(spawner).toHaveBeenCalledWith('gog', expect.any(Array), expect.any(Object));
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_PATH;
      } else {
        process.env.GOG_PATH = originalEnv;
      }
    }
  });

  it('omits --account when GOG_ACCOUNT is an unresolved .mcpb placeholder', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalEnv = process.env.GOG_ACCOUNT;
    process.env.GOG_ACCOUNT = '${user_config.gog_account}';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(callArgs).not.toContain('--account');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GOG_ACCOUNT;
      } else {
        process.env.GOG_ACCOUNT = originalEnv;
      }
    }
  });

  it('returns stdout on exit code 0', async () => {
    const spawner = makeSpawner(0, '{"values":[["hello"]]}');
    const result = await run(['sheets', 'get', 'id1', 'A1'], { spawner });
    expect(result).toBe('{"values":[["hello"]]}');
  });

  it('throws with stderr message on non-zero exit', async () => {
    const spawner = makeSpawner(1, '', 'Spreadsheet not found');
    await expect(run(['sheets', 'get', 'bad', 'A1'], { spawner }))
      .rejects.toThrow('Spreadsheet not found');
  });

  it('throws with fallback message when stderr is empty on non-zero exit', async () => {
    const spawner = makeSpawner(2, '', '');
    await expect(run(['sheets', 'get', 'bad', 'A1'], { spawner }))
      .rejects.toThrow('gog exited with code 2');
  });

  it('surfaces a non-Error throw instead of masking it with a TypeError', async () => {
    // A custom executor that throws a string used to reach `(err as Error).message`
    // -> undefined -> redact(undefined) -> TypeError, hiding the real cause.
    const spawner = vi.fn(() => { throw 'gog binary vanished'; }) as unknown as Spawner;
    await expect(run(['sheets', 'get', 'x', 'A1'], { spawner }))
      .rejects.toThrow('gog binary vanished');
  });

  it('rejects on spawn error', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => proc.emit('error', new Error('gog not found')), 0);
      return proc;
    }) as unknown as Spawner;
    await expect(run(['sheets', 'get', 'id', 'A1'], { spawner }))
      .rejects.toThrow('gog not found');
  });

  it('wraps ENOENT spawn errors with an install-or-set-GOG_PATH hint', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => {
        const err = new Error('spawn gog ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        proc.emit('error', err);
      }, 0);
      return proc;
    }) as unknown as Spawner;
    await expect(run(['sheets', 'get', 'id', 'A1'], { spawner }))
      .rejects.toThrow(/gog executable not found.*Install gogcli.*GOG_PATH/s);
  });

  it('augments child PATH with common gogcli install dirs', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    process.env.HOME = '/Users/test';
    process.env.PATH = '/usr/bin:/bin';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const passedEnv = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][2].env as NodeJS.ProcessEnv;
      const passedPath = passedEnv.PATH!;
      expect(passedPath).toContain('/usr/bin');
      expect(passedPath).toContain('/opt/homebrew/bin');
      expect(passedPath).toContain('/usr/local/bin');
      expect(passedPath).toContain('/Users/test/.local/bin');
      expect(passedPath).toContain('/Users/test/go/bin');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it('does not duplicate dirs that are already on PATH', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalPath = process.env.PATH;
    process.env.PATH = '/opt/homebrew/bin:/usr/bin';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const passedEnv = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][2].env as NodeJS.ProcessEnv;
      const passedPath = passedEnv.PATH!;
      const homebrewCount = passedPath.split(':').filter(d => d === '/opt/homebrew/bin').length;
      expect(homebrewCount).toBe(1);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it('augments PATH even when HOME is unset', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    delete process.env.HOME;
    process.env.PATH = '/usr/bin';
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const passedEnv = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][2].env as NodeJS.ProcessEnv;
      const passedPath = passedEnv.PATH!;
      expect(passedPath).toContain('/opt/homebrew/bin');
      expect(passedPath).not.toContain('.local/bin');
    } finally {
      if (originalHome !== undefined) process.env.HOME = originalHome;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it('handles empty PATH gracefully', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalPath = process.env.PATH;
    delete process.env.PATH;
    try {
      await run(['sheets', 'metadata', 'id1'], { spawner });
      const passedEnv = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][2].env as NodeJS.ProcessEnv;
      expect(passedEnv.PATH).toContain('/opt/homebrew/bin');
    } finally {
      if (originalPath !== undefined) process.env.PATH = originalPath;
    }
  });

  it('ignores close event if error event already settled the promise', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => {
        proc.emit('error', new Error('spawn error'));
        proc.emit('close', 0);
      }, 0);
      return proc;
    }) as unknown as Spawner;
    await expect(run(['sheets', 'get', 'id', 'A1'], { spawner }))
      .rejects.toThrow('spawn error');
  });

  it('ignores error event if close event already settled the promise', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => {
        (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"ok":true}'));
        proc.emit('close', 0);
        proc.emit('error', new Error('should be ignored'));
      }, 0);
      return proc;
    }) as unknown as Spawner;
    const result = await run(['sheets', 'get', 'id', 'A1'], { spawner });
    expect(result).toBe('{"ok":true}');
  });

  it('rejects with timeout error when gog does not respond', async () => {
    vi.useFakeTimers();
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }) as unknown as Spawner;

    const promise = run(['sheets', 'get', 'id', 'A1'], { spawner });
    vi.advanceTimersByTime(30_000);
    await expect(promise).rejects.toThrow('gog timed out after 30000ms');
    vi.useRealTimers();
  });

  it('clears timeout when close event fires before timeout', async () => {
    vi.useFakeTimers();
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      setTimeout(() => {
        (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"ok":true}'));
        proc.emit('close', 0);
      }, 5000);
      return proc;
    }) as unknown as Spawner;

    const promise = run(['sheets', 'get', 'id', 'A1'], { spawner });
    vi.advanceTimersByTime(5000);
    const result = await promise;
    expect(result).toBe('{"ok":true}');
    vi.useRealTimers();
  });

  it('omits --no-input when interactive is true', async () => {
    const spawner = makeSpawner(0, '{"ok":true}');
    await run(['auth', 'add', 'user@gmail.com'], { spawner, interactive: true });
    const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(callArgs).toContain('--json');
    expect(callArgs).toContain('--color=never');
    expect(callArgs).not.toContain('--no-input');
    expect(callArgs).toContain('auth');
  });

  it('includes --no-input when interactive is not set', async () => {
    const spawner = makeSpawner(0, '{"ok":true}');
    await run(['sheets', 'get', 'id1', 'A1'], { spawner });
    const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(callArgs).toContain('--no-input');
  });

  it('appends stderr to stdout on success when interactive is true', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => {
        (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"success":true}'));
        (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from('Opening browser...\nIf the browser doesn\'t open, visit this URL:\nhttps://accounts.google.com/auth?...'));
        proc.emit('close', 0);
      }, 0);
      return proc;
    }) as unknown as Spawner;

    const result = await run(['auth', 'add', 'user@gmail.com'], { spawner, interactive: true });
    expect(result).toContain('{"success":true}');
    expect(result).toContain('Opening browser...');
    expect(result).toContain('https://accounts.google.com/auth?...');
  });

  it('does not append stderr to stdout on success when interactive is false', async () => {
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      setTimeout(() => {
        (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"ok":true}'));
        (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from('some warning'));
        proc.emit('close', 0);
      }, 0);
      return proc;
    }) as unknown as Spawner;

    const result = await run(['sheets', 'get', 'id', 'A1'], { spawner });
    expect(result).toBe('{"ok":true}');
    expect(result).not.toContain('some warning');
  });

  it('uses custom timeout when provided', async () => {
    vi.useFakeTimers();
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }) as unknown as Spawner;

    const promise = run(['auth', 'add', 'user@gmail.com'], { spawner, timeout: 300_000 });
    // Should NOT have timed out at 30s
    vi.advanceTimersByTime(30_000);
    // Advance to custom timeout
    vi.advanceTimersByTime(270_000);
    await expect(promise).rejects.toThrow('gog timed out after 300000ms (5 minutes)');
    vi.useRealTimers();
  });

  it('includes human-readable duration in timeout error for default timeout', async () => {
    vi.useFakeTimers();
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }) as unknown as Spawner;

    const promise = run(['sheets', 'get', 'id', 'A1'], { spawner });
    vi.advanceTimersByTime(30_000);
    await expect(promise).rejects.toThrow('gog timed out after 30000ms');
    vi.useRealTimers();
  });

  it('formats 1-minute timeout as singular "minute" (not plural)', async () => {
    vi.useFakeTimers();
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    }) as unknown as Spawner;

    const promise = run(['docs', 'cat', 'id'], { spawner, timeout: 60_000 });
    vi.advanceTimersByTime(60_000);
    await expect(promise).rejects.toThrow('gog timed out after 60000ms (1 minute)');
    vi.useRealTimers();
  });

  it('strips GOG_ACCESS_TOKEN from child environment to force refresh-token auth', async () => {
    const spawner = makeSpawner(0, '{}');
    const originalToken = process.env.GOG_ACCESS_TOKEN;
    process.env.GOG_ACCESS_TOKEN = 'stale-token-from-mcp-config';
    try {
      await run(['docs', 'comments', 'list', 'docId'], { spawner });
      const envPassed = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][2].env as NodeJS.ProcessEnv;
      expect(envPassed.GOG_ACCESS_TOKEN).toBeUndefined();
    } finally {
      if (originalToken === undefined) {
        delete process.env.GOG_ACCESS_TOKEN;
      } else {
        process.env.GOG_ACCESS_TOKEN = originalToken;
      }
    }
  });

  it('strips GOOGLE_APPLICATION_CREDENTIALS and *_TOKEN/*_SECRET/*_API_KEY/*_PRIVATE_KEY vars', async () => {
    const spawner = makeSpawner(0, '{}');
    const snapshot = {
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DB_PASSWORD_TOKEN: process.env.DB_PASSWORD_TOKEN,
      AWS_SECRET: process.env.AWS_SECRET,
      MY_PRIVATE_KEY: process.env.MY_PRIVATE_KEY,
      BENIGN_VAR: process.env.BENIGN_VAR,
    };
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/sa.json';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    process.env.DB_PASSWORD_TOKEN = 'secret';
    process.env.AWS_SECRET = 'secret';
    process.env.MY_PRIVATE_KEY = 'secret';
    process.env.BENIGN_VAR = 'hello';
    try {
      await run(['docs', 'cat', 'id'], { spawner });
      const envPassed = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][2].env as NodeJS.ProcessEnv;
      expect(envPassed.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
      expect(envPassed.ANTHROPIC_API_KEY).toBeUndefined();
      expect(envPassed.DB_PASSWORD_TOKEN).toBeUndefined();
      expect(envPassed.AWS_SECRET).toBeUndefined();
      expect(envPassed.MY_PRIVATE_KEY).toBeUndefined();
      expect(envPassed.BENIGN_VAR).toBe('hello');
    } finally {
      for (const [k, v] of Object.entries(snapshot)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('redacts Bearer with quoted/encoded characters', async () => {
    const stderrLeak = 'http 401: header was Bearer eyJ.test+slash/equal=padding more text';
    const spawner = makeSpawner(1, '', stderrLeak);
    try {
      await run(['gmail', 'get', 'm1'], { spawner });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('eyJ.test+slash/equal=padding');
      expect(msg).toContain('[REDACTED]');
    }
  });

  it('redacts bearer/refresh tokens and Google API keys from stderr surfaced to the client', async () => {
    const stderrLeak = 'request failed: Authorization: Bearer ya29.a0Ad52N3-LEAKED-TOKEN-VALUE refresh 1//0eLEAKED-REFRESH key AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI extra';
    const spawner = makeSpawner(1, '', stderrLeak);
    try {
      await run(['gmail', 'get', 'm1'], { spawner });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('ya29.a0Ad52N3-LEAKED-TOKEN-VALUE');
      expect(msg).not.toContain('1//0eLEAKED-REFRESH');
      expect(msg).not.toContain('AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI');
      expect(msg).toContain('[REDACTED]');
    }
  });

  it('redacts Google tokens from SUCCESS stdout surfaced to the client', async () => {
    // A successful `gog auth ... ` that echoes credentials (e.g. a token dump)
    // must not leak them into model context on the resolve path.
    const stdoutLeak =
      '{"access_token":"ya29.a0Ad52N3-LEAKED-SUCCESS-TOKEN","refresh_token":"1//0eLEAKED-SUCCESS-REFRESH"}';
    const spawner = makeSpawner(0, stdoutLeak, '');
    const out = await run(['auth', 'list'], { spawner });
    expect(out).not.toContain('ya29.a0Ad52N3-LEAKED-SUCCESS-TOKEN');
    expect(out).not.toContain('1//0eLEAKED-SUCCESS-REFRESH');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts Google tokens from interactive SUCCESS stdout+stderr', async () => {
    const spawner = makeSpawner(0, 'token ya29.a0Ad52N3-INTERACTIVE-LEAK done', 'note line');
    const out = await run(['auth', 'add', 'x@y.com'], { spawner, interactive: true });
    expect(out).not.toContain('ya29.a0Ad52N3-INTERACTIVE-LEAK');
    expect(out).toContain('[REDACTED]');
  });

  it("redactMode 'tokens' preserves OAuth scope names the shared redactor mangles", async () => {
    // The shared redactor treats a `classroom.coursework.students` scope as a
    // secret and replaces it — corrupting a step-1 auth URL. 'tokens' mode must
    // leave scope names intact.
    const authUrl =
      'https://accounts.google.com/o/oauth2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fclassroom.coursework.students+openid&state=abc123';
    const spawner = makeSpawner(0, JSON.stringify({ auth_url: authUrl }), '');
    const full = await run(['auth', 'add'], { spawner });
    expect(full).toContain('[REDACTED]'); // full mode mangles the scope
    const spawner2 = makeSpawner(0, JSON.stringify({ auth_url: authUrl }), '');
    const tokensOnly = await run(['auth', 'add'], { spawner: spawner2, redactMode: 'tokens' });
    expect(tokensOnly).toContain('classroom.coursework.students');
    expect(tokensOnly).not.toContain('[REDACTED]');
  });

  // ==========================================================================
  // BASE64 PAYLOAD SURVIVAL — the "Invalid Base64 string" defect.
  //
  // `1//` is spelled entirely in the base64 alphabet, so the refresh-token
  // pattern used to match inside attachment bytes and eat forward to the next
  // `+` or `/`. A 72 KiB PNG is ~97k base64 chars, giving ~0.37 expected `1//`
  // runs — so roughly a THIRD of all attachments came back corrupt, and the
  // client rejected them with an MCP -32602 "Invalid Base64 string".
  //
  // It looked filename-dependent because it is content-dependent and therefore
  // uncorrelated with anything visible. These tests pin the real variable.
  // ==========================================================================
  const isValidBase64 = (s: string): boolean => Buffer.from(s, 'base64').toString('base64') === s;

  it('leaves a base64 payload containing the refresh-token spelling intact', async () => {
    // `1//` sitting mid-blob, preceded by base64 characters — the exact shape
    // that used to be deleted.
    const payload = `AAAA1//abcdefghijklmnop${'QRSTuvwx'.repeat(4)}`;
    expect(payload).toContain('1//');
    const spawner = makeSpawner(0, JSON.stringify({ contentBase64: payload }), '');
    const out = await run(['gmail', 'attachment', 'm1', '0'], { spawner });
    expect(JSON.parse(out).contentBase64).toBe(payload);
    expect(out).not.toContain('[REDACTED]');
  });

  it('keeps every generated attachment payload valid base64 (the ~30% failure)', async () => {
    // 200 payloads at the reported sizes. Before the fix ~30% of these came back
    // undecodable; the assertion is that ALL of them survive, not most.
    for (let i = 0; i < 200; i += 1) {
      const bytes = Buffer.alloc(4096);
      // Deterministic filler that still produces `1//` runs at the natural rate:
      // a counter-driven byte pattern, seeded differently per iteration.
      for (let b = 0; b < bytes.length; b += 1) bytes[b] = (b * 31 + i * 7) % 256;
      const payload = bytes.toString('base64');
      const spawner = makeSpawner(0, JSON.stringify({ contentBase64: payload }), '');
      const out = await run(['gmail', 'attachment', 'm1', '0'], { spawner });
      const got = JSON.parse(out).contentBase64 as string;
      expect(isValidBase64(got)).toBe(true);
      expect(got).toBe(payload);
    }
  });

  // The left-boundary anchor must not narrow detection. Every character NOT in
  // the standard base64 alphabet is a delimiter a real token turns up after, and
  // `=` is the one that matters most: the form-encoded spelling is not covered by
  // the shared redactor's query-param rule, which requires a preceding `?`/`&`.
  it.each([
    ['refresh_token=1//0eFORM-ENCODED-LEAK', '1//0eFORM-ENCODED-LEAK'],
    ['access_token=ya29.a0FORM-ENCODED-LEAK', 'ya29.a0FORM-ENCODED-LEAK'],
    ['grant:1//0eCOLON-LEAK', '1//0eCOLON-LEAK'],
    ['[1//0eBRACKET-LEAK]', '1//0eBRACKET-LEAK'],
    ['token is ya29.a0SPACE-LEAK', 'ya29.a0SPACE-LEAK'],
  ])('redacts a token delimited by %j', async (stdout, secret) => {
    const spawner = makeSpawner(0, stdout, '');
    const out = await run(['auth', 'list'], { spawner });
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  it("redactMode 'tokens' also catches the form-encoded spelling", async () => {
    // This path runs ONLY redactGoogleTokens, so the anchor is the whole defence.
    const spawner = makeSpawner(0, 'refresh_token=1//0eTOKENS-MODE-LEAK', '');
    const out = await run(['auth', 'add'], { spawner, redactMode: 'tokens' });
    expect(out).not.toContain('1//0eTOKENS-MODE-LEAK');
    expect(out).toContain('[REDACTED]');
  });

  it('still redacts a real refresh token, which is never welded to base64', async () => {
    // The anchor must not have bought base64 survival at the cost of detection:
    // a genuine token is always delimited (quote, space, `=`, `:`), so it still
    // matches.
    const spawner = makeSpawner(0, '{"refresh_token":"1//0eREAL-REFRESH-TOKEN"}', '');
    const out = await run(['auth', 'list'], { spawner });
    expect(out).not.toContain('1//0eREAL-REFRESH-TOKEN');
    expect(out).toContain('[REDACTED]');
  });

  it('opaqueFields exempts a named blob from redaction it would otherwise fail', async () => {
    // A payload that spells a Google API key by chance — still possible after
    // the boundary anchor, because AIza… needs no delimiter. The field
    // exemption is what covers this class rather than one pattern.
    // `/` supplies the word boundary AIza… needs, and every character here is
    // in the base64 alphabet — so this is a payload a real file can produce.
    const payload = `AAAA/AIza${'B'.repeat(35)}/CCC`;
    expect(Buffer.from(payload, 'base64').toString('base64')).toBe(payload); // genuinely valid base64
    const spawner = makeSpawner(0, JSON.stringify({ contentBase64: payload }), '');
    const bare = await run(['gmail', 'attachment', 'm1', '0'], { spawner });
    expect(bare).toContain('[REDACTED]'); // unprotected, the shared redactor hits it

    const spawner2 = makeSpawner(0, JSON.stringify({ contentBase64: payload }), '');
    const guarded = await run(['gmail', 'attachment', 'm1', '0'], {
      spawner: spawner2,
      opaqueFields: ['contentBase64'],
    });
    expect(JSON.parse(guarded).contentBase64).toBe(payload);
  });

  it('opaqueFields still redacts prose OUTSIDE the exempt field', async () => {
    // The exemption is per-field, not per-response: a token in a sibling field
    // must still be stripped.
    const stdout = JSON.stringify({
      contentBase64: 'QUJDREVGR0hJSktMTU5PUFFSU1Q=',
      note: 'refreshed with 1//0eLEAK-IN-PROSE',
    });
    const spawner = makeSpawner(0, stdout, '');
    const out = await run(['gmail', 'attachment', 'm1', '0'], { spawner, opaqueFields: ['contentBase64'] });
    expect(out).not.toContain('1//0eLEAK-IN-PROSE');
    expect(JSON.parse(out).contentBase64).toBe('QUJDREVGR0hJSktMTU5PUFFSU1Q=');
  });

  it('opaqueFields does not exempt a field carrying prose rather than a blob', async () => {
    // Only an all-base64 value qualifies, so naming a field cannot be used to
    // smuggle a credential through in a sentence.
    const stdout = JSON.stringify({ contentBase64: 'token is 1//0eSMUGGLED-TOKEN here' });
    const spawner = makeSpawner(0, stdout, '');
    const out = await run(['gmail', 'attachment', 'm1', '0'], { spawner, opaqueFields: ['contentBase64'] });
    expect(out).not.toContain('1//0eSMUGGLED-TOKEN');
  });

  it('opaqueFields never exempts anything on the ERROR path', async () => {
    const spawner = makeSpawner(1, '', 'failed for 1//0eERROR-PATH-LEAK');
    await expect(
      run(['gmail', 'attachment', 'm1', '0'], { spawner, opaqueFields: ['contentBase64'] }),
    ).rejects.toThrow(/\[REDACTED\]/);
  });

  it("redactMode 'tokens' still strips real Google tokens", async () => {
    const leak = 'url with token ya29.a0Ad52N3-STEP-LEAK and refresh 1//0eSTEP-REFRESH-LEAK';
    const spawner = makeSpawner(0, leak, '');
    const out = await run(['auth', 'add'], { spawner, redactMode: 'tokens' });
    expect(out).not.toContain('ya29.a0Ad52N3-STEP-LEAK');
    expect(out).not.toContain('1//0eSTEP-REFRESH-LEAK');
    expect(out).toContain('[REDACTED]');
  });

  it("redactMode 'tokens' strips tokens from thrown error text too", async () => {
    const spawner = makeSpawner(1, '', 'boom ya29.a0Ad52N3-ERR-LEAK end');
    await expect(run(['auth', 'add'], { spawner, redactMode: 'tokens' })).rejects.toThrow('[REDACTED]');
  });

  it('runBinary returns stdout base64-encoded, not the raw string', async () => {
    const spawner = makeSpawner(0, '%PDF-1.4 body');
    const out = await runBinary(['api', 'call', 'drive', 'v3', 'files.get'], { spawner });
    expect(out).toBe(Buffer.from('%PDF-1.4 body').toString('base64'));
    expect(out).not.toBe('%PDF-1.4 body'); // base64, so bytes survive intact
    const callArgs = (spawner as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(callArgs).toContain('--json');
    expect(callArgs).toContain('files.get');
  });

  it('runBinary refuses over the hosted-connector forward executor', async () => {
    const executor = vi.fn();
    await expect(
      runExecutor.run({ executor }, () => runBinary(['api', 'call', 'drive', 'v3', 'files.get'])),
    ).rejects.toThrow('not available over the hosted connector');
    expect(executor).not.toHaveBeenCalled();
  });

  it('ignores timeout if close event already settled the promise', async () => {
    vi.useFakeTimers();
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      // Schedule close at ~same time as timeout but ensure it wins
      const closeTimer = setTimeout(() => {
        (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from('{"ok":true}'));
        proc.emit('close', 0);
      }, 29_999);
      // Store timer so we can control it in test
      (proc as any).closeTimer = closeTimer;
      return proc;
    }) as unknown as Spawner;

    const promise = run(['sheets', 'get', 'id', 'A1'], { spawner });
    // Advance to just before timeout, triggering close
    vi.advanceTimersByTime(29_999);
    const result = await promise;
    expect(result).toBe('{"ok":true}');
    // Continue advancing to verify timeout handler doesn't cause issues
    vi.advanceTimersByTime(2);
    vi.useRealTimers();
  });
});

describe('run --readonly (gog 0.31)', () => {
  function withReadonlyEnv<T>(value: string | undefined, fn: () => T): T {
    const original = process.env.GOG_READONLY;
    if (value === undefined) delete process.env.GOG_READONLY;
    else process.env.GOG_READONLY = value;
    try {
      return fn();
    } finally {
      if (original === undefined) delete process.env.GOG_READONLY;
      else process.env.GOG_READONLY = original;
    }
  }

  it('injects --readonly when options.readonly is true', async () => {
    const spawner = makeSpawner(0, '{}');
    await withReadonlyEnv(undefined, () => run(['drive', 'list'], { readonly: true, spawner }));
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--color=never', '--no-input', '--readonly', 'drive', 'list'],
      expect.any(Object),
    );
  });

  it('injects --readonly when GOG_READONLY is set to a truthy value', async () => {
    const spawner = makeSpawner(0, '{}');
    await withReadonlyEnv('1', () => run(['drive', 'list'], { spawner }));
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--color=never', '--no-input', '--readonly', 'drive', 'list'],
      expect.any(Object),
    );
  });

  it('does not inject --readonly when GOG_READONLY is an explicit off value', async () => {
    const spawner = makeSpawner(0, '{}');
    await withReadonlyEnv('false', () => run(['drive', 'list'], { spawner }));
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--color=never', '--no-input', 'drive', 'list'],
      expect.any(Object),
    );
  });

  it('does not inject --readonly by default', async () => {
    const spawner = makeSpawner(0, '{}');
    await withReadonlyEnv(undefined, () => run(['drive', 'list'], { spawner }));
    const call = (spawner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).not.toContain('--readonly');
  });

  // GOG_READONLY is fail-safe: an unrecognised (but set) value blocks writes
  // rather than silently allowing them.
  it('injects --readonly when GOG_READONLY is set to an unrecognised value', async () => {
    const spawner = makeSpawner(0, '{}');
    await withReadonlyEnv('enable-please', () => run(['drive', 'list'], { spawner }));
    const call = (spawner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).toContain('--readonly');
  });

  it('does not inject --readonly when GOG_READONLY is an unresolved .mcpb placeholder', async () => {
    const spawner = makeSpawner(0, '{}');
    await withReadonlyEnv('${user_config.gog_readonly}', () => run(['drive', 'list'], { spawner }));
    const call = (spawner as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).not.toContain('--readonly');
  });
});

describe('run executor seam', () => {
  it('routes to an injected runExecutor executor when no options.spawner is given', async () => {
    const executor = vi.fn(async () => '{"via":"executor"}') as unknown as GogExecutor;
    const result = await runExecutor.run({ executor }, () => run(['sheets', 'get', 'id1', 'A1']));
    expect(result).toBe('{"via":"executor"}');
    // The executor receives the FULLY-ASSEMBLED gog arg list plus the run opts.
    expect(executor).toHaveBeenCalledWith(
      ['--json', '--color=never', '--no-input', 'sheets', 'get', 'id1', 'A1'],
      { timeout: undefined, interactive: false },
    );
  });

  it('forwards timeout and interactive through to the injected executor', async () => {
    const executor = vi.fn(async () => '{}') as unknown as GogExecutor;
    await runExecutor.run({ executor }, () =>
      run(['auth', 'add', 'u@g.com'], { interactive: true, timeout: 60_000 }),
    );
    expect(executor).toHaveBeenCalledWith(
      ['--json', '--color=never', 'auth', 'add', 'u@g.com'],
      { timeout: 60_000, interactive: true },
    );
  });

  it('redacts Google tokens returned by an injected executor', async () => {
    const executor = vi.fn(async () => 'token ya29.a0Ad52N3-ALS-LEAK done') as unknown as GogExecutor;
    const result = await runExecutor.run({ executor }, () => run(['auth', 'list']));
    expect(result).not.toContain('ya29.a0Ad52N3-ALS-LEAK');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts error text thrown by an injected executor', async () => {
    const executor = vi.fn(async () => {
      throw new Error('boom 1//0eALS-REFRESH-LEAK end');
    }) as unknown as GogExecutor;
    try {
      await runExecutor.run({ executor }, () => run(['gmail', 'get', 'm1']));
      throw new Error('expected rejection');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('1//0eALS-REFRESH-LEAK');
      expect(msg).toContain('[REDACTED]');
    }
  });

  // run() re-wraps every thrown error to redact secrets from its message. That
  // rewrap must not cost a RunnerTransportError its TYPE: the type is the only
  // thing that tells diagnose() the failure was the connector's transport and
  // not the caller's Google credential, and a bare Error puts it straight back
  // to guessing from prose.
  it('preserves a RunnerTransportError through the redacting rewrap', async () => {
    const executor = vi.fn(async () => {
      throw new RunnerTransportError('runner key mismatch; saw 1//0eLEAKED-REFRESH end', 'transport-auth', 401);
    }) as unknown as GogExecutor;
    const err = await runExecutor
      .run({ executor }, () => run(['gmail', 'get', 'm1']))
      .catch((e: unknown) => e);
    expect(isRunnerTransportError(err)).toBe(true);
    expect((err as RunnerTransportError).kind).toBe('transport-auth');
    expect((err as RunnerTransportError).status).toBe(401);
    // and it is still redacted
    expect((err as Error).message).not.toContain('1//0eLEAKED-REFRESH');
    expect((err as Error).message).toContain('[REDACTED]');
  });

  it('options.spawner takes precedence over an injected ALS executor', async () => {
    const spawner = makeSpawner(0, '{"via":"spawner"}');
    const executor = vi.fn(async () => '{"via":"executor"}') as unknown as GogExecutor;
    const result = await runExecutor.run({ executor }, () =>
      run(['sheets', 'get', 'id1', 'A1'], { spawner }),
    );
    expect(result).toBe('{"via":"spawner"}');
    expect(executor).not.toHaveBeenCalled();
    expect(spawner).toHaveBeenCalledOnce();
  });

  it('falls back to the lazily-imported real spawn when neither a spawner nor an ALS executor is set', async () => {
    vi.mocked(mockedSpawn).mockImplementation((() => makeProc(0, '{"real":true}')) as never);
    const result = await run(['sheets', 'get', 'id1', 'A1']);
    expect(result).toBe('{"real":true}');
    expect(mockedSpawn).toHaveBeenCalledWith(
      'gog',
      ['--json', '--color=never', '--no-input', 'sheets', 'get', 'id1', 'A1'],
      expect.objectContaining({ env: expect.any(Object) }),
    );
  });
});
