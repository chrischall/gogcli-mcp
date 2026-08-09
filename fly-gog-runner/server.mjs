// fly-gog-runner: a tiny HTTP service that runs the `gog` CLI on a single Fly.io
// Machine. A Cloudflare Worker connector forwards fully-assembled
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
// giving up. Fly stops a Machine with SIGINT — on deploys, host migrations, and
// autostop of any Machine above fly.toml's min_machines_running floor; a `gog`
// call is capped at EXEC_TIMEOUT_MS, so this budget covers the slowest
// legitimate request.
export const SHUTDOWN_TIMEOUT_MS = 35_000;

// execFn defaults.
const EXEC_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER = 32 * 1024 * 1024; // 32 MB

// --- GET /health/google: the layer-2 (Google) probe --------------------------
//
// `--check` is the load-bearing flag: it makes gog perform a REAL token refresh
// against Google rather than reading the keyring, so the answer reflects what
// the next /run will actually get. `--json` makes it parseable. This runs as the
// BOX (no accessToken), because the box's stored credential is exactly the one
// under suspicion.
export const GOOGLE_PROBE_ARGS = ['auth', 'list', '--check', '--json'];

// A dedicated budget, deliberately well under EXEC_TIMEOUT_MS. A status probe
// that hangs for 30 s is worse than one that says "I could not measure": the
// caller is a health check with its own, shorter patience.
export const GOOGLE_PROBE_TIMEOUT_MS = 10_000;

// Every cause this endpoint can report, as a CLOSED vocabulary.
//
// Nothing gog prints is ever relayed. That is a security property, not
// tidiness: this response is destined for status text and log aggregators, and
// a fixed set of literals is structurally incapable of carrying a token out of
// the child process — where a redaction regex would merely be probable. When a
// human needs gog's actual words, /run already returns stderr verbatim.
export const PROBE_CAUSES = {
  invalidGrant:
    'invalid_grant: the stored Google refresh token is expired or revoked — re-authorize the account',
  timedOut: 'the Google probe timed out before gog answered',
  failed: 'the Google probe could not be run',
  unparseable: 'gog auth list --check returned unrecognized output',
  noAccounts: 'no Google account is authorized on this machine',
  invalidAccount: 'a stored Google account failed a live token check',
  unknownValidity: 'gog did not report token validity',
  notChecked: 'gog reported an account it explicitly did not check',
};

// Which causes are facts about the CREDENTIAL, and which are facts about the
// PROBE. This partition is the whole of the `measured` field, and it is the
// reason a caller can tell "Google was asked and said no" from "nothing asked".
//
// Collapsing the two — which is what a bare `ok:false` does — is the defect this
// endpoint exists to delete, with the alarm inverted: an operator grepping for
// "the credential is dead" would find a line that means "gog is not installed".
//
// MEASURED: the probe reached a definite answer about the credential on this
// volume. `invalidGrant` and `invalidAccount` are Google's own verdict;
// `noAccounts` is gog answering successfully that there is no credential to
// refuse — an answer, not a failure to ask.
export const MEASURED_CAUSES = new Set([
  PROBE_CAUSES.invalidGrant,
  PROBE_CAUSES.invalidAccount,
  PROBE_CAUSES.noAccounts,
]);

// UNMEASURED: nothing about Google was learned. The probe never ran
// (`failed` — no `gog` on PATH, no credentials.json on the volume), ran out of
// time (`timedOut`), produced output we cannot read (`unparseable`), or ran and
// declined to answer the question (`unknownValidity`, `notChecked`).
export const UNMEASURED_CAUSES = new Set([
  PROBE_CAUSES.timedOut,
  PROBE_CAUSES.failed,
  PROBE_CAUSES.unparseable,
  PROBE_CAUSES.unknownValidity,
  PROBE_CAUSES.notChecked,
]);

// Build the failure answer for one cause.
//
// `measured` is derived from the partition rather than passed in, so the two
// cannot drift apart at a call site. Membership is required, not assumed: an
// unrecognised cause resolves to `measured: false`, the direction that can only
// ever under-claim. Over-claiming is the failure mode with a cost.
function probeFailure(cause, accounts = []) {
  return { ok: false, measured: MEASURED_CAUSES.has(cause), accounts, error: cause };
}

const INVALID_GRANT_RE = /invalid_grant/i;

// Map a rejected probe onto one of the causes above. Reads err.stderr/err.message
// only to CLASSIFY; neither string is returned or logged.
export function classifyProbeError(err) {
  const text = `${(err && err.stderr) || ''}\n${(err && err.message) || ''}`;
  if (INVALID_GRANT_RE.test(text)) return PROBE_CAUSES.invalidGrant;
  if ((err && err.killed) || /ETIMEDOUT|timed? ?out/i.test(text)) return PROBE_CAUSES.timedOut;
  return PROBE_CAUSES.failed;
}

// Turn gog's `auth list --check --json` stdout into the probe's answer.
//
// `ok` means "the Google layer is healthy" — an account exists AND every one of
// them just refreshed successfully. It deliberately does NOT mean "the probe
// ran": a probe that ran and found a dead token is the exact case this endpoint
// exists to surface, and reporting it as ok would rebuild the defect (a status
// that claims health it did not measure) one level up.
//
// `measured` answers the strictly prior question — did anything find out? — and
// it is the field callers must read FIRST. `ok:false, measured:false` is "I
// could not ask"; only `ok:false, measured:true` is "Google said no". See the
// PROBE_CAUSES partition above.
//
// Only email/created_at/valid/error are carried forward, and `error` only as a
// classification. `scopes` and `subject` describe the credential itself and
// have no place in a health response.
export function summarizeAuthProbe(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return probeFailure(PROBE_CAUSES.unparseable);
  }
  if (!parsed || !Array.isArray(parsed.accounts)) {
    return probeFailure(PROBE_CAUSES.unparseable);
  }

  const accounts = parsed.accounts.map((a) => {
    const entry = {};
    if (typeof a?.email === 'string') entry.email = a.email;
    if (typeof a?.created_at === 'string') entry.created_at = a.created_at;
    if (typeof a?.valid === 'boolean') entry.valid = a.valid;
    // Reduced to a boolean-ish marker: the presence of an error, not its text.
    if (a?.error) entry.error = INVALID_GRANT_RE.test(String(a.error)) ? 'invalid_grant' : 'error';
    return entry;
  });

  if (accounts.length === 0) return probeFailure(PROBE_CAUSES.noAccounts, accounts);

  const dead = accounts.filter((a) => a.valid === false);
  if (dead.length > 0) {
    return probeFailure(
      dead.some((a) => a.error === 'invalid_grant')
        ? PROBE_CAUSES.invalidGrant
        : PROBE_CAUSES.invalidAccount,
      accounts,
    );
  }
  // An entry that survived the `valid === false` filter and STILL carries an
  // error marker is gogcli telling us it did not perform the check:
  // `annotateAuthListCheck` (internal/cmd/auth_list_helpers.go) stamps a
  // service-account entry `valid:true, error:"service account (not checked)"`.
  // Taking that `valid:true` at face value would report health from a
  // credential nothing measured — this endpoint's own defect, one level down —
  // and would produce the internally inconsistent "healthy account carrying an
  // error marker". `ok` is an AND across accounts, so one unchecked entry is
  // enough to make the layer unmeasured.
  if (accounts.some((a) => a.error !== undefined)) {
    return probeFailure(PROBE_CAUSES.notChecked, accounts);
  }
  if (!accounts.every((a) => a.valid === true)) {
    return probeFailure(PROBE_CAUSES.unknownValidity, accounts);
  }
  // Health is a claim only a measurement can license, so the two travel together.
  return { ok: true, measured: true, accounts };
}

// Strip ambient secrets from the child env so gog only sees its own configured
// credentials (defense-in-depth; the Worker never forwards these, but the box
// itself may have other secrets in scope). GOG_HOME and PATH are preserved.
// RUNNER_KEY is our OWN bearer secret — since /run executes arbitrary gog
// subcommands (including the `gog <service> run` escape hatches), the key must
// never leak into the child environment. PORT is irrelevant to gog.
//
// `accessToken` is the ONE credential that may be added back, and only because
// it arrived with a request rather than from this box (#230). This machine
// holds a single Google identity on its volume, so without this every caller of
// a hosted gog MCP acts as whoever seeded it; `gog` already prefers a
// directly-passed token over its store, so handing it one for a single
// invocation is all "act as the caller" requires.
//
// The ambient GOG_ACCESS_TOKEN stays stripped regardless — note the `continue`
// below still runs. A variable on this box is shared by every request, so
// honouring one would rebuild the shared-identity problem from the other
// direction. Only a value that belongs to one call may act for one call.
export function sanitizedEnv(accessToken) {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'GOG_ACCESS_TOKEN') continue;
    if (key === 'GOOGLE_APPLICATION_CREDENTIALS') continue;
    if (key === 'RUNNER_KEY') continue;
    if (key === 'PORT') continue;
    if (/(_TOKEN|_SECRET|_API_KEY|_PRIVATE_KEY)$/.test(key)) continue;
    result[key] = value;
  }
  if (accessToken) result.GOG_ACCESS_TOKEN = accessToken;
  return result;
}

// How long a Google OAuth access token may be. Real ones are ~1–2 KB; the cap
// exists so a bad client cannot push an unbounded string into a child's
// environment, where the kernel's own limit would surface as a confusing spawn
// failure rather than a clear 400.
const MAX_ACCESS_TOKEN_LEN = 8192;

// Validate the optional per-request token. Returns an error string, or null.
//
// A malformed token is REFUSED rather than ignored, and that choice is the
// security-relevant one: ignoring it would run the command as the BOX, and the
// caller would read someone else's mailbox believing it was their own. Failing
// the request is the only answer that cannot be mistaken for success.
//
// Whitespace and control characters are rejected because this value becomes an
// environment variable: an embedded NUL truncates it silently, and a token with
// spaces is not a token at all.
export function validateAccessToken(accessToken) {
  if (accessToken === undefined) return null;
  if (typeof accessToken !== 'string') return 'accessToken must be a string';
  if (accessToken.length === 0) return 'accessToken must not be empty';
  if (accessToken.length > MAX_ACCESS_TOKEN_LEN) {
    return `accessToken must be at most ${MAX_ACCESS_TOKEN_LEN} characters`;
  }
  // Whitespace plus the C0/DEL control range, spelled as escapes so this
  // source file carries no literal control bytes of its own. `-` and `_` are
  // deliberately absent: real Google tokens contain both.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(accessToken)) {
    return 'accessToken must not contain whitespace or control characters';
  }
  return null;
}

// Default runner: execFile('gog', args) with no shell. Resolves { stdout } on
// exit 0; rejects with an Error carrying `.stderr` on failure/timeout. No
// redaction here — redaction happens at the Worker boundary; this box returns
// raw stdout over HTTPS to the trusted Worker.
// `accessToken` is destructured OUT of the rest rather than spread into
// execFile's options: it is ours to turn into one env var, and passing it
// through as an unknown option would silently do nothing.
function defaultExecFn(args, { accessToken, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'gog',
      args,
      {
        env: sanitizedEnv(accessToken),
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
      // `close` fires for a caller who walked away as well as for a response we
      // finished, and the two must not read alike: on the abandoned path
      // `res.statusCode` is the untouched default 200 that nobody received, so
      // logging it bare records a success that never happened. Say so instead.
      const status = res.writableEnded ? `${res.statusCode}` : `${res.statusCode} (abandoned)`;
      log(
        `${method} ${(req.url ?? '').split('?')[0]} ${status} ` +
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

    // Bearer-required LAYER-2 probe: does the Google credential on this volume
    // still work RIGHT NOW? /health above answers only layer 1 (is the bearer
    // key right, is the box up) and runs no gog — see the lockout guard in the
    // test suite for why that separation is mandatory.
    //
    // ALWAYS HTTP 200 once authorized, including when Google says no. The status
    // line carries "could I reach the runner"; the `ok` field carries "is Google
    // healthy". Collapsing the two onto the status code is the mistake /run's
    // 422-not-502 comment already documents.
    if (method === 'GET' && url === '/health/google') {
      if (!authed) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      // Set BEFORE the await, because `finish` can run before the await
      // returns: the connector abandons at 4 s while this side's budget is
      // 10 s, and that gap is by design (an abort there is the caller declining
      // to wait, not a fault). `res.on('close')` fires at the abandonment, so
      // without this the one request the operator most wants to read logs an
      // empty tail.
      argsDesc = 'google-probe running';
      let result;
      try {
        const { stdout } = await execFn(GOOGLE_PROBE_ARGS, { timeout: GOOGLE_PROBE_TIMEOUT_MS });
        result = summarizeAuthProbe(stdout);
      } catch (err) {
        result = probeFailure(classifyProbeError(err));
      }
      // Safe to log: every possible value is a literal from PROBE_CAUSES. The
      // runner's own log makes the same three-way distinction the response
      // does, so an operator reading it cannot mistake a probe that never ran
      // for a credential Google refused.
      argsDesc = result.ok
        ? 'google-probe ok'
        : `google-probe ${result.measured ? 'FAILED' : 'NOT MEASURED'}: ${result.error}`;
      if (logged) {
        // The caller is already gone and its request line has already been
        // written, so `argsDesc` above will never be read by anyone. gog is
        // slow exactly when Google is slow — the interesting case — and this
        // line is then the ONLY surviving record of what the probe found, since
        // the response below goes to a destroyed socket. Emit it separately.
        log(`${method} ${url} (caller gone) ${Date.now() - startedAt}ms ${argsDesc}`);
      }
      sendJson(res, 200, result);
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

      // Whose identity this one call runs as (#230). Absent means "this box's",
      // which is every request that predates per-caller auth.
      const accessToken = body && body.accessToken;
      const badToken = validateAccessToken(accessToken);
      if (badToken) {
        sendJson(res, 400, { error: badToken });
        return;
      }

      argsDesc = describeArgs(args);
      try {
        const { stdout } = await withMaterializedArgs(
          args,
          (resolved) => execFn(resolved, accessToken ? { accessToken } : {}),
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
