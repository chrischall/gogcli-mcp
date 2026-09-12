import { readEnvVar } from '@chrischall/mcp-utils';

/**
 * Ask the gog runner to stream a file off ITS disk to a signed blob-store URL.
 *
 * ## Why the runner and not this process
 *
 * Under the hosted connector this child is a FORWARDER: `run()` POSTs an
 * arg-array to fly-gog-runner, the Google refresh token lives in that app's
 * keyring, and `gog gmail attachment --out` writes the file to THAT box's disk.
 * The child never sees a byte, so the runner is the only party that can send
 * one anywhere. That is the same seam `deliverViaDrive` already uses — `gog
 * drive upload <path>` pushes bytes from the runner's disk to a remote
 * destination with the child out of the way — with a different destination.
 *
 * Routing them through the child instead would cap out near 24 MB against
 * `/run`'s 32 MB body envelope and cost a ~31 MB base64 string plus a decoded
 * copy, for bytes nobody here reads.
 *
 * ## What the runner does with it
 *
 * `POST /upload` (fly-gog-runner/server.mjs) confines `path` to the attachment
 * directory, refuses anything past the blob store's own 100 MiB ceiling before
 * dialling, and PUTs the file with `Content-Length` from its own size and the
 * `Content-Type` header byte for byte as given — the PUT signature commits to
 * it. Its statuses carry the classification: `422` is deterministic (re-mint,
 * do not retry), `502` is the far side or the transfer, `400`/`404` are this
 * request. All of them are failures here; none of them is retried from this
 * side, because a fresh URL is the only repair for the common one.
 */

/**
 * The deadline this side puts on the exchange.
 *
 * The runner has one of its own (`UPLOAD_TIMEOUT_MS`, 120 s) but it is an
 * INACTIVITY timer spent through `req.setTimeout` — it bounds a socket that has
 * gone quiet, never a transfer that keeps dribbling — so nothing else stands
 * between a wedged upload and an MCP request that never answers.
 *
 * Longer than `/run`'s 30 s because this is not a `gog` invocation: it is up to
 * 100 MiB leaving a Fly machine, and firing before the runner can report a real
 * failure would turn "the blob store refused the signature" into an opaque
 * timeout — the same reason `makeFlyExecutor` sits its deadline above the
 * backend's.
 */
export const RUNNER_UPLOAD_TIMEOUT_MS = 90_000;

export interface BlobUploadRequest {
  /** The file to send, resolved on the RUNNER's disk. */
  path: string;
  /** The signed PUT URL. A credential — never log it, never echo it. */
  url: string;
  /** Sent as `Content-Type` byte for byte; the PUT signature commits to it. */
  contentType: string;
}

export interface BlobUploadOutcome {
  /** Bytes the runner actually streamed — the file's own size, not a claim. */
  bytes?: number;
  /** The blob store's status, as the runner observed it. */
  status?: number;
}

export interface BlobUploadOptions {
  /** Where the runner's endpoint and key are read from. Injected by tests. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Remove a signed URL, and the bare signature inside it, from a message.
 *
 * Everything this module throws is expected to be logged, and a failure's text
 * is routinely a third party's: the runner scrubs its own words, but the blob
 * store's error is quoted through it and an HTTP client's rejection may name
 * the URL it was dialling. Both shapes are removed, because either left
 * standing is the whole credential — the signature is what `sig=` carries, and
 * the rest of the URL is public.
 *
 * The empty needle is guarded rather than assumed away: `split('')` cuts a
 * message into single characters and interleaves the replacement between every
 * one of them.
 */
function withoutUrlSecrets(message: string, url: string): string {
  let out = url ? message.split(url).join('<signed url>') : message;
  const signature = /[?&]sig=([^&#]+)/.exec(url)?.[1];
  if (signature) out = out.split(signature).join('<signature>');
  return out;
}

/**
 * Stream the file at `request.path` (on the runner) to `request.url`.
 *
 * Resolves with what the runner reported; THROWS on every failure, with a
 * message safe to log. Both variables are required — the same both-or-neither
 * rule `useRemoteGogRunner` applies, for the same reason: a URL with no key
 * sends unauthenticated requests the runner rejects, and a key with no URL is a
 * credential configured for nothing.
 */
export async function uploadToBlobStore(
  request: BlobUploadRequest,
  options: BlobUploadOptions = {},
): Promise<BlobUploadOutcome> {
  const env = options.env ?? process.env;
  // The shared reader, as everywhere else: blanks, unexpanded `${...}`
  // placeholders and the literal "undefined"/"null" are all unset.
  const endpoint = readEnvVar('GOG_RUNNER_URL', { env });
  const key = readEnvVar('GOG_RUNNER_KEY', { env });
  if (!endpoint || !key) {
    throw new Error(
      'no gog runner is configured (GOG_RUNNER_URL + GOG_RUNNER_KEY, both or neither), and the ' +
      'attachment bytes are on the runner\'s disk rather than here — so nothing on this side can send them',
    );
  }

  let response: { ok: boolean; status: number; text(): Promise<string> };
  try {
    response = await fetch(`${endpoint.replace(/\/+$/, '')}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: request.path, url: request.url, contentType: request.contentType }),
      signal: AbortSignal.timeout(RUNNER_UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(withoutUrlSecrets(
      `the upload to the blob store did not complete: ${err instanceof Error ? err.message : String(err)}`,
      request.url,
    ));
  }

  // Inside a try of its own: the response ARRIVING is not the body arriving,
  // and a severed or truncated one rejects here. That rejection is a transport
  // failure like the dial above and is scrubbed like one — this module's
  // contract is that nothing it throws carries the URL, and a guarantee with a
  // hole in it is not one.
  let raw: string;
  try {
    raw = await response.text();
  } catch (err) {
    throw new Error(withoutUrlSecrets(
      `the upload to the blob store did not complete: the runner's answer could not be read: ` +
      `${err instanceof Error ? err.message : String(err)}`,
      request.url,
    ));
  }
  let body: { error?: string; bytes?: number; status?: number } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    // A proxy's HTML error page, or a truncated answer. Quoted, never parsed
    // into a decision — the status is the part that classifies.
    body = { error: raw };
  }
  if (!response.ok) {
    // The runner's own status says which layer failed (422 refused / 502 far
    // side / 400 this request); `body.status` is the blob store's verdict when
    // there was one. Both are reported, because "403 inside a 422" is what
    // tells a stale signature from a broken runner.
    throw new Error(withoutUrlSecrets(
      `the runner could not store the attachment (HTTP ${response.status}` +
      `${body.status ? `, blob store ${body.status}` : ''}): ${body.error ?? 'no reason given'}`,
      request.url,
    ));
  }
  return { bytes: body.bytes, status: body.status };
}
