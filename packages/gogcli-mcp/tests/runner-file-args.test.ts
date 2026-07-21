import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { run, isGogFileArg } from '../src/runner.js';
import type { Spawner, GogArg } from '../src/runner.js';
import { payloadArg, PAYLOAD_INLINE_MAX } from '../src/tools/utils.js';

// These tests deliberately use the REAL fs: the whole point is that the bytes
// gog would read off disk are byte-identical to the payload, and that the temp
// dir is actually gone afterwards.

interface Capture {
  /** argv gog was spawned with. */
  argv: string[];
  /** Contents read back off disk WHILE the child was "running". */
  files: Record<string, string>;
  /** Temp dirs observed in the argv, captured before cleanup ran. */
  dirs: string[];
}

/**
 * A Spawner stub that, at spawn time, reads every `--x-file=<path>` arg back
 * off disk. Reading inside the spawner is load-bearing: by the time `run()`
 * resolves, the temp dir has already been removed.
 */
function makeCapturingSpawner(
  exitCode: number,
  stdout = '',
  stderr = '',
): { spawner: Spawner; capture: Capture } {
  const capture: Capture = { argv: [], files: {}, dirs: [] };
  const spawner = vi.fn((_cmd: string, argv: string[]) => {
    capture.argv = argv;
    for (const arg of argv) {
      const match = /^--([^=]+-file)=(.*)$/s.exec(arg);
      if (!match) continue;
      capture.files[match[1]] = readFileSync(match[2], 'utf8');
      capture.dirs.push(dirname(match[2]));
    }
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    proc.kill = vi.fn();
    setTimeout(() => {
      (proc as unknown as { stdout: EventEmitter }).stdout.emit('data', Buffer.from(stdout));
      (proc as unknown as { stderr: EventEmitter }).stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', exitCode);
    }, 0);
    return proc;
  }) as unknown as Spawner;
  return { spawner, capture };
}

/** A stub that never emits close, so the timeout path fires. */
function makeHangingSpawner(capture: Capture): Spawner {
  return vi.fn((_cmd: string, argv: string[]) => {
    capture.argv = argv;
    for (const arg of argv) {
      const match = /^--([^=]+-file)=(.*)$/s.exec(arg);
      if (!match) continue;
      capture.files[match[1]] = readFileSync(match[2], 'utf8');
      capture.dirs.push(dirname(match[2]));
    }
    const proc = new EventEmitter() as ReturnType<Spawner>;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }) as unknown as Spawner;
}

const big = (n: number) => 'x'.repeat(n);

describe('payloadArg', () => {
  it('keeps a small value on the inline flag verbatim', () => {
    const arg = payloadArg('body-html', 'body-html-file', '<p>hi</p>', 'html');
    expect(arg).toBe('--body-html=<p>hi</p>');
  });

  it('keeps a value exactly at the threshold inline', () => {
    const value = big(PAYLOAD_INLINE_MAX);
    expect(payloadArg('body', 'body-file', value)).toBe(`--body=${value}`);
  });

  it('switches to a file arg one byte over the threshold', () => {
    const value = big(PAYLOAD_INLINE_MAX + 1);
    expect(payloadArg('body-html', 'body-html-file', value, 'html')).toEqual({
      kind: 'file',
      flag: 'body-html-file',
      contents: value,
      ext: 'html',
    });
  });

  it('leaves ext undefined when not supplied, so the runner defaults it', () => {
    const arg = payloadArg('body', 'body-file', big(PAYLOAD_INLINE_MAX + 1));
    expect(arg).toMatchObject({ kind: 'file', flag: 'body-file', ext: undefined });
  });

  // A char-based check would let ~3x the byte budget through. Measure bytes.
  it('measures BYTES not characters for multibyte payloads', () => {
    // '—' (em dash) is 3 bytes in UTF-8. Just over the byte cap, well under it
    // by character count.
    const value = '—'.repeat(Math.floor(PAYLOAD_INLINE_MAX / 3) + 1);
    expect(value.length).toBeLessThanOrEqual(PAYLOAD_INLINE_MAX);
    expect(Buffer.byteLength(value, 'utf8')).toBeGreaterThan(PAYLOAD_INLINE_MAX);
    expect(isGogFileArg(payloadArg('body', 'body-file', value))).toBe(true);
  });
});

describe('run with GogFileArgs', () => {
  it('substitutes a file arg with a real path whose file holds the exact bytes', async () => {
    const body = big(PAYLOAD_INLINE_MAX + 1);
    const { spawner, capture } = makeCapturingSpawner(0, '{"ok":true}');

    await run(['gmail', 'drafts', 'create', payloadArg('body-html', 'body-html-file', body, 'html')], { spawner });

    const fileArg = capture.argv.find((a) => a.startsWith('--body-html-file='))!;
    expect(fileArg).toBeDefined();
    const path = fileArg.slice('--body-html-file='.length);
    expect(path).not.toContain(body);
    expect(path.endsWith('.html')).toBe(true);
    expect(capture.files['body-html-file']).toBe(body);
  });

  it('defaults the temp-file extension to txt when ext is omitted', async () => {
    const { spawner, capture } = makeCapturingSpawner(0, '{}');
    await run(['gmail', 'send', { kind: 'file', flag: 'body-file', contents: 'hello' }], { spawner });
    const fileArg = capture.argv.find((a) => a.startsWith('--body-file='))!;
    expect(fileArg.endsWith('.txt')).toBe(true);
  });

  it('round-trips UTF-8 punctuation byte-for-byte through the temp file', async () => {
    // The characters an LLM-authored mail body actually contains, and the ones
    // a lossy encoding step would mangle first.
    const tricky = 'em—dash en–dash minus−sign “curly” ‘quotes’ ellipsis… ✓ 日本語 🎉';
    const body = tricky + '\n' + big(PAYLOAD_INLINE_MAX) + '\n' + tricky;
    const { spawner, capture } = makeCapturingSpawner(0, '{}');

    await run(['gmail', 'send', payloadArg('body-html', 'body-html-file', body, 'html')], { spawner });

    expect(capture.files['body-html-file']).toBe(body);
    expect(Buffer.from(capture.files['body-html-file'], 'utf8')).toEqual(Buffer.from(body, 'utf8'));
  });

  it('writes each file arg to its own path when one command carries two payloads', async () => {
    // --body-file and --signature-file share the .txt extension; a fixed
    // basename would have the second clobber the first.
    const bodyText = 'BODY ' + big(PAYLOAD_INLINE_MAX);
    const sigText = 'SIG ' + big(PAYLOAD_INLINE_MAX);
    const { spawner, capture } = makeCapturingSpawner(0, '{}');

    await run([
      'gmail', 'send',
      payloadArg('body', 'body-file', bodyText),
      payloadArg('signature', 'signature-file', sigText),
    ], { spawner });

    expect(capture.files['body-file']).toBe(bodyText);
    expect(capture.files['signature-file']).toBe(sigText);
  });

  it('leaves plain string args untouched alongside a file arg', async () => {
    const { spawner, capture } = makeCapturingSpawner(0, '{}');
    await run([
      'gmail', 'drafts', 'create',
      '--to=a@b.com',
      payloadArg('body', 'body-file', big(PAYLOAD_INLINE_MAX + 1)),
      '--subject=Hi',
    ], { spawner });

    expect(capture.argv.slice(0, 6)).toEqual([
      '--json', '--color=never', '--no-input', 'gmail', 'drafts', 'create',
    ]);
    expect(capture.argv).toContain('--to=a@b.com');
    expect(capture.argv).toContain('--subject=Hi');
  });

  it('removes the temp dir after a successful run', async () => {
    const { spawner, capture } = makeCapturingSpawner(0, '{"ok":true}');
    await run(['gmail', 'send', payloadArg('body', 'body-file', big(PAYLOAD_INLINE_MAX + 1))], { spawner });
    expect(capture.dirs).toHaveLength(1);
    expect(existsSync(capture.dirs[0])).toBe(false);
  });

  it('removes the temp dir after gog exits non-zero', async () => {
    const { spawner, capture } = makeCapturingSpawner(1, '', 'gog: boom');
    await expect(
      run(['gmail', 'send', payloadArg('body', 'body-file', big(PAYLOAD_INLINE_MAX + 1))], { spawner }),
    ).rejects.toThrow('gog: boom');
    expect(capture.dirs).toHaveLength(1);
    expect(existsSync(capture.dirs[0])).toBe(false);
  });

  it('removes the temp dir after a timeout', async () => {
    // Real timers with a tiny timeout, deliberately: the temp file is written
    // with real fs IO before the spawn, and vitest's fake timers can't advance
    // past a pending IO callback to reach the timeout that is armed after it.
    const capture: Capture = { argv: [], files: {}, dirs: [] };
    const spawner = makeHangingSpawner(capture);

    await expect(
      run(['gmail', 'send', payloadArg('body', 'body-file', big(PAYLOAD_INLINE_MAX + 1))], {
        spawner,
        timeout: 20,
      }),
    ).rejects.toThrow('gog timed out after 20ms');

    expect(capture.dirs).toHaveLength(1);
    expect(existsSync(capture.dirs[0])).toBe(false);
  });

  it('forwards GogFileArgs unmaterialized to an injected executor', async () => {
    // The hosted (Worker/Fly) executor does its own materialization on the
    // remote side, so run() must hand it the union, not a local path.
    const { runExecutor } = await import('../src/runner.js');
    let seen: GogArg[] = [];
    const executor = vi.fn(async (args: GogArg[]) => { seen = args; return '{}'; });
    await runExecutor.run({ executor }, () =>
      run(['gmail', 'send', payloadArg('body', 'body-file', big(PAYLOAD_INLINE_MAX + 1))], {}),
    );
    expect(seen.at(-1)).toMatchObject({ kind: 'file', flag: 'body-file' });
  });
});

describe('isGogFileArg', () => {
  it('distinguishes plain strings from file args', () => {
    expect(isGogFileArg('--body=hi')).toBe(false);
    expect(isGogFileArg({ kind: 'file', flag: 'body-file', contents: 'hi' })).toBe(true);
  });
});
