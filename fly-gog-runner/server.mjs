// fly-gog-runner: a tiny HTTP service that runs the `gog` CLI on a Fly.io
// scale-to-zero Machine. A Cloudflare Worker connector forwards fully-assembled
// `gog` arg-arrays here over authenticated HTTPS; this box is the only place the
// `gog` binary actually runs. Single-user (the operator's own Google account);
// gog's auth lives on a persistent Fly volume mounted at GOG_HOME.
//
// Zero npm dependencies — node built-ins only.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';

// Cap the request body we'll buffer. This is load-bearing for file args: the
// WHOLE POST body is buffered against this ceiling, so it must comfortably
// exceed the per-file payload cap below — otherwise a max-size payload would
// fail as "request body too large" instead of hitting the precise per-flag
// error. Comfortably, not merely, because JSON encoding INFLATES the payload:
// quote- and newline-heavy HTML roughly doubles, and control characters expand
// 6x as \uXXXX. 4x headroom covers the realistic HTML case; a pathological
// all-control-character 8 MB payload can still trip the body cap first, which
// is an acceptable trade for a bounded buffer.
//
// MEMORY: this ceiling is what sizes the Machine. readBody buffers the chunks,
// Buffer.concat copies them, .toString() copies again and JSON.parse
// materializes the parsed strings — call it ~4 live copies, so ~128 MB per
// max-size request, times concurrency (requests DO overlap here), plus
// EXEC_MAX_BUFFER for gog's stdout (~160 MB/request total). fly.toml provisions
// 512 MB against this arithmetic — two concurrent worst-case requests plus
// Node's baseline, with headroom. Raising this constant without raising `memory` there invites
// an OOM kill, and a Fly OOM severs the socket into precisely the opaque
// gateway 502 that installGracefulShutdown below exists to eliminate.
export const MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MB

// /run arg-array validation limits.
const MAX_ARGS = 64;

// Plain string args go through argv. The Linux kernel caps a SINGLE argv string
// at MAX_ARG_STRLEN = 131072 bytes (independent of ARG_MAX), and exceeding it
// yields an opaque E2BIG rather than a useful message. 64 KiB sits safely under
// that ceiling while unblocking legitimately large args — `sheets update
// --values-json` and friends, which gog exposes no file variant for. Anything
// bigger must arrive as a GogFileArg and leave argv entirely.
export const MAX_ARG_LEN = 64 * 1024; // 64 KiB, measured in BYTES
const NUL = '\u0000';

// A GogFileArg's payload never touches argv — it is written to a private temp
// file and only the PATH is passed to gog — so it gets a far larger cap.
export const MAX_FILE_ARG_BYTES = 8 * 1024 * 1024; // 8 MB

// A flag NAME, without leading dashes: rejects '=', whitespace, a leading dash,
// and path separators.
const FLAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

// A temp-file extension, without the dot. This value reaches a filesystem path,
// so it is confined to a short alphanumeric token: '..', '/', and NUL cannot
// pass, which is what keeps path traversal out of the materialized filename.
const EXT_PATTERN = /^[A-Za-z0-9]{1,16}$/;

const DEFAULT_EXT = 'txt';

// How long to let in-flight requests finish after a shutdown signal before
// giving up. Fly autostops an idle Machine with SIGINT; a `gog` call is capped
// at EXEC_TIMEOUT_MS, so this budget covers the slowest legitimate request.
export const SHUTDOWN_TIMEOUT_MS = 35_000;

// execFn defaults.
const EXEC_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER = 32 * 1024 * 1024; // 32 MB

// Strip ambient secrets from the child env so gog only sees its own configured
// credentials (defense-in-depth; the Worker never forwards these, but the box
// itself may have other secrets in scope). GOG_HOME and PATH are preserved.
// RUNNER_KEY is our OWN bearer secret — since /run executes arbitrary gog
// subcommands (including the `gog <service> run` escape hatches), the key must
// never leak into the child environment. PORT is irrelevant to gog.
export function sanitizedEnv() {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'GOG_ACCESS_TOKEN') continue;
    if (key === 'GOOGLE_APPLICATION_CREDENTIALS') continue;
    if (key === 'RUNNER_KEY') continue;
    if (key === 'PORT') continue;
    if (/(_TOKEN|_SECRET|_API_KEY|_PRIVATE_KEY)$/.test(key)) continue;
    result[key] = value;
  }
  return result;
}

// Default runner: execFile('gog', args) with no shell. Resolves { stdout } on
// exit 0; rejects with an Error carrying `.stderr` on failure/timeout. No
// redaction here — redaction happens at the Worker boundary; this box returns
// raw stdout over HTTPS to the trusted Worker.
function defaultExecFn(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'gog',
      args,
      {
        env: sanitizedEnv(),
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: EXEC_MAX_BUFFER,
        ...opts,
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout });
      },
    );
  });
}

// Constant-time bearer comparison. Guards length first so timingSafeEqual never
// throws on unequal-length buffers.
function bearerMatches(header, runnerKey) {
  if (typeof header !== 'string') return false;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(runnerKey);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

// Validate one file arg — a { kind:'file', flag, contents, ext? } object per the
// wire contract. Returns an error message string, or null if valid.
function validateFileArg(arg) {
  if (arg.kind !== 'file') {
    return "each arg must be a string or a { kind: 'file' } object";
  }
  if (typeof arg.flag !== 'string') return 'file arg flag must be a string';
  if (!FLAG_PATTERN.test(arg.flag)) {
    return `file arg flag ${JSON.stringify(arg.flag)} is not a bare flag name ` +
      '(no leading dash, no "=", no whitespace, no path separators)';
  }
  if (typeof arg.contents !== 'string') return `${arg.flag} contents must be a string`;
  if (arg.ext !== undefined && (typeof arg.ext !== 'string' || !EXT_PATTERN.test(arg.ext))) {
    return `file arg ext ${JSON.stringify(arg.ext)} must be a short alphanumeric token`;
  }
  const bytes = Buffer.byteLength(arg.contents, 'utf8');
  if (bytes > MAX_FILE_ARG_BYTES) {
    return `${arg.flag} payload is ${bytes} bytes; the maximum is ${MAX_FILE_ARG_BYTES} bytes`;
  }
  return null;
}

// Validate a /run arg-array. An element is EITHER a plain string (passed through
// argv, hence the tight MAX_ARG_LEN) or a GogFileArg object (materialized to a
// temp file, hence the much larger MAX_FILE_ARG_BYTES). Returns an error message
// string, or null if valid. Every size is measured in BYTES, not characters —
// the kernel's argv ceiling and the filesystem both count bytes, and a UTF-8
// payload of N characters can be up to 4N bytes.
//
// We use execFile (no shell), so shell metacharacters are inert; NUL is still
// rejected defensively in the strings that become argv.
function validateArgs(args) {
  if (!Array.isArray(args)) return 'args must be an array';
  if (args.length === 0) return 'args must be non-empty';
  if (args.length > MAX_ARGS) return `args must have at most ${MAX_ARGS} elements`;
  for (const arg of args) {
    if (typeof arg === 'string') {
      const bytes = Buffer.byteLength(arg, 'utf8');
      if (bytes > MAX_ARG_LEN) {
        return `arg is ${bytes} bytes; the maximum for a plain arg is ${MAX_ARG_LEN} bytes ` +
          '(send larger payloads as a file arg)';
      }
      if (arg.includes(NUL)) return 'args must not contain NUL bytes';
      continue;
    }
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
      return "each arg must be a string or a { kind: 'file' } object";
    }
    const invalid = validateFileArg(arg);
    if (invalid) return invalid;
  }
  return null;
}

// Thrown when writing a payload to its temp file fails (ENOSPC on the container
// rootfs is the realistic case now that a single payload can reach 8 MB).
//
// This is a DISTINCT class because /run's catch block classifies by it. Without
// it, a full disk surfaces as `422 { retryable: false }` — the response that
// explicitly means "gog ran and exited non-zero, do not retry" — attributing a
// filesystem failure to gog and telling the caller never to try again. That is
// the same transient-vs-deterministic confusion the 502->422 change fixed, in
// the opposite direction: here the failure IS transient and IS worth retrying.
export class MaterializationError extends Error {
  constructor(cause) {
    super(`failed to write a file arg to disk: ${(cause && cause.message) || cause}`);
    this.name = 'MaterializationError';
    this.cause = cause;
  }
}

// Materialize any GogFileArg elements to private temp files, hand the resulting
// all-string arg array to `fn`, and ALWAYS remove the temp dirs afterwards.
//
// Cleanup runs in a finally so it covers success, a non-zero gog exit, a timeout
// and a thrown error alike: a leaked temp file holds user email content, so a
// skipped cleanup is a data-exposure bug, not untidiness.
export async function withMaterializedArgs(args, fn, { log = defaultLog } = {}) {
  const dirs = [];
  try {
    let resolved;
    try {
      resolved = [];
      for (const arg of args) {
        if (typeof arg === 'string') {
          resolved.push(arg);
          continue;
        }
        const dir = await mkdtemp(path.join(os.tmpdir(), 'gog-arg-'));
        dirs.push(dir);
        // mkdtemp(3) already creates 0700, but an explicit chmod makes the
        // guarantee independent of the platform and of the process umask.
        await chmod(dir, 0o700);
        const file = path.join(dir, `body.${arg.ext ?? DEFAULT_EXT}`);
        await writeFile(file, arg.contents, { encoding: 'utf8', mode: 0o600 });
        resolved.push(`--${arg.flag}=${file}`);
      }
    } catch (err) {
      // Tag it here, where we still know the failure came from the filesystem
      // and not from gog. Any dirs created before the failure are still in
      // `dirs`, so the finally below cleans them up.
      throw new MaterializationError(err);
    }
    return await fn(resolved);
  } finally {
    // allSettled, not a sequential await loop: `force: true` only suppresses
    // ENOENT, so a real rm failure on the first dir would otherwise (a) skip
    // every remaining dir, leaking user content, and (b) REPLACE the in-flight
    // error — the actual gog failure — with the rm error. Settling every rm and
    // logging failures preserves both.
    const results = await Promise.allSettled(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        log(`temp dir cleanup failed for ${dirs[i]}: ` +
          `${(result.reason && result.reason.message) || result.reason}`);
      }
    });
  }
}

// Read the full request body (capped). Resolves the raw string, or rejects with
// an Error tagged `.tooLarge` if the cap is exceeded. Exported for testing.
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        // Stop buffering immediately (no memory growth), but do NOT destroy the
        // socket here — the caller must first write the 400 response, otherwise
        // the client sees a connection reset instead of the error, and must then
        // hand the request to drainAndDestroy. Subsequent 'data' events are
        // ignored via `done`.
        const err = new Error('request body too large');
        err.tooLarge = true;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

// How long to keep discarding an over-cap upload before severing the socket.
// Bounds the cost of a client that streams forever; no memory is consumed while
// draining, only bandwidth.
export const DRAIN_UPLOAD_MS = 5_000;

// Tear down the connection carrying an oversized upload WITHOUT destroying the
// 400 we just wrote.
//
// THE RACE THIS FIXES: hanging up the instant the cap trips looks like
// "respond, then close", but the client is still UPLOADING. Cut the socket
// underneath it — by req.destroy(), or equivalently by `Connection: close`,
// which makes Node end the socket as soon as the response flushes — and the
// client's next write takes an EPIPE/ECONNRESET. Node's own http client
// responds to that by destroying its socket, discarding any response bytes it
// has received but not yet parsed. So the caller sees a transport error instead
// of the precise 400, which is exactly what the response-first ordering exists
// to prevent. Measured at roughly 1 run in 6 of the end-to-end test below.
//
// So: keep reading and discarding instead. readBody's `done` guard already
// stopped buffering and resume() adds no listener that would retain chunks, so
// this costs bandwidth and no memory. Once the request ends, the client has
// finished writing and read its response, and the close is clean. The timer
// bounds a client that never stops sending.
export function drainAndDestroy(req, { timeoutMs = DRAIN_UPLOAD_MS } = {}) {
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    req.destroy();
  };
  const timer = setTimeout(done, timeoutMs);
  timer.unref?.();
  req.on('end', done);
  req.on('error', done);
  req.resume();
}

// One-line request log. Deliberately records only the gog service+subcommand
// and the arg COUNT — operands (message ids, attachment ids, `gog <svc> run`
// passthrough flags) never reach the log. The `typeof a === 'string'` filter is
// also what keeps a GogFileArg out: its `contents` is a user's email body, and
// must never reach a log line under any circumstances.
function describeArgs(args) {
  if (!Array.isArray(args) || args.length === 0) return 'no args';
  const head = args.filter((a) => typeof a === 'string' && !a.startsWith('-')).slice(0, 2);
  return `${head.join(' ') || 'gog'} (${args.length} args)`;
}

function defaultLog(line) {
  // stdout is fine here — this is a standalone service, not an stdio MCP server.
  console.log(line);
}

export function createServer({ runnerKey, execFn = defaultExecFn, log = defaultLog } = {}) {
  if (!runnerKey || typeof runnerKey !== 'string') {
    throw new Error('RUNNER_KEY is required; refusing to start without an auth key');
  }

  const server = http.createServer(async (req, res) => {
    const { method } = req;

    // Once a shutdown signal has landed, refuse NEW work rather than starting a
    // `gog` call we cannot finish. A 503 with a retryable flag is a far better
    // caller experience than the severed socket Fly's proxy turns into a 502.
    if (server.shuttingDown) {
      res.setHeader('Connection', 'close');
      sendJson(res, 503, { error: 'gog-runner is shutting down', retryable: true });
      return;
    }

    server.inFlight += 1;
    const startedAt = Date.now();
    let logged = false;
    // Per-REQUEST, deliberately closed over rather than hung off `server`:
    // requests overlap (a slow attachment download runs while a fast metadata
    // read starts and finishes), so server-wide state would be overwritten by
    // whichever request is newest and cleared by whichever finishes first.
    let argsDesc = '';
    const finish = () => {
      if (logged) return;
      logged = true;
      server.inFlight -= 1;
      log(
        `${method} ${(req.url ?? '').split('?')[0]} ${res.statusCode} ` +
        `${Date.now() - startedAt}ms ${argsDesc}`.trimEnd(),
      );
    };
    res.on('finish', finish);
    res.on('close', finish);

    // Strip any query string for routing.
    const url = (req.url ?? '').split('?')[0];

    // UNAUTHENTICATED liveness — runs no gog.
    if (method === 'GET' && url === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    const authed = bearerMatches(req.headers['authorization'], runnerKey);

    // Bearer-required key-verification endpoint (does not depend on gog).
    if (method === 'GET' && url === '/health') {
      if (!authed) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // Bearer-required exec endpoint.
    if (method === 'POST' && url === '/run') {
      if (!authed) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      let raw;
      try {
        raw = await readBody(req);
      } catch (err) {
        if (err && err.tooLarge) {
          // Write the 400 first, THEN drop the (still-incoming) oversized
          // upload. Deliberately NOT `Connection: close`: that makes Node end
          // the socket the moment the response flushes, while the client is
          // still writing — the client then takes an EPIPE and destroys its own
          // socket, discarding the response it had not parsed yet. See
          // drainAndDestroy.
          sendJson(res, 400, { error: 'request body too large' });
          drainAndDestroy(req);
          return;
        }
        sendJson(res, 400, { error: 'failed to read request body' });
        return;
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: 'body must be valid JSON' });
        return;
      }

      const args = body && body.args;
      const invalid = validateArgs(args);
      if (invalid) {
        sendJson(res, 400, { error: invalid });
        return;
      }

      argsDesc = describeArgs(args);
      try {
        const { stdout } = await withMaterializedArgs(
          args,
          (resolved) => execFn(resolved),
          { log },
        );
        sendJson(res, 200, { stdout });
      } catch (err) {
        // A file arg never made it to disk, so gog never ran. This is OUR box
        // failing (a full or read-only rootfs), not the caller's args failing:
        // 5xx + retryable, so the wrapper's transient-error handling applies and
        // the same request can succeed once the box recovers.
        if (err instanceof MaterializationError) {
          sendJson(res, 500, { error: err.message, retryable: true });
          return;
        }
        // 422, NOT 502. `gog` ran on this box and exited non-zero: the request
        // was delivered and executed, so nothing upstream is broken and the
        // caller must NOT retry — the same args will fail identically.
        //
        // This used to be 502, which is the SAME code Fly's edge proxy returns
        // when it cannot reach the Machine at all. Those two failures are
        // opposites (one deterministic, one transient) and collapsing them onto
        // one status forced the client to guess from the body. Worse, `502`
        // matches the wrapper's TRANSIENT_ERROR_PATTERN (/\b5\d\d\b/), so every
        // deterministic gog error — a bad attachment token, an --out path that
        // does not exist on this box — came back advising "retry the same
        // call", producing an endless retry loop that could never succeed.
        // Keeping 5xx exclusively for infrastructure makes the status alone
        // carry the classification.
        sendJson(res, 422, {
          error: (err && err.message) || 'gog failed',
          stderr: (err && err.stderr) || '',
          retryable: false,
        });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.inFlight = 0;
  server.shuttingDown = false;
  return server;
}

// Drain in-flight requests before exiting.
//
// THE BUG THIS FIXES: Fly stops an idle Machine (auto_stop_machines) by sending
// SIGINT. Node's default SIGINT action is immediate termination — the Machine's
// event log shows `exit_code=130` (128+SIGINT) — which severs every in-flight
// connection. Fly's proxy turns that severed upstream into an HTTP 502 whose
// body is Fly's own HTML, not our JSON, so the connector could only report a
// bare "gog-runner HTTP 502". Long requests (a Gmail attachment download) sit in
// that window far longer than a metadata read, which is why attachments failed
// while searches didn't.
//
// Returns a disposer that removes the signal listeners (used by tests).
export function installGracefulShutdown(server, {
  signals = ['SIGINT', 'SIGTERM'],
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  log = defaultLog,
  exit = (code) => process.exit(code),
} = {}) {
  const onSignal = (signal) => {
    if (server.shuttingDown) return; // idempotent: Fly may send SIGINT then SIGTERM
    server.shuttingDown = true;
    log(`${signal} received; draining ${server.inFlight} in-flight request(s)`);

    const timer = setTimeout(() => {
      log(`drain timed out after ${timeoutMs}ms with ${server.inFlight} in flight; forcing exit`);
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    // server.close() waits for ALL sockets, including idle keep-alive ones that
    // will never send another byte. closeIdleConnections() drops those while
    // leaving active requests alone — but a socket is only "idle" once its
    // response has fully flushed, so a single call at signal time misses any
    // connection still mid-response. Sweep until the server actually closes.
    const sweep = setInterval(() => server.closeIdleConnections?.(), 100);
    sweep.unref?.();

    server.close(() => {
      clearTimeout(timer);
      clearInterval(sweep);
      log('drain complete; exiting cleanly');
      exit(0);
    });
    server.closeIdleConnections?.();
  };

  const handlers = signals.map((signal) => {
    const handler = () => onSignal(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  return () => { for (const [signal, handler] of handlers) process.off(signal, handler); };
}

// Start the server when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const runnerKey = process.env.RUNNER_KEY;
  const port = Number(process.env.PORT) || 8080;
  const server = createServer({ runnerKey });
  installGracefulShutdown(server);
  server.listen(port, () => {
    console.log(`fly-gog-runner listening on :${port}`);
  });
}
