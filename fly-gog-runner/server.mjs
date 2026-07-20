// fly-gog-runner: a tiny HTTP service that runs the `gog` CLI on a Fly.io
// scale-to-zero Machine. A Cloudflare Worker connector forwards fully-assembled
// `gog` arg-arrays here over authenticated HTTPS; this box is the only place the
// `gog` binary actually runs. Single-user (the operator's own Google account);
// gog's auth lives on a persistent Fly volume mounted at GOG_HOME.
//
// Zero npm dependencies — node built-ins only.

import http from 'node:http';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';

// Cap the request body we'll buffer. /run bodies are tiny arg-arrays; anything
// larger is malformed or hostile.
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

// /run arg-array validation limits.
const MAX_ARGS = 64;
const MAX_ARG_LEN = 4096;
const NUL = '\u0000';

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

// Validate a /run arg-array: non-empty array of strings, length <= MAX_ARGS,
// each string <= MAX_ARG_LEN chars, and no NUL byte. Returns an error message
// string, or null if valid. We use execFile (no shell), so shell metacharacters
// are inert; NUL is still rejected defensively.
function validateArgs(args) {
  if (!Array.isArray(args)) return 'args must be an array';
  if (args.length === 0) return 'args must be non-empty';
  if (args.length > MAX_ARGS) return `args must have at most ${MAX_ARGS} elements`;
  for (const arg of args) {
    if (typeof arg !== 'string') return 'each arg must be a string';
    if (arg.length > MAX_ARG_LEN) return `each arg must be at most ${MAX_ARG_LEN} chars`;
    if (arg.includes(NUL)) return 'args must not contain NUL bytes';
  }
  return null;
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
        // the client sees a connection reset instead of the error. Subsequent
        // 'data' events are ignored via `done`.
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

// One-line request log. Deliberately records only the gog service+subcommand
// and the arg COUNT — operands (message ids, attachment ids, `gog <svc> run`
// passthrough flags) never reach the log.
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
          // Write the 400 first, THEN drop the (still-incoming) oversized upload.
          sendJson(res, 400, { error: 'request body too large' });
          req.destroy();
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
        const { stdout } = await execFn(args);
        sendJson(res, 200, { stdout });
      } catch (err) {
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
