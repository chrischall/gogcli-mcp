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
  it('passes --json --no-input --color=never before service args', async () => {
    const spawner = makeSpawner(0, '{"ok":true}');
    await run(['sheets', 'get', 'id1', 'A1'], { spawner });
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--no-input', '--color=never', 'sheets', 'get', 'id1', 'A1'],
      expect.objectContaining({ env: process.env }),
    );
  });

  it('injects --account from options.account', async () => {
    const spawner = makeSpawner(0, '{}');
    await run(['sheets', 'metadata', 'id1'], { account: 'me@gmail.com', spawner });
    expect(spawner).toHaveBeenCalledWith(
      'gog',
      ['--json', '--no-input', '--color=never', '--account', 'me@gmail.com', 'sheets', 'metadata', 'id1'],
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
        ['--json', '--no-input', '--color=never', '--account', 'env@gmail.com', 'sheets', 'metadata', 'id1'],
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
        ['--json', '--no-input', '--color=never', '--account', 'override@gmail.com', 'sheets', 'metadata', 'id1'],
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
});
