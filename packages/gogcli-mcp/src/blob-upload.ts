/**
 * Stream a downloaded attachment off this machine's disk to a signed
 * blob-store URL.
 *
 * gog runs in this process tree (mcp-host installs it onto the child's PATH),
 * so `gog gmail attachment --out` has just written the file HERE, and this
 * process is the party that sends it. The rules are the ones the retired Fly
 * runner's `POST /upload` enforced, now applied locally:
 *
 * - The path is confined to the attachment download root, checked lexically
 *   and again on the real path (a symlink inside the root is a second way out).
 *   Unconfined, this is a file-read primitive aimed at a signed URL of the
 *   caller's choosing — and `$HOME` holds gog's keyring.
 * - A file over the blob store's 100 MiB ceiling is refused BEFORE dialling:
 *   the gateway's 413 would arrive only after the whole transfer had run.
 * - The PUT carries `Content-Length` from the file's own size (a chunked PUT is
 *   a 411) and `Content-Type` byte for byte as given — the signature commits to
 *   it, and a normalised header reads as a missing object.
 * - One total deadline bounds the exchange, so a wedged transfer cannot leave
 *   the MCP request unanswered.
 *
 * Every message thrown has the signed URL and its bare `sig=` value scrubbed.
 */

/**
 * Where gmail's attachment download writes (`defaultOutPath` in
 * packages/gogcli-mcp-gmail/src/tools/gmail-extra.ts) and the only tree this
 * module will read back from.
 */
export const ATTACHMENT_DOWNLOAD_ROOT = '/tmp/gog-attachments';

/** mcp-host's blob store caps one object at 100 MiB and answers 413 past it. */
export const MAX_BLOB_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Total deadline on one PUT, from dial to the blob store's last byte. */
export const BLOB_UPLOAD_TIMEOUT_MS = 120_000;

// Enough of the blob store's error body to quote its `{"error":"…"}`, bounded
// so a stray HTML page cannot become the message.
const ERROR_BODY_SNIPPET = 512;

export interface BlobUploadRequest {
  /** The file to send, on this machine, inside the attachment download root. */
  path: string;
  /** The signed PUT URL. A credential — never log it, never echo it. */
  url: string;
  /** Sent as `Content-Type` byte for byte; the PUT signature commits to it. */
  contentType: string;
}

export interface BlobUploadOutcome {
  /** Bytes streamed — the file's own size, not a claim. */
  bytes: number;
  /** The blob store's (2xx) status. */
  status: number;
}

export interface BlobUploadOptions {
  /** The confinement root. Injected by tests. */
  root?: string;
  /** The total deadline. Injected by tests. */
  timeoutMs?: number;
}

/**
 * Remove a signed URL, and the bare signature inside it, from a message.
 *
 * The empty needle is guarded: `split('')` cuts a message into single
 * characters and interleaves the replacement between every one of them.
 */
function withoutUrlSecrets(message: string, url: string): string {
  let out = url ? message.split(url).join('<signed url>') : message;
  const signature = /[?&]sig=([^&#]+)/.exec(url)?.[1];
  if (signature) out = out.split(signature).join('<signature>');
  return out;
}

class UploadError extends Error {}

async function resolveConfined(root: string, requested: string): Promise<{ file: string; bytes: number }> {
  const path = await import('node:path');
  const { realpath, stat } = await import('node:fs/promises');
  // Separator-terminated, so `/tmp/gog-attachments-evil` is not "inside".
  const isInside = (base: string, candidate: string) =>
    candidate === base || candidate.startsWith(base + path.sep);

  const lexicalRoot = path.resolve(root);
  const candidate = path.resolve(lexicalRoot, requested);
  if (!isInside(lexicalRoot, candidate)) {
    throw new UploadError(`the attachment path must be inside ${lexicalRoot}`);
  }
  let realFile: string;
  let realRoot: string;
  try {
    realFile = await realpath(candidate);
    // /tmp is itself a symlink on macOS, so the root is compared real-to-real.
    realRoot = await realpath(lexicalRoot);
  } catch (err) {
    throw new UploadError(`the downloaded attachment could not be found: ${(err as Error).message}`);
  }
  if (!isInside(realRoot, realFile)) {
    throw new UploadError(`the attachment path must be inside ${realRoot}`);
  }
  const info = await stat(realFile);
  if (!info.isFile()) throw new UploadError('the attachment path must name a regular file');
  if (info.size > MAX_BLOB_UPLOAD_BYTES) {
    throw new UploadError(
      `the attachment is ${info.size} bytes; the blob store's maximum is ${MAX_BLOB_UPLOAD_BYTES} bytes`,
    );
  }
  return { file: realFile, bytes: info.size };
}

function parseTarget(url: string): URL {
  let target: URL | undefined;
  try {
    target = new URL(url);
  } catch {
    // refused below
  }
  if (!target || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
    throw new UploadError('the upload target must be an absolute http(s) URL');
  }
  return target;
}

// `http.request` rather than `fetch`: undici drops a caller-set Content-Length
// from a streamed body and sends it chunked, which the gateway refuses. The
// body is a pipe, so a 100 MiB file is never held in memory.
async function putFile(
  target: URL,
  file: string,
  bytes: number,
  contentType: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const { createReadStream } = await import('node:fs');
  const { pipeline } = await import('node:stream');
  const transport = target.protocol === 'https:' ? await import('node:https') : await import('node:http');

  return new Promise((resolve, reject) => {
    let settled = false;
    const source = createReadStream(file);
    const req = transport.request(target, {
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-length': String(bytes) },
    });
    // Release both ends either way: the blob store may answer (and refuse)
    // before the body is sent, and an unfinished request holds its socket.
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      source.destroy();
      req.destroy();
      settle();
    };
    const fail = (err: unknown) => finish(() => reject(err));
    const timer = setTimeout(
      () => fail(new UploadError(`the upload to the blob store did not finish within ${timeoutMs}ms`)),
      timeoutMs,
    );

    req.on('error', fail);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      let held = 0;
      res.on('data', (chunk: Buffer) => {
        if (held >= ERROR_BODY_SNIPPET) return;
        chunks.push(chunk);
        held += chunk.length;
      });
      res.on('error', fail);
      res.on('end', () => finish(() => resolve({
        status: res.statusCode as number,
        body: Buffer.concat(chunks).toString().slice(0, ERROR_BODY_SNIPPET),
      })));
    });
    pipeline(source, req, (err) => { if (err) fail(err); });
  });
}

/**
 * PUT the file at `request.path` to `request.url`.
 *
 * Resolves with the bytes streamed and the blob store's status; THROWS on every
 * failure, with a message safe to log. Nothing is retried: a fresh URL is the
 * only repair for the common failure (a stale or mismatched signature).
 */
export async function uploadToBlobStore(
  request: BlobUploadRequest,
  options: BlobUploadOptions = {},
): Promise<BlobUploadOutcome> {
  try {
    const target = parseTarget(request.url);
    const { file, bytes } = await resolveConfined(options.root ?? ATTACHMENT_DOWNLOAD_ROOT, request.path);
    const answer = await putFile(
      target, file, bytes, request.contentType, options.timeoutMs ?? BLOB_UPLOAD_TIMEOUT_MS,
    );
    if (answer.status < 200 || answer.status >= 300) {
      throw new UploadError(`the blob store refused the upload with ${answer.status}: ${answer.body}`.trim());
    }
    return { bytes, status: answer.status };
  } catch (err) {
    const message = err instanceof UploadError
      ? err.message
      : `the upload to the blob store did not complete: ${(err as Error).message}`;
    throw new Error(withoutUrlSecrets(message, request.url));
  }
}
