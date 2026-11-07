/**
 * The Drive half of gog_trip_map, through gog (runner.ts) — never the network
 * directly. Find-or-create by name + parent (not trashed), so a re-run reuses
 * "Trips/<title>" instead of piling up copies; a same-named file in the folder
 * is replaced in place (`--replace`, which keeps its link and permissions).
 * Sharing is per email, as reader, with no notification — never anyone/domain.
 */
import { pos, run, type GogArg, type Spawner } from '../../gogcli-mcp/src/lib.js';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const KML_MIME = 'application/vnd.google-earth.kml+xml';
export const CSV_MIME = 'text/csv';
const LIST_FIELDS = 'nextPageToken,files(id,name,mimeType,webViewLink)';

export interface DriveOps {
  account?: string;
  spawner?: Spawner;
}

export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
}

/** A file-name-safe slug of a title (ASCII, dashes, ≤ 60 chars), "trip" when nothing is left. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'trip';
}

/** A Drive query string literal: backslash and single quote escaped. */
export function driveQuoted(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function gog<T>(args: GogArg[], ops: DriveOps): Promise<T> {
  return JSON.parse(await run(args, { account: ops.account, spawner: ops.spawner })) as T;
}

/** The folder `name` directly under `parent` (My Drive root when undefined), created if missing. */
export async function findOrCreateFolder(
  name: string,
  parent: string | undefined,
  ops: DriveOps,
): Promise<{ folder: DriveFile; created: boolean }> {
  const args: GogArg[] = ['drive', 'ls'];
  if (parent) args.push(`--parent=${parent}`);
  args.push(
    `--query=name = ${driveQuoted(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
    '--max=10',
    '--sort=createdTime',
    '--order=asc',
    `--fields=${LIST_FIELDS}`,
  );
  const listed = await gog<{ files?: DriveFile[] }>(args, ops);
  const hit = listed.files?.[0];
  if (hit) return { folder: hit, created: false };

  const mkdir: GogArg[] = ['drive', 'mkdir', pos(name)];
  if (parent) mkdir.push(`--parent=${parent}`);
  const made = await gog<{ folder?: DriveFile }>(mkdir, ops);
  if (!made.folder?.id) throw new Error(`gog drive mkdir returned no folder id for "${name}"`);
  return { folder: made.folder, created: true };
}

/** The (non-folder, not trashed) files directly in a folder. */
export async function listFolderFiles(folderId: string, ops: DriveOps): Promise<DriveFile[]> {
  const listed = await gog<{ files?: DriveFile[] }>([
    'drive', 'ls', `--parent=${folderId}`,
    `--query=mimeType != '${FOLDER_MIME}' and trashed = false`,
    '--max=100',
    `--fields=${LIST_FIELDS}`,
  ], ops);
  return listed.files ?? [];
}

/** Upload `localPath` as `name` into the folder, replacing a same-named file there if one exists. */
export async function uploadOrReplace(
  localPath: string,
  name: string,
  mimeType: string,
  folderId: string,
  existing: DriveFile[],
  ops: DriveOps,
): Promise<{ file: DriveFile; replaced: boolean }> {
  const same = existing.find((f) => f.name === name);
  const args: GogArg[] = ['drive', 'upload', pos(localPath), `--name=${name}`, `--mime-type=${mimeType}`];
  args.push(same ? `--replace=${same.id}` : `--parent=${folderId}`);
  const out = await gog<{ file: DriveFile }>(args, ops);
  return { file: out.file, replaced: same !== undefined };
}

/** Grant one person reader access to a folder (no invitation email). */
export async function shareFolderWith(folderId: string, email: string, ops: DriveOps): Promise<void> {
  await run(['drive', 'share', pos(folderId), '--to=user', `--email=${email}`, '--role=reader'], {
    account: ops.account,
    spawner: ops.spawner,
  });
}
