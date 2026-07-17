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

export function createServer({ runnerKey, execFn = defaultExecFn } = {}) {
  if (!runnerKey || typeof runnerKey !== 'string') {
    throw new Error('RUNNER_KEY is required; refusing to start without an auth key');
  }

  return http.createServer(async (req, res) => {
    const { method } = req;
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

      try {
        const { stdout } = await execFn(args);
        sendJson(res, 200, { stdout });
      } catch (err) {
        sendJson(res, 502, {
          error: (err && err.message) || 'gog failed',
          stderr: (err && err.stderr) || '',
        });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

// Start the server when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const runnerKey = process.env.RUNNER_KEY;
  const port = Number(process.env.PORT) || 8080;
  const server = createServer({ runnerKey });
  server.listen(port, () => {
    // stdout is fine here — this is a standalone service, not an stdio MCP server.
    console.log(`fly-gog-runner listening on :${port}`);
  });
}
