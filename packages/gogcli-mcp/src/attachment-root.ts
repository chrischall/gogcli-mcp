// The private, self-cleaning directory attachment downloads land in (audit SEC-6).
//
// It used to be a fixed `/tmp/gog-attachments` that nothing ever emptied, so
// every downloaded attachment — medical records, statements, custody documents
// — piled up in world-traversable /tmp for the life of the host. And because
// the name was predictable and shared, another local user could pre-create it
// or plant a symlink there, redefining where the blob-upload "confinement"
// root pointed.
//
// Now the root is per-user (named for the uid, under the OS temp dir), created
// owner-only (0700), and verified before every use: a symlink, a non-directory
// or a directory owned by someone else is refused rather than trusted. Files a
// caller never sees again (inline, Drive and URL deliveries) are deleted as
// soon as they are delivered; files returned BY PATH are kept for the caller to
// read and swept once they are older than ATTACHMENT_TTL_MS.

import { tmpdir, userInfo } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';

/** Where gmail attachment downloads are written, and the only tree the blob upload reads from. */
export const ATTACHMENT_DOWNLOAD_ROOT = join(tmpdir(), `gogcli-mcp-attachments-${userInfo().uid}`);

/** How long a download returned by path is kept before a later download sweeps it. */
export const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Create `dir` owner-only if missing, then verify it: a real directory (not a
 * symlink), owned by this user, with no group/other permissions (tightened to
 * 0700 when it is ours but looser). `opts.uid` is injected by tests.
 */
export async function ensurePrivateDir(dir: string, opts: { uid?: number } = {}): Promise<void> {
  const { mkdir, lstat, chmod } = await import('node:fs/promises');
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`refusing to use ${dir} for attachment downloads: it is not a real directory`);
  }
  const uid = opts.uid ?? userInfo().uid;
  if (info.uid !== uid) {
    throw new Error(`refusing to use ${dir} for attachment downloads: it is owned by another user`);
  }
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
}

/**
 * Delete top-level entries of `root` last modified more than `ttlMs` ago.
 * Best-effort: a missing root sweeps nothing, and one entry failing never stops
 * the rest. Returns how many entries were removed.
 */
export async function sweepExpiredDownloads(
  root: string = ATTACHMENT_DOWNLOAD_ROOT,
  ttlMs: number = ATTACHMENT_TTL_MS,
  now: number = Date.now(),
): Promise<number> {
  const { readdir, lstat, rm } = await import('node:fs/promises');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    const path = join(root, name);
    try {
      const info = await lstat(path);
      if (now - info.mtimeMs > ttlMs) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // raced with another sweep or a delivery cleanup — nothing to do
    }
  }
  return removed;
}

/**
 * Delete one delivered download, then any directories it leaves empty, up to
 * (never including) `root`. A path outside `root` is left alone: this only
 * ever cleans up after the server's own downloads, never a caller's `out`.
 */
export async function removeDownload(path: string, root: string = ATTACHMENT_DOWNLOAD_ROOT): Promise<void> {
  const { rm, rmdir } = await import('node:fs/promises');
  const base = resolve(root);
  const target = resolve(base, path);
  if (!isInside(base, target)) return;
  await rm(target, { force: true });
  for (let dir = dirname(target); isInside(base, dir); dir = dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      break; // not empty (or already gone): stop climbing
    }
  }
}

/** Make the download root private and sweep expired downloads out of it. */
export async function prepareDownloadRoot(root: string = ATTACHMENT_DOWNLOAD_ROOT): Promise<void> {
  await ensurePrivateDir(root);
  await sweepExpiredDownloads(root);
}
