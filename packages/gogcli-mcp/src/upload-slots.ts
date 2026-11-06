// Getting a caller's file to gog when the caller shares no filesystem with it.
//
// On a hosted deployment (mcp-host) every path a tool accepts names a file on
// the SERVER, so a caller holding a photo had one route left: `attachInline`,
// base64 inside the JSON-RPC request. That is capped at 8 MiB a file, every
// byte rides in one request (mcp-host caps a request at ~9.9 MiB), and the
// model has to emit the base64 as text — impractical past a small file.
//
// Upload slots take the bytes out of the request. `gog_upload_slots` mints a
// signed PUT URL per file on mcp-host's per-registration blob store; the caller
// `curl`s each file there and passes the returned `blobKeys` to the tool that
// takes the file. Here each key becomes an ordinary `GogFileArg` — base64
// contents under the slot's filename — so the runner's existing temp-file seam
// writes it beside gog and gog sees a plain path. No new transport.
//
// ## When a blob is deleted
//
// Read with `store.get` BEFORE the gog call, deleted with `store.delete` only
// AFTER it succeeded (`releaseBlobs`). Not `consume`, for two reasons:
//  - the bytes must exist before the confirmation gate runs, because a gated
//    tool binds their SHA-256 into the confirmation payload, and the preview
//    phase must not delete anything; and
//  - one call may name ten keys, and `consume` deletes per key inside its own
//    callback — nesting ten of them around one gog run buys nothing over a
//    read-all, run-once, delete-all sequence.
// The bytes gog sends are the bytes that were hashed (one read, no re-read in
// between). A failed gog call keeps every blob, so a retry can reuse the keys;
// a failed delete is a warning beside the success, never a failure — the
// upstream write already happened and must not be retried.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { readEnvVar } from '@chrischall/mcp-utils';
import {
  blobStoreFromEnv as uploadStoreFromEnv,
  checkUploadSize,
  MAX_UPLOAD_FILES,
  UPLOAD_KEY_PREFIX,
  uploadFileNameFromKey,
} from '@chrischall/mcp-utils/export';
import type { BlobStore } from '@chrischall/mcp-utils/export';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { GogFileArg } from './runner.js';
import { INLINE_ATTACHMENT_LIMITS_TEXT } from './attachments.js';
import { blobStoreFromEnv as blobUrlConfigFromEnv } from './blob-urls.js';
import { confinePath, confinePaths } from './file-roots.js';

/** The tool that mints upload slots — named in every refusal that should lead to it. */
export const UPLOAD_SLOTS_TOOL = 'gog_upload_slots';

/**
 * Largest file one blobKey may carry. Gmail refuses a message over 25 MB, so a
 * bigger attachment could never be sent, and Docs/Slides cap an inserted image
 * at 50 MB. 25 MiB is the tightest of those, it is the fleet's existing upload
 * cap (ofw-mcp), and it bounds the server's memory: the file is held in memory
 * once as bytes and once as the base64 the temp-file seam writes.
 */
export const MAX_BLOB_FILE_BYTES = 25 * 1024 * 1024;

export { MAX_UPLOAD_FILES };

/** The small-file alternative a hosted refusal names on the attachment tools. */
export const ATTACH_INLINE_ALTERNATIVE = `or, for a small file, pass its bytes base64-encoded in \`attachInline\` (${INLINE_ATTACHMENT_LIMITS_TEXT})`;

/**
 * True on an mcp-host deployment: it lends the child a data dir (every gog
 * registration uses `--data-dir`) and/or the blob store this repo already uses
 * for signed download URLs (`blob-urls.ts`). Either means the caller is
 * somewhere else and no path they can name exists here.
 */
export function isHostedDeployment(): boolean {
  return readEnvVar('MCP_DATA_DIR') !== undefined || blobUrlConfigFromEnv() !== undefined;
}

/** The upload store, or a refusal that says what to use instead on a local install. */
export function requireUploadStore(what: string): BlobStore {
  const store = uploadStoreFromEnv();
  if (store) return store;
  throw new Error(
    `${what} needs the upload store a hosted (mcp-host) deployment provides, and this server has none — it is a `
    + 'local install, so gog can read your files directly. Pass a server path instead (attach / localPath / file / '
    + 'image, inside GOG_FILE_ROOTS), or for a small file the bytes with attachInline / content.',
  );
}

/** The filename a blobKey was minted for; only keys `gog_upload_slots` minted are accepted. */
export function blobFileName(key: string): string {
  try {
    return uploadFileNameFromKey(key, { prefix: UPLOAD_KEY_PREFIX });
  } catch (e) {
    const message = (e as Error).message;
    if (!message.includes('is not an upload key')) throw e;
    throw new Error(`blobKey ${JSON.stringify(key)} is not an upload key. Pass each blobKey exactly as ${UPLOAD_SLOTS_TOOL} returned it.`);
  }
}

const blobKeysText =
  `Hosted deployments: blobKeys from ${UPLOAD_SLOTS_TOOL} for files you have ALREADY PUT to their uploadUrl. `
  + 'This is how to send a file you hold (a photo, a PDF) when this server is remote: no base64 in the call, '
  + `up to ${MAX_BLOB_FILE_BYTES / (1024 * 1024)} MiB a file. Each file keeps the filename its slot was minted for. `
  + 'An uploaded file is deleted once this call succeeds and kept if it fails, so a retry can reuse the same keys.';

/** `blobKeys` for a tool that takes several files (attachments). */
export const blobKeysParam = z.array(z.string()).max(MAX_UPLOAD_FILES).optional().describe(
  `${blobKeysText} Up to ${MAX_UPLOAD_FILES}; combine freely with attach / attachInline.`,
);

/** `blobKeys` for a tool that takes ONE file. */
export const singleBlobKeyParam = z.array(z.string()).max(1).optional().describe(
  `${blobKeysText} Exactly one key; use it INSTEAD of the path parameter.`,
);

/** One uploaded file, read and ready to hand to gog. */
export interface BlobFile {
  blobKey: string;
  filename: string;
  size: number;
  sha256: string;
  /** Materialized beside gog by the runner, under `filename`. */
  arg: GogFileArg;
  /** Where it lives — what `releaseBlobs` deletes it from. */
  store: BlobStore;
}

/**
 * Read every blob a call names, WITHOUT deleting any, and turn each into a
 * `GogFileArg` for `flag` (positional for subcommands that take the file as an
 * argument). Every key is validated before anything is fetched, so a bad entry
 * fails the call with nothing read.
 */
export async function readBlobFiles(
  keys: readonly string[] | undefined,
  flag: string,
  opts: { positional?: boolean } = {},
): Promise<BlobFile[]> {
  if (!keys?.length) return [];
  if (new Set(keys).size !== keys.length) throw new Error('blobKeys lists the same blobKey twice; pass each uploaded file once.');
  const names = keys.map(blobFileName);
  const store = requireUploadStore('blobKeys');
  const files: BlobFile[] = [];
  for (const [i, blobKey] of keys.entries()) {
    const filename = names[i]!;
    let bytes: Uint8Array;
    try {
      bytes = (await store.get(blobKey, { maxBytes: MAX_BLOB_FILE_BYTES })).bytes;
    } catch (e) {
      throw new Error(
        `${filename} could not be read from the upload store: ${(e as Error).message} PUT the file to its uploadUrl `
        + `before calling this tool (files over ${MAX_BLOB_FILE_BYTES} bytes are refused), and mint a new slot with `
        + `${UPLOAD_SLOTS_TOOL} if this key was already used by a call that succeeded.`,
      );
    }
    checkUploadSize(filename, bytes.length, MAX_BLOB_FILE_BYTES);
    const arg: GogFileArg = { kind: 'file', flag, contents: Buffer.from(bytes).toString('base64'), encoding: 'base64', filename };
    if (opts.positional) arg.positional = true;
    files.push({ blobKey, filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), arg, store });
  }
  return files;
}

/**
 * After the gog call: on success delete every blob (a failed delete becomes a
 * WARNING beside the result); on failure keep them all and say the keys can be
 * reused.
 */
export async function releaseBlobs(result: CallToolResult, files: readonly BlobFile[]): Promise<CallToolResult> {
  if (files.length === 0) return result;
  if (result.isError) {
    return withNote(result,
      `The uploaded files (${files.map((f) => f.filename).join(', ')}) were kept in the upload store, so you can retry `
      + 'with the same blobKeys.');
  }
  const failed: string[] = [];
  for (const file of files) {
    try {
      await file.store.delete(file.blobKey);
    } catch (e) {
      failed.push(`${file.filename} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (failed.length === 0) return result;
  return withNote(result,
    `WARNING: the call succeeded, but these uploaded files could not be deleted from the upload store: ${failed.join('; ')}. `
    + 'They expire with the store\'s retention. Do NOT retry the call — it already happened.');
}

function withNote(result: CallToolResult, text: string): CallToolResult {
  return { ...result, content: [...result.content, { type: 'text', text }] };
}

function hostedPathRefusal(path: string, param: string, alternative: string | undefined): Error {
  return new Error(
    `This server is remote (a hosted deployment), so \`${param}\` ${JSON.stringify(path)} names a file on the SERVER, `
    + 'not on your machine, and there is no such file here. Upload the bytes instead: call '
    + `${UPLOAD_SLOTS_TOOL} with files:[{filename}], PUT each file to its uploadUrl (the response includes a ready curl `
    + 'command), then call this tool again with those blobKeys in `blobKeys`'
    + (alternative ? ` — ${alternative}.` : '.'),
  );
}

/**
 * `confinePath` for a path to a file gog will UPLOAD (an attachment, an image,
 * an .eml). Locally, exactly `confinePath`. On a hosted deployment a path that
 * is outside the roots or does not exist is refused with the remote-server
 * explanation and the route that works, instead of a confinement error or gog's
 * bare ENOENT; a file that really is on the server (one gog downloaded there)
 * still passes.
 */
export function confineUploadPath(path: string, param: string, alternative?: string): string {
  if (!isHostedDeployment()) return confinePath(path, param);
  try {
    confinePath(path, param);
  } catch {
    throw hostedPathRefusal(path, param, alternative);
  }
  if (!existsSync(path)) throw hostedPathRefusal(path, param, alternative);
  return path;
}

/** `confineUploadPath` for a list flag; `commaSeparated` as in `confinePaths`. */
export function confineUploadPaths(
  paths: readonly string[] | undefined,
  param: string,
  opts: { commaSeparated?: boolean; alternative?: string } = {},
): void {
  const commaSeparated = opts.commaSeparated ?? true;
  if (!isHostedDeployment()) {
    confinePaths(paths, param, { commaSeparated });
    return;
  }
  for (const path of paths ?? []) {
    try {
      confinePaths([path], param, { commaSeparated });
    } catch {
      throw hostedPathRefusal(path, param, opts.alternative);
    }
    // gog reads a comma-split list flag as several files; each must exist.
    const files = commaSeparated ? path.split(',').filter((p) => p !== '') : [path];
    if (!files.every((f) => existsSync(f))) throw hostedPathRefusal(path, param, opts.alternative);
  }
}

/**
 * Exactly one source for a single-file input. `undefined` and an empty
 * `blobKeys` are absent. Keys are the param names, in the order the error
 * should list them.
 */
export function assertOneFileSource(sources: Record<string, string | readonly string[] | undefined>): void {
  const names = Object.keys(sources);
  const given = names.filter((n) => {
    const v = sources[n];
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  });
  if (given.length === 1) return;
  const list = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  throw new Error(`Pass exactly one of ${list}${given.length > 1 ? ` (got ${given.join(' and ')})` : ''}.`);
}
