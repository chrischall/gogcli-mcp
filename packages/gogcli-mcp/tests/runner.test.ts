import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { run } from '../src/runner.js';
import type { Spawner } from '../src/runner.js';

function makeSpawner(exitCode: number, stdout = '', stderr = ''): Spawner {
  return vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    setTimeout(() => {
      (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
      (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 0);
    return proc;
  }) as unknown as Spawner;
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
