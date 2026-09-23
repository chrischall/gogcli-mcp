import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat, symlink, chmod, utimes, readdir } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import {
  ATTACHMENT_DOWNLOAD_ROOT,
  ATTACHMENT_TTL_MS,
  ensurePrivateDir,
  sweepExpiredDownloads,
  removeDownload,
  prepareDownloadRoot,
} from '../src/attachment-root.js';

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'gog-attroot-test-'));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// SEC-6: downloads used to land in a fixed, shared /tmp/gog-attachments that
// nothing ever emptied — predictable, pre-creatable by another local user, and
// a growing pile of medical/financial attachments.
describe('ATTACHMENT_DOWNLOAD_ROOT', () => {
  it('is per-user, under the OS temp dir, not the shared /tmp/gog-attachments', () => {
    expect(ATTACHMENT_DOWNLOAD_ROOT).not.toBe('/tmp/gog-attachments');
    expect(ATTACHMENT_DOWNLOAD_ROOT.startsWith(tmpdir())).toBe(true);
    expect(ATTACHMENT_DOWNLOAD_ROOT).toContain(String(userInfo().uid));
  });
});

describe('ensurePrivateDir', () => {
  it('creates the directory owner-only (0700)', async () => {
    const dir = join(scratch, 'root');
    await ensurePrivateDir(dir);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('tightens an existing directory of ours that others could read', async () => {
    const dir = join(scratch, 'loose');
    await mkdir(dir, { mode: 0o755 });
    await chmod(dir, 0o755);
    await ensurePrivateDir(dir);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('refuses a symlink planted where the root should be', async () => {
    const target = join(scratch, 'elsewhere');
    await mkdir(target);
    const dir = join(scratch, 'planted');
    await symlink(target, dir);
    await expect(ensurePrivateDir(dir)).rejects.toThrow(/not a real directory/);
  });

  it('refuses a regular file in its place', async () => {
    const dir = join(scratch, 'file');
    await writeFile(dir, 'x');
    await expect(ensurePrivateDir(dir)).rejects.toThrow(/not a real directory/);
  });

  it('refuses a directory owned by another user', async () => {
    const dir = join(scratch, 'theirs');
    await mkdir(dir);
    await expect(ensurePrivateDir(dir, { uid: userInfo().uid + 1 })).rejects.toThrow(/owned by another user/);
  });

  it('surfaces an error other than "already exists"', async () => {
    await expect(ensurePrivateDir(join(scratch, 'missing-parent', 'root'))).rejects.toThrow(/ENOENT/);
  });
});

describe('sweepExpiredDownloads', () => {
  it('removes entries older than the TTL and keeps fresh ones', async () => {
    const old = join(scratch, 'm-old');
    const fresh = join(scratch, 'm-new');
    await mkdir(old);
    await mkdir(fresh);
    await writeFile(join(old, 'a.pdf'), 'x');
    const past = new Date(Date.now() - ATTACHMENT_TTL_MS - 60_000);
    await utimes(old, past, past);
    const removed = await sweepExpiredDownloads(scratch);
    expect(removed).toBe(1);
    expect(await readdir(scratch)).toEqual(['m-new']);
  });

  it('is a no-op on a missing root', async () => {
    expect(await sweepExpiredDownloads(join(scratch, 'nope'))).toBe(0);
  });
});

describe('removeDownload', () => {
  it('deletes the file and the now-empty directories up to the root', async () => {
    const file = join(scratch, 'm1', 'a1', 'x.pdf');
    await mkdir(join(scratch, 'm1', 'a1'), { recursive: true });
    await writeFile(file, 'x');
    await removeDownload(file, scratch);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('keeps a directory that still holds another download', async () => {
    await mkdir(join(scratch, 'm1'), { recursive: true });
    await writeFile(join(scratch, 'm1', 'keep.pdf'), 'k');
    await writeFile(join(scratch, 'm1', 'x.pdf'), 'x');
    await removeDownload(join(scratch, 'm1', 'x.pdf'), scratch);
    expect(await readdir(join(scratch, 'm1'))).toEqual(['keep.pdf']);
  });

  it('never touches a path outside the root', async () => {
    const outside = join(scratch, 'outside.txt');
    await writeFile(outside, 'x');
    const root = join(scratch, 'root');
    await mkdir(root);
    await removeDownload(outside, root);
    await removeDownload(join(root, '..', 'outside.txt'), root);
    expect((await stat(outside)).isFile()).toBe(true);
  });

  it('ignores a file that is already gone', async () => {
    await expect(removeDownload(join(scratch, 'gone', 'x'), scratch)).resolves.toBeUndefined();
  });
});

describe('prepareDownloadRoot', () => {
  it('ensures the root is private and sweeps it', async () => {
    const root = join(scratch, 'prep');
    await prepareDownloadRoot(root);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
  });
});
