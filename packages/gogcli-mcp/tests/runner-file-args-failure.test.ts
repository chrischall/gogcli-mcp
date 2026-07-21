import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { run } from '../src/runner.js';
import type { Spawner } from '../src/runner.js';

// This file mocks node:fs/promises to exercise the two paths real fs won't
// take on demand: a write that fails, and a cleanup that fails. It lives in
// its own file because the mock would defeat the byte-level round-trip
// assertions in runner-file-args.test.ts.
const mkdtemp = vi.fn(async () => '/tmp/gogcli-mcp-fake');
const writeFile = vi.fn(async () => {});
const rm = vi.fn(async () => {});

vi.mock('node:fs/promises', () => ({
  mkdtemp: (...args: unknown[]) => mkdtemp(...(args as [])),
  writeFile: (...args: unknown[]) => writeFile(...(args as [])),
  rm: (...args: unknown[]) => rm(...(args as [])),
}));

function okSpawner(stdout = '{}'): Spawner {
  return vi.fn(() => {
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    proc.kill = vi.fn();
    setTimeout(() => {
      (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
      proc.emit('close', 0);
    }, 0);
    return proc;
  }) as unknown as Spawner;
}

const fileArg = { kind: 'file', flag: 'body-file', contents: 'payload' } as const;

describe('temp-file materialization failures', () => {
  beforeEach(() => {
    mkdtemp.mockClear();
    writeFile.mockClear();
    rm.mockClear();
    rm.mockImplementation(async () => {});
    writeFile.mockImplementation(async () => {});
  });

  it('creates NO temp dir when no element is a GogFileArg', async () => {
    // The common path must stay allocation-free: no mkdtemp, no write, no rm.
    await run(['sheets', 'get', 'id1', 'A1'], { spawner: okSpawner() });
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it('removes the temp dir and surfaces the error when the write fails', async () => {
    writeFile.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    const spawner = okSpawner();

    await expect(run(['gmail', 'send', fileArg], { spawner })).rejects.toThrow('ENOSPC');
    expect(rm).toHaveBeenCalledWith('/tmp/gogcli-mcp-fake', { recursive: true, force: true });
    expect(spawner).not.toHaveBeenCalled();
  });

  it('does not let a cleanup failure mask a successful result', async () => {
    rm.mockRejectedValue(new Error('EBUSY'));
    const result = await run(['gmail', 'send', fileArg], { spawner: okSpawner('{"ok":true}') });
    expect(result).toBe('{"ok":true}');
    expect(rm).toHaveBeenCalled();
  });

  it('does not let a cleanup failure mask the real gog error', async () => {
    rm.mockRejectedValue(new Error('EBUSY'));
    const spawner = vi.fn(() => {
      const proc = new EventEmitter() as ReturnType<Spawner>;
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
      (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
      proc.kill = vi.fn();
      setTimeout(() => {
        (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from('gog: invalid draft'));
        proc.emit('close', 1);
      }, 0);
      return proc;
    }) as unknown as Spawner;

    await expect(run(['gmail', 'send', fileArg], { spawner })).rejects.toThrow('gog: invalid draft');
  });

  it('writes the payload with mode 0600 and utf8 encoding', async () => {
    await run(['gmail', 'send', fileArg], { spawner: okSpawner() });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('body-file.txt'),
      'payload',
      { encoding: 'utf8', mode: 0o600 },
    );
  });
});
