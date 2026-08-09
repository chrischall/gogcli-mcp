import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import {
  createServer,
  sanitizedEnv,
  readBody,
  MAX_BODY_BYTES,
  MAX_ARG_LEN,
  MAX_FILE_ARG_BYTES,
  installGracefulShutdown,
  withMaterializedArgs,
  MaterializationError,
  drainAndDestroy,
  GOOGLE_PROBE_ARGS,
  GOOGLE_PROBE_TIMEOUT_MS,
  PROBE_CAUSES,
  MEASURED_CAUSES,
  UNMEASURED_CAUSES,
} from './server.mjs';

const RUNNER_KEY = 'test-runner-key-123';

// Bind AND connect to the same address. This is load-bearing, not tidiness:
// `server.listen(0)` binds the WILDCARD address while the client connects to
// 127.0.0.1:<port>. If any other IPv4-specific listener on the box already holds
// 127.0.0.1 on the port the kernel hands us (an SSH forward is the case that
// actually bit us), the dual-stack wildcard bind still SUCCEEDS and the client's
// connect lands on the foreign process — producing wildly off-target failures
// (`Parse Error: Expected HTTP/…` on an SSH banner, or a stray 401 !== 400).
// Pinning the bind to loopback removes the collision entirely.
const LOOPBACK = '127.0.0.1';

// Spin up a createServer instance on an ephemeral port for one test, invoke the
// callback with a base URL, then close it.
async function withServer(execFn, fn) {
  const server = createServer({ runnerKey: RUNNER_KEY, execFn });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://${LOOPBACK}:${port}`;
  try {
    return await fn(base);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

// Minimal HTTP client returning { status, json }.
function request(base, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.request(
      url,
      { method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let json;
          try {
            json = raw ? JSON.parse(raw) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function bearer(key) {
  return { authorization: `Bearer ${key}` };
}

test('createServer throws without a runnerKey', () => {
  assert.throws(() => createServer({ runnerKey: '' }), /RUNNER_KEY is required/);
  assert.throws(() => createServer({}), /RUNNER_KEY is required/);
});

test('GET /healthz is unauthenticated and returns 200', async () => {
  await withServer(async () => ({ stdout: '' }), async (base) => {
    const res = await request(base, { method: 'GET', path: '/healthz' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  });
});

test('GET /health requires bearer', async () => {
  await withServer(async () => ({ stdout: '' }), async (base) => {
    const noAuth = await request(base, { method: 'GET', path: '/health' });
    assert.equal(noAuth.status, 401);

    const wrong = await request(base, {
      method: 'GET',
      path: '/health',
      headers: bearer('wrong-key-of-diff-length'),
    });
    assert.equal(wrong.status, 401);

    const wrongSameLen = await request(base, {
      method: 'GET',
      path: '/health',
      headers: bearer('x'.repeat(RUNNER_KEY.length)),
    });
    assert.equal(wrongSameLen.status, 401);

    const ok = await request(base, {
      method: 'GET',
      path: '/health',
      headers: bearer(RUNNER_KEY),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true });
  });
});

test('POST /run requires bearer', async () => {
  await withServer(async () => ({ stdout: 'x' }), async (base) => {
    const res = await request(base, {
      method: 'POST',
      path: '/run',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: ['--version'] }),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /run rejects invalid bodies with 400', async () => {
  const cases = [
    { name: 'non-JSON', body: 'not json', args: undefined },
    { name: 'non-array args', body: JSON.stringify({ args: 'foo' }) },
    { name: 'empty args', body: JSON.stringify({ args: [] }) },
    { name: 'non-string element', body: JSON.stringify({ args: ['ok', 1] }) },
    { name: 'too many args', body: JSON.stringify({ args: Array(65).fill('x') }) },
    { name: 'over-long arg', body: JSON.stringify({ args: ['x'.repeat(MAX_ARG_LEN + 1)] }) },
    // NUL byte inside an arg — build the escape without a literal control char.
    { name: 'NUL byte', body: JSON.stringify({ args: [`a${String.fromCharCode(0)}b`] }) },
  ];
  let called = false;
  const execFn = async () => {
    called = true;
    return { stdout: '' };
  };
  await withServer(execFn, async (base) => {
    for (const c of cases) {
      const res = await request(base, {
        method: 'POST',
        path: '/run',
        headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
        body: c.body,
      });
      assert.equal(res.status, 400, `${c.name} should be 400`);
      assert.ok(res.json.error, `${c.name} should carry an error`);
    }
  });
  assert.equal(called, false, 'execFn must never run on invalid input');
});

test('POST /run returns 200 {stdout} on execFn success', async () => {
  let seenArgs;
  const execFn = async (args) => {
    seenArgs = args;
    return { stdout: 'gog version 0.34.1' };
  };
  await withServer(execFn, async (base) => {
    const res = await request(base, {
      method: 'POST',
      path: '/run',
      headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
      body: JSON.stringify({ args: ['--version'] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { stdout: 'gog version 0.34.1' });
    assert.deepEqual(seenArgs, ['--version']);
  });
});

// A gog failure MUST NOT use a 5xx. 5xx is reserved for infrastructure (Fly's
// edge returns 502 when it cannot reach this Machine at all), and the wrapper's
// TRANSIENT_ERROR_PATTERN treats any 5xx as "retry me" — which for a
// deterministic gog error means retrying forever. See the comment in server.mjs.
test('POST /run returns 422 {error,stderr,retryable:false} on execFn failure', async () => {
  const execFn = async () => {
    const err = new Error('gog exited with code 1');
    err.stderr = 'boom: bad flag';
    throw err;
  };
  await withServer(execFn, async (base) => {
    const res = await request(base, {
      method: 'POST',
      path: '/run',
      headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
      body: JSON.stringify({ args: ['bogus'] }),
    });
    assert.equal(res.status, 422);
    assert.ok(res.status < 500, 'a gog failure must never be reported as 5xx');
    assert.equal(res.json.error, 'gog exited with code 1');
    assert.equal(res.json.stderr, 'boom: bad flag');
    assert.equal(res.json.retryable, false);
  });
});

// The real-world repro: `--out=/home/claude/...` is a path in the CALLER's
// sandbox, not on this box, so gog cannot create it. Deterministic by nature —
// retrying cannot make the directory exist.
test('an unwritable --out path is reported as deterministic, not transient', async () => {
  const execFn = async () => {
    const err = new Error('Command failed: gog gmail attachment\nmkdir /home/claude: operation not supported');
    err.stderr = 'mkdir /home/claude: operation not supported';
    throw err;
  };
  await withServer(execFn, async (base) => {
    const res = await request(base, {
      method: 'POST',
      path: '/run',
      headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
      body: JSON.stringify({
        args: ['gmail', 'attachment', 'mid', 'aid', '--out=/home/claude/x.pdf'],
      }),
    });
    assert.equal(res.status, 422);
    assert.equal(res.json.retryable, false);
    assert.match(res.json.error, /mkdir \/home\/claude/);
  });
});

test('unknown route returns 404', async () => {
  await withServer(async () => ({ stdout: '' }), async (base) => {
    const res = await request(base, { method: 'GET', path: '/nope' });
    assert.equal(res.status, 404);
  });
});

test('sanitizedEnv strips secrets (incl. our own RUNNER_KEY) but keeps gog config', () => {
  const saved = { ...process.env };
  try {
    process.env.RUNNER_KEY = 'super-secret';
    process.env.GOG_ACCESS_TOKEN = 'ya29.leak';
    process.env.GITHUB_TOKEN = 'ghp_leak';
    process.env.SOME_SECRET = 'nope';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/creds.json';
    process.env.PORT = '8080';
    process.env.GOG_HOME = '/data';
    process.env.GOG_TIMEZONE = 'America/New_York';
    process.env.BENIGN_VAR = 'keep-me';
    const env = sanitizedEnv();
    // The box's own bearer secret must never reach a child gog process.
    assert.equal(env.RUNNER_KEY, undefined);
    assert.equal(env.GOG_ACCESS_TOKEN, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.SOME_SECRET, undefined);
    assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    assert.equal(env.PORT, undefined);
    // gog's own config and benign vars survive.
    assert.equal(env.GOG_HOME, '/data');
    // GOG_TIMEZONE must reach the child: without it gog's time.Local is UTC in
    // this container, which reports a late-evening Eastern send on the NEXT
    // calendar day. Guards against an exclusion pattern later eating it.
    assert.equal(env.GOG_TIMEZONE, 'America/New_York');
    assert.equal(env.BENIGN_VAR, 'keep-me');
    assert.ok('PATH' in env);
  } finally {
    for (const k of ['RUNNER_KEY', 'GOG_ACCESS_TOKEN', 'GITHUB_TOKEN', 'SOME_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS', 'PORT', 'GOG_HOME', 'GOG_TIMEZONE', 'BENIGN_VAR']) {
      if (!(k in saved)) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('readBody rejects with tooLarge past the cap and stops buffering', async () => {
  // A fake request stream so we can drive the cap deterministically (an
  // integration test over real HTTP races the client's upload against the
  // early response). readBody must NOT destroy the socket itself — the /run
  // handler writes the 400 first, then destroys.
  const req = new EventEmitter();
  let destroyed = false;
  req.destroy = () => { destroyed = true; };
  const promise = readBody(req);
  req.emit('data', Buffer.alloc(MAX_BODY_BYTES + 1));
  // A late chunk after the cap is ignored (done guard) — no throw, no growth.
  req.emit('data', Buffer.alloc(10));
  await assert.rejects(promise, (err) => err.tooLarge === true);
  assert.equal(destroyed, false, 'readBody must leave socket teardown to the handler');
});

test('readBody resolves a small body', async () => {
  const req = new EventEmitter();
  req.destroy = () => {};
  const promise = readBody(req);
  req.emit('data', Buffer.from('{"args":["--version"]}'));
  req.emit('end');
  assert.equal(await promise, '{"args":["--version"]}');
});

// --- Graceful shutdown -------------------------------------------------------
//
// Fly autostops an idle Machine by sending SIGINT. Without a handler, Node exits
// immediately and any in-flight `gog` request dies with it; Fly's proxy then
// hands the caller a bare HTTP 502 with a non-JSON body, which is exactly the
// opaque "gog-runner HTTP 502" the connector used to surface. These tests pin
// the drain behaviour that prevents it.

test('installGracefulShutdown drains an in-flight request before exiting', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // execFn hangs until we release it, so the request is provably in flight when
  // the signal arrives.
  const execFn = async () => { await gate; return { stdout: 'finished' }; };

  const server = createServer({ runnerKey: RUNNER_KEY, execFn, log: () => {} });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const base = `http://${LOOPBACK}:${server.address().port}`;

  const exits = [];
  const stop = installGracefulShutdown(server, {
    signals: ['SIGUSR2'], // avoid hijacking the test runner's own SIGINT
    log: () => {},
    exit: (code) => exits.push(code),
  });

  const pending = request(base, {
    method: 'POST',
    path: '/run',
    headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['gmail', 'attachment'] }),
  });

  // Wait until the server has actually accepted the request.
  while (server.inFlight === 0) await new Promise((r) => setImmediate(r));

  process.emit('SIGUSR2');
  assert.equal(server.shuttingDown, true);
  assert.deepEqual(exits, [], 'must not exit while a request is in flight');

  release();
  const res = await pending;
  assert.equal(res.status, 200, 'in-flight request completes instead of being severed');
  assert.deepEqual(res.json, { stdout: 'finished' });

  await once(server, 'close');
  assert.deepEqual(exits, [0], 'exits cleanly once drained');
  stop();
});

// Once draining begins the listening socket closes, so a NEW connection is
// refused by the OS and Fly's proxy stops routing to the Machine. The 503 guard
// covers the other case: a request arriving on a keep-alive connection that was
// already established when the signal landed. Setting the flag directly keeps
// the listener open so that branch is exercised deterministically.
test('a request arriving mid-shutdown gets a retryable 503, not a severed socket', async () => {
  const server = createServer({ runnerKey: RUNNER_KEY, execFn: async () => ({ stdout: 'x' }), log: () => {} });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const base = `http://${LOOPBACK}:${server.address().port}`;

  server.shuttingDown = true;

  const res = await request(base, {
    method: 'POST',
    path: '/run',
    headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['gmail', 'attachment'] }),
  });
  assert.equal(res.status, 503);
  assert.match(res.json.error, /shutting down/i);
  assert.equal(res.json.retryable, true);

  server.close();
  await once(server, 'close');
});

test('shutdown is idempotent across repeated signals', async () => {
  const server = createServer({ runnerKey: RUNNER_KEY, execFn: async () => ({ stdout: 'x' }), log: () => {} });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');

  const exits = [];
  const stop = installGracefulShutdown(server, {
    signals: ['SIGUSR2'],
    log: () => {},
    exit: (code) => exits.push(code),
  });

  process.emit('SIGUSR2');
  process.emit('SIGUSR2');
  process.emit('SIGUSR2');
  await once(server, 'close');
  assert.deepEqual(exits, [0], 'exits exactly once');
  stop();
});

test('createServer logs each request without leaking full gog args', async () => {
  const lines = [];
  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => ({ stdout: 'ok' }),
    log: (line) => lines.push(line),
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const base = `http://${LOOPBACK}:${server.address().port}`;

  const secretish = 'ANGjdJ-verylongattachmentid-shouldnotbelogged';
  await request(base, {
    method: 'POST',
    path: '/run',
    headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['gmail', 'attachment', 'msgid', secretish] }),
  });

  const line = lines.find((l) => l.includes('POST /run'));
  assert.ok(line, 'request was logged');
  assert.match(line, /200/, 'logs the status');
  assert.match(line, /gmail attachment/, 'logs the gog subcommand');
  assert.match(line, /4 args/, 'logs the arg count');
  assert.ok(!line.includes(secretish), 'does not log operand values');

  server.close();
  await once(server, 'close');
});

test('concurrent /run calls each log their own gog subcommand', async () => {
  const lines = [];
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });

  // The slow call models an attachment download; the fast one a metadata read
  // that overtakes it. Per-request log state must survive the overlap.
  const execFn = async (args) => {
    if (args[1] === 'attachment') { await slowGate; return { stdout: 'pdf' }; }
    return { stdout: 'meta' };
  };

  const server = createServer({ runnerKey: RUNNER_KEY, execFn, log: (l) => lines.push(l) });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const base = `http://${LOOPBACK}:${server.address().port}`;

  const post = (args) => request(base, {
    method: 'POST',
    path: '/run',
    headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  });

  const slow = post(['gmail', 'attachment', 'msgid', 'attid']);
  while (server.inFlight === 0) await new Promise((r) => setImmediate(r));
  // The fast request starts and finishes while the slow one is still in flight.
  const fast = await post(['gmail', 'messages', 'search']);
  assert.equal(fast.status, 200);

  releaseSlow();
  assert.equal((await slow).status, 200);

  try {
    const runLines = lines.filter((l) => l.includes('POST /run'));
    assert.equal(runLines.length, 2, 'both requests logged');
    assert.ok(
      runLines.some((l) => l.includes('gmail attachment') && l.includes('4 args')),
      `slow request must log its own args, got: ${JSON.stringify(runLines)}`,
    );
    assert.ok(
      runLines.some((l) => l.includes('gmail messages') && l.includes('3 args')),
      `fast request must log its own args, got: ${JSON.stringify(runLines)}`,
    );
  } finally {
    // Without this the server outlives a failed assertion and hangs the suite.
    server.close();
    await once(server, 'close');
  }
});

// --- Large payloads: file args and the raised argv cap ----------------------
//
// THE BUG THESE PIN: a Gmail draft with a >4096-char bodyHtml used to be
// rejected by this box with "each arg must be at most 4096 chars". Raising that
// constant alone is not a fix — Linux caps a SINGLE argv string at
// MAX_ARG_STRLEN (131072 bytes), so a big enough body would just trade a clear
// error for an opaque E2BIG. Large payloads leave argv entirely: the caller
// sends a { kind:'file' } arg, this box writes it to a private temp file and
// passes gog only the path via gog's `--x-file` flag variants.

// POST a /run body and additionally return whatever the stubbed execFn saw.
function postRun(base, args, extra = {}) {
  return request(base, {
    method: 'POST',
    path: '/run',
    headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
    ...extra,
  });
}

test('a file arg is materialized to a temp file and gog receives only its path', async () => {
  const payload = '<p>' + 'x'.repeat(50_000) + '</p>';
  let seenArgs;
  let fileContents;
  const execFn = async (args) => {
    seenArgs = args;
    // Read INSIDE execFn: the temp dir is removed as soon as the call returns.
    const flagArg = args.find((a) => a.startsWith('--body-html-file='));
    fileContents = await readFile(flagArg.slice('--body-html-file='.length), 'utf8');
    return { stdout: '{"id":"r123"}' };
  };

  await withServer(execFn, async (base) => {
    const res = await postRun(base, [
      'gmail', 'drafts', 'create', '--to=a@b.c', '--subject=hi',
      { kind: 'file', flag: 'body-html-file', contents: payload, ext: 'html' },
    ]);
    assert.equal(res.status, 200);
  });

  // Every element gog sees is a plain string — no object leaks into argv.
  assert.ok(seenArgs.every((a) => typeof a === 'string'));
  const flagArg = seenArgs.at(-1);
  assert.match(flagArg, /^--body-html-file=\//, 'substituted as --flag=<abs path>');
  assert.match(flagArg, /body\.html$/, 'ext drives the temp filename');
  assert.equal(fileContents, payload, 'the file holds the exact payload bytes');
  // The payload itself must never appear in argv.
  assert.ok(!seenArgs.some((a) => a.includes('xxxxx')));
});

test('a file arg defaults to a .txt extension when ext is omitted', async () => {
  let seenArgs;
  await withServer(async (args) => { seenArgs = args; return { stdout: '' }; }, async (base) => {
    const res = await postRun(base, [
      'gmail', 'send', { kind: 'file', flag: 'body-file', contents: 'plain text' },
    ]);
    assert.equal(res.status, 200);
  });
  assert.match(seenArgs.at(-1), /^--body-file=.*body\.txt$/);
});

test('a file arg round-trips UTF-8 byte-for-byte', async () => {
  // Multi-byte characters are exactly why every cap is measured in bytes rather
  // than in JS string length.
  const payload = 'héllo → 世界 🎉\nsecond line\ttabbed';
  let roundTripped;
  let onDiskBytes;
  await withServer(async (args) => {
    const file = args.at(-1).split('=')[1];
    roundTripped = await readFile(file, 'utf8');
    onDiskBytes = (await readFile(file)).length;
    return { stdout: '' };
  }, async (base) => {
    const res = await postRun(base, [
      'docs', 'cell-update', { kind: 'file', flag: 'content-file', contents: payload },
    ]);
    assert.equal(res.status, 200);
  });
  assert.equal(roundTripped, payload);
  assert.equal(onDiskBytes, Buffer.byteLength(payload, 'utf8'));
  assert.ok(onDiskBytes > payload.length, 'multi-byte payload: bytes exceed characters');
});

test('the temp dir is removed after a successful run', async () => {
  let dir;
  await withServer(async (args) => {
    const file = args.at(-1).split('=')[1];
    dir = path.dirname(file);
    assert.ok(fs.existsSync(file), 'the file exists while gog runs');
    return { stdout: '' };
  }, async (base) => {
    const res = await postRun(base, [
      'gmail', 'send', { kind: 'file', flag: 'body-file', contents: 'secret body' },
    ]);
    assert.equal(res.status, 200);
  });
  assert.equal(fs.existsSync(dir), false, 'temp dir is gone after success');
});

// Cleanup on the FAILURE path is the one that matters most: a leaked temp file
// holds the user's email content, and a gog failure (bad flag, timeout, non-zero
// exit) is exactly when an early `return` would skip a non-finally cleanup.
test('the temp dir is removed after execFn rejects', async () => {
  let dir;
  await withServer(async (args) => {
    dir = path.dirname(args.at(-1).split('=')[1]);
    const err = new Error('gog exited with code 1');
    err.stderr = 'boom';
    throw err;
  }, async (base) => {
    const res = await postRun(base, [
      'gmail', 'send', { kind: 'file', flag: 'body-file', contents: 'secret body' },
    ]);
    assert.equal(res.status, 422, 'the gog failure still surfaces');
  });
  assert.equal(fs.existsSync(dir), false, 'temp dir is gone even when gog fails');
});

test('every temp dir is removed when a request carries several file args', async () => {
  const dirs = [];
  await withServer(async (args) => {
    for (const a of args) {
      if (a.includes('-file=')) dirs.push(path.dirname(a.split('=')[1]));
    }
    return { stdout: '' };
  }, async (base) => {
    const res = await postRun(base, [
      'gmail', 'send',
      { kind: 'file', flag: 'body-file', contents: 'text part' },
      { kind: 'file', flag: 'body-html-file', contents: '<p>html part</p>', ext: 'html' },
    ]);
    assert.equal(res.status, 200);
  });
  assert.equal(dirs.length, 2, 'each file arg gets its own private dir');
  assert.notEqual(dirs[0], dirs[1]);
  for (const dir of dirs) assert.equal(fs.existsSync(dir), false);
});

test('an oversized file payload is rejected with the real limit and size', async () => {
  let called = false;
  await withServer(async () => { called = true; return { stdout: '' }; }, async (base) => {
    const oversize = 'x'.repeat(MAX_FILE_ARG_BYTES + 1);
    const res = await postRun(base, [
      'gmail', 'drafts', 'create',
      { kind: 'file', flag: 'body-html-file', contents: oversize, ext: 'html' },
    ]);
    assert.equal(res.status, 400);
    // The error must name the flag, the ACTUAL size and the REAL limit —
    // never the old, wrong "each arg must be at most 4096 chars".
    assert.equal(
      res.json.error,
      `body-html-file payload is ${MAX_FILE_ARG_BYTES + 1} bytes; ` +
      `the maximum is ${MAX_FILE_ARG_BYTES} bytes`,
    );
    assert.ok(!/4096/.test(res.json.error));
  });
  assert.equal(called, false, 'gog never runs on an oversized payload');
});

test('the file payload cap is measured in bytes, not characters', async () => {
  // Just under the cap in characters, but over it in UTF-8 bytes.
  await withServer(async () => ({ stdout: '' }), async (base) => {
    const chars = '€'.repeat(MAX_FILE_ARG_BYTES / 3 + 1); // 3 bytes each
    assert.ok(chars.length < MAX_FILE_ARG_BYTES, 'under the cap by character count');
    const res = await postRun(base, [
      'gmail', 'send', { kind: 'file', flag: 'body-file', contents: chars },
    ]);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /^body-file payload is \d+ bytes; the maximum is \d+ bytes$/);
  });
});

test('a plain arg at the raised cap is accepted; one past it is rejected', async () => {
  let seenArgs;
  await withServer(async (args) => { seenArgs = args; return { stdout: '' }; }, async (base) => {
    // 64 KiB: the legitimately-large case with no gog file variant, e.g.
    // `sheets update --values-json`. This used to fail at 4096.
    const big = 'v'.repeat(MAX_ARG_LEN);
    const ok = await postRun(base, ['sheets', 'update', `--values-json=${'x'}`, big]);
    assert.equal(ok.status, 200, 'a 64 KiB plain arg is accepted');
    assert.equal(seenArgs.at(-1).length, MAX_ARG_LEN);

    const tooBig = await postRun(base, ['sheets', 'update', 'v'.repeat(65 * 1024)]);
    assert.equal(tooBig.status, 400, 'a 65 KiB plain arg is rejected');
    assert.match(tooBig.json.error, /is 66560 bytes; the maximum for a plain arg is 65536 bytes/);
    assert.ok(!/4096/.test(tooBig.json.error), 'no stale 4096 limit in the message');
  });
});

test('the plain-arg cap is measured in bytes, not characters', async () => {
  await withServer(async () => ({ stdout: '' }), async (base) => {
    const chars = '€'.repeat(MAX_ARG_LEN / 3 + 1);
    assert.ok(chars.length < MAX_ARG_LEN, 'under the cap by character count');
    const res = await postRun(base, ['sheets', 'update', chars]);
    assert.equal(res.status, 400);
  });
});

test('malformed file-arg shapes are rejected before gog runs', async () => {
  const cases = [
    { name: 'unknown kind', arg: { kind: 'blob', flag: 'body', contents: 'x' } },
    { name: 'missing kind', arg: { flag: 'body', contents: 'x' } },
    { name: 'non-string flag', arg: { kind: 'file', flag: 42, contents: 'x' } },
    { name: 'missing flag', arg: { kind: 'file', contents: 'x' } },
    { name: 'non-string contents', arg: { kind: 'file', flag: 'body', contents: 42 } },
    { name: 'missing contents', arg: { kind: 'file', flag: 'body' } },
    { name: 'object contents', arg: { kind: 'file', flag: 'body', contents: { a: 1 } } },
    { name: 'null arg', arg: null },
    { name: 'array arg', arg: ['gmail'] },
    { name: 'number arg', arg: 7 },
    { name: 'boolean arg', arg: true },
    { name: 'flag with =', arg: { kind: 'file', flag: 'body=x', contents: 'x' } },
    { name: 'flag with space', arg: { kind: 'file', flag: 'body file', contents: 'x' } },
    { name: 'flag with newline', arg: { kind: 'file', flag: 'body\nx', contents: 'x' } },
    { name: 'leading-dash flag', arg: { kind: 'file', flag: '--body', contents: 'x' } },
    { name: 'empty flag', arg: { kind: 'file', flag: '', contents: 'x' } },
    { name: 'non-string ext', arg: { kind: 'file', flag: 'body', contents: 'x', ext: 7 } },
    { name: 'empty ext', arg: { kind: 'file', flag: 'body', contents: 'x', ext: '' } },
    { name: 'over-long ext', arg: { kind: 'file', flag: 'body', contents: 'x', ext: 'a'.repeat(17) } },
  ];
  let called = false;
  await withServer(async () => { called = true; return { stdout: '' }; }, async (base) => {
    for (const c of cases) {
      const res = await postRun(base, ['gmail', 'send', c.arg]);
      assert.equal(res.status, 400, `${c.name} should be 400`);
      assert.ok(res.json.error, `${c.name} should carry an error`);
    }
  });
  assert.equal(called, false, 'execFn must never run on a malformed file arg');
});

// The ext reaches a filesystem path, and the flag is interpolated into an argv
// string, so both are the traversal-sensitive fields.
test('path-traversal attempts in flag and ext are rejected', async () => {
  const hostile = [
    { kind: 'file', flag: 'body', contents: 'x', ext: '../../../../etc/passwd' },
    { kind: 'file', flag: 'body', contents: 'x', ext: '..' },
    { kind: 'file', flag: 'body', contents: 'x', ext: 'txt/../../etc/cron.d/evil' },
    { kind: 'file', flag: 'body', contents: 'x', ext: 'tx.t' },
    { kind: 'file', flag: 'body', contents: 'x', ext: `t${String.fromCharCode(0)}xt` },
    { kind: 'file', flag: '../../etc/passwd', contents: 'x' },
    { kind: 'file', flag: '/etc/passwd', contents: 'x' },
    { kind: 'file', flag: `body${String.fromCharCode(0)}`, contents: 'x' },
  ];
  let called = false;
  await withServer(async () => { called = true; return { stdout: '' }; }, async (base) => {
    for (const arg of hostile) {
      const res = await postRun(base, ['gmail', 'send', arg]);
      assert.equal(res.status, 400, `${JSON.stringify(arg.ext ?? arg.flag)} should be 400`);
    }
  });
  assert.equal(called, false, 'a traversal attempt never reaches the filesystem');
});

test('MAX_BODY_BYTES leaves 4x headroom over a max-size file payload', () => {
  // The whole POST body is buffered against MAX_BODY_BYTES, so a body cap at or
  // near the per-file cap would mean large drafts fail as "request body too
  // large" instead of hitting the precise per-flag error. Merely exceeding it is
  // NOT enough: JSON encoding inflates the payload — quote/newline-heavy HTML
  // roughly doubles, control characters expand 6x as \uXXXX.
  //
  // What this asserts is exactly what 4x buys and no more: ONE max-size payload
  // survives up to 4x JSON expansion. It does NOT claim the per-file cap always
  // binds first — a pathological all-control-character payload, or several file
  // args each near the cap, can still trip the body cap. That is the accepted
  // trade for a bounded buffer; see the MAX_BODY_BYTES comment in server.mjs.
  assert.ok(
    MAX_BODY_BYTES >= 4 * MAX_FILE_ARG_BYTES,
    'the body cap must leave 4x headroom over the per-file payload cap',
  );
});

// Materialization failing is OUR box failing (a full or read-only rootfs), not
// the caller's args failing. Reporting it as 422 { retryable: false } would
// attribute a filesystem error to gog and tell the caller never to retry — the
// same transient/deterministic confusion the 502->422 change existed to fix.
test('a materialization failure is a retryable 5xx, not a gog 422', async () => {
  let called = false;
  const realTmp = process.env.TMPDIR;
  // os.tmpdir() re-reads TMPDIR per call, so this makes mkdtemp fail with ENOENT
  // the same way a full/read-only rootfs would fail the write.
  process.env.TMPDIR = path.join('/nonexistent-gog-runner-tmp', 'nope');
  try {
    await withServer(async () => { called = true; return { stdout: '' }; }, async (base) => {
      const res = await postRun(base, [
        'gmail', 'drafts', 'create',
        { kind: 'file', flag: 'body-html-file', contents: '<p>body</p>', ext: 'html' },
      ]);
      assert.equal(res.status, 500, 'infrastructure failure, not 422');
      assert.equal(res.json.retryable, true, 'the caller SHOULD retry this one');
      assert.match(res.json.error, /failed to write a file arg to disk/);
      assert.ok(!/gog failed/.test(res.json.error), 'not attributed to gog');
    });
  } finally {
    if (realTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = realTmp;
  }
  assert.equal(called, false, 'gog never runs when its input never reached disk');
});

test('withMaterializedArgs leaves plain args untouched and cleans up after itself', async () => {
  let seen;
  let file;
  const result = await withMaterializedArgs(
    ['gmail', 'send', '--to=a@b.c', { kind: 'file', flag: 'body-file', contents: 'hello' }],
    async (resolved) => {
      seen = resolved;
      file = resolved.at(-1).split('=')[1];
      assert.equal(await readFile(file, 'utf8'), 'hello');
      return 'return value passes through';
    },
  );
  assert.equal(result, 'return value passes through');
  assert.deepEqual(seen.slice(0, 3), ['gmail', 'send', '--to=a@b.c']);
  assert.equal(fs.existsSync(file), false);
});

test('withMaterializedArgs wraps a filesystem failure in MaterializationError', async () => {
  const realTmp = process.env.TMPDIR;
  process.env.TMPDIR = path.join('/nonexistent-gog-runner-tmp', 'nope');
  try {
    await assert.rejects(
      () => withMaterializedArgs([{ kind: 'file', flag: 'body-file', contents: 'x' }], async () => {
        assert.fail('fn must not run when materialization failed');
      }),
      (err) => {
        assert.ok(err instanceof MaterializationError);
        assert.ok(err.cause, 'the underlying fs error is preserved as .cause');
        return true;
      },
    );
  } finally {
    if (realTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = realTmp;
  }
});

// `force: true` only suppresses ENOENT. A sequential `for … await rm()` cleanup
// would, on a real rm failure, both skip the remaining dirs (leaking user
// content) and replace the in-flight error — the actual gog failure the caller
// needs to see — with the rm error.
test('a failing temp-dir cleanup neither leaks the other dirs nor masks the real error', {
  // rm cannot fail this way for root: a 0500 dir does not stop uid 0 unlinking.
  skip: process.getuid?.() === 0 ? 'requires a non-root uid' : false,
}, async () => {
  const lines = [];
  let firstDir;
  let secondDir;
  await assert.rejects(
    () => withMaterializedArgs(
      [
        { kind: 'file', flag: 'body-file', contents: 'part one' },
        { kind: 'file', flag: 'body-html-file', contents: '<p>part two</p>', ext: 'html' },
      ],
      async (resolved) => {
        [firstDir, secondDir] = resolved.map((a) => path.dirname(a.split('=')[1]));
        // Read+execute but not write: rm can list the dir but not unlink inside it.
        fs.chmodSync(firstDir, 0o500);
        const err = new Error('gog exited with code 1');
        err.stderr = 'boom';
        throw err;
      },
      { log: (line) => lines.push(line) },
    ),
    /gog exited with code 1/, // NOT the rm error
  );
  assert.equal(fs.existsSync(secondDir), false, 'the later dir is still cleaned up');
  assert.ok(
    lines.some((l) => l.includes('temp dir cleanup failed') && l.includes(firstDir)),
    'the cleanup failure is logged rather than swallowed',
  );
  fs.chmodSync(firstDir, 0o700);
  fs.rmSync(firstDir, { recursive: true, force: true });
});

test('a file arg payload never reaches a log line', async () => {
  const lines = [];
  const secret = 'CONFIDENTIAL-SEVERANCE-TERMS-DO-NOT-LOG';
  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => ({ stdout: 'ok' }),
    log: (line) => lines.push(line),
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const base = `http://${LOOPBACK}:${server.address().port}`;

  await postRun(base, [
    'gmail', 'drafts', 'create',
    { kind: 'file', flag: 'body-html-file', contents: `<p>${secret}</p>`, ext: 'html' },
  ]);

  try {
    const line = lines.find((l) => l.includes('POST /run'));
    assert.ok(line, 'request was logged');
    assert.match(line, /gmail drafts/, 'still logs the gog subcommand');
    assert.match(line, /4 args/, 'still logs the arg count');
    assert.ok(!line.includes(secret), 'payload contents never reach the log');
    assert.ok(!line.includes('body-html'), 'not even the flag or a temp path is logged');
    assert.ok(!lines.some((l) => l.includes(secret)), 'no log line anywhere carries the payload');
  } finally {
    // Without this the server outlives a failed assertion and hangs the suite.
    server.close();
    await once(server, 'close');
  }
});

// --- Body-cap behaviour over real HTTP ---------------------------------------
//
// The `readBody rejects with tooLarge` test drives a fake EventEmitter in
// isolation, so on its own NOTHING asserted that /run actually answers
// 400 { error: 'request body too large' } over the wire. That gap mattered once
// MAX_BODY_BYTES became load-bearing for file args: the response-then-destroy
// ORDERING is the whole point (destroying first would show the client a
// connection reset instead of the error), and only an end-to-end test can pin it.
test('POST /run answers 400 over real HTTP when the body exceeds the cap', async () => {
  let called = false;
  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => { called = true; return { stdout: 'ok' }; },
    log: () => {},
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: LOOPBACK, port, method: 'POST', path: '/run', headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' } },
        (response) => {
          const chunks = [];
          response.on('data', (c) => chunks.push(c));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            resolve({ status: response.statusCode, json: raw ? JSON.parse(raw) : undefined });
          });
          // The handler destroys the request socket right after writing the
          // response, so the response stream may report an error once we
          // already have every byte. Ignoring it here is what proves the
          // ordering: a reset BEFORE the body would leave `resolve` uncalled.
          response.on('error', () => {});
        },
      );
      // The server tears the socket down mid-upload by design; EPIPE/ECONNRESET
      // on the write side is the expected outcome, not a test failure.
      req.on('error', () => {});

      const chunk = Buffer.alloc(1024 * 1024, 'a'); // 1 MiB
      let sent = 0;
      const pump = () => {
        while (sent <= MAX_BODY_BYTES) {
          sent += chunk.length;
          if (!req.write(chunk)) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      req.on('close', () => reject(new Error('socket closed before a response arrived')));
      pump();
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: 'request body too large' });
    assert.equal(called, false, 'gog never runs for an oversized body');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('readBody rejects when the request stream errors', async () => {
  const req = new EventEmitter();
  req.destroy = () => {};
  const promise = readBody(req);
  const boom = new Error('aborted');
  req.emit('error', boom);
  await assert.rejects(promise, (err) => err === boom);
});

test('readBody ignores a stream error that arrives after it has settled', async () => {
  const req = new EventEmitter();
  req.destroy = () => {};
  const promise = readBody(req);
  req.emit('data', Buffer.from('{}'));
  req.emit('end');
  assert.equal(await promise, '{}');
  // A socket error after 'end' must not re-settle the promise (an unhandled
  // rejection would crash the process).
  req.emit('error', new Error('late reset'));
});

// The drain timeout is the last line of defence against a wedged `gog` holding
// the Machine open past what Fly will wait for. Nothing exercised it before, so
// a broken timer would have been invisible.
test('a drain that never completes forces an exit after the timeout', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const execFn = async () => { await gate; return { stdout: 'late' }; };

  const lines = [];
  const exits = [];
  const server = createServer({ runnerKey: RUNNER_KEY, execFn, log: () => {} });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const base = `http://${LOOPBACK}:${server.address().port}`;

  const stop = installGracefulShutdown(server, {
    signals: ['SIGUSR2'],
    timeoutMs: 25,
    log: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  });

  const pending = request(base, {
    method: 'POST',
    path: '/run',
    headers: { ...bearer(RUNNER_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['gmail', 'attachment'] }),
  });
  while (server.inFlight === 0) await new Promise((r) => setImmediate(r));

  process.emit('SIGUSR2');
  while (exits.length === 0) await new Promise((r) => setTimeout(r, 5));

  assert.deepEqual(exits, [1], 'a stuck drain exits non-zero');
  assert.ok(
    lines.some((l) => /drain timed out after 25ms with 1 in flight/.test(l)),
    `the timeout is logged with the in-flight count; got ${JSON.stringify(lines)}`,
  );

  // Let the wedged request finish so the suite does not hang.
  release();
  await pending;
  stop();
  server.close();
  await once(server, 'close');
});

// drainAndDestroy's happy path (drain to 'end', then destroy) is covered by the
// end-to-end test above; these pin the two escape hatches, which only fire for
// a client that misbehaves and so cannot be provoked over real HTTP.
test('drainAndDestroy severs a client that never stops uploading', async () => {
  const req = new EventEmitter();
  let destroyed = false;
  let resumed = false;
  req.destroy = () => { destroyed = true; };
  req.resume = () => { resumed = true; };

  drainAndDestroy(req, { timeoutMs: 10 });
  assert.equal(resumed, true, 'draining starts immediately');
  assert.equal(destroyed, false, 'a still-uploading client is given its grace period');

  req.emit('data', Buffer.alloc(1024)); // discarded, never buffered
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(destroyed, true, 'the grace period is bounded');
});

test('drainAndDestroy destroys once, whichever way the request ends', async () => {
  for (const event of ['end', 'error']) {
    const req = new EventEmitter();
    let destroys = 0;
    req.destroy = () => { destroys += 1; };
    req.resume = () => {};

    drainAndDestroy(req, { timeoutMs: 10 });
    req.emit(event, new Error('reset'));
    assert.equal(destroys, 1, `${event} tears the socket down`);

    // The bounding timer must not fire a second destroy after we already have.
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(destroys, 1, `${event} leaves no pending timer behind`);
  }
});

// ---------------------------------------------------------------------------
// Per-request access token (#230).
//
// This box holds ONE Google identity on its volume, so every caller of a hosted
// gog MCP acted as whoever seeded it. A token supplied WITH a request overrides
// that identity for that single `gog` invocation — `gog` already prefers a
// directly-passed token over its store.
//
// Request-scoped is the whole point. An env var on this box is shared by every
// request, so honouring one would rebuild the shared-identity problem from the
// other direction — which is why the ambient GOG_ACCESS_TOKEN stays stripped no
// matter what arrives on the wire.
// ---------------------------------------------------------------------------

test('/run hands a request token to the gog invocation, and only that one', async () => {
  const seen = [];
  const execFn = async (args, opts) => {
    seen.push(opts?.accessToken);
    return { stdout: 'ok' };
  };
  await withServer(execFn, async (base) => {
    const withToken = await request(base, {
      method: 'POST',
      path: '/run',
      headers: { authorization: `Bearer ${RUNNER_KEY}` },
      body: JSON.stringify({ args: ['auth', 'status'], accessToken: 'ya29.caller' }),
    });
    assert.equal(withToken.status, 200);

    const without = await request(base, {
      method: 'POST',
      path: '/run',
      headers: { authorization: `Bearer ${RUNNER_KEY}` },
      body: JSON.stringify({ args: ['auth', 'status'] }),
    });
    assert.equal(without.status, 200);
  });
  // The second call must not inherit the first's identity: that is the bug.
  assert.deepEqual(seen, ['ya29.caller', undefined]);
});

test('/run refuses a malformed access token instead of ignoring it', async () => {
  // Silently dropping an unusable token is the dangerous failure: the call
  // would succeed AS THE BOX, and the caller would read someone else's mailbox
  // believing it was their own. A refusal is the only safe answer.
  const execFn = async () => ({ stdout: 'ok' });
  await withServer(execFn, async (base) => {
    for (const accessToken of [42, '', 'a b', 'x'.repeat(8193)]) {
      const res = await request(base, {
        method: 'POST',
        path: '/run',
        headers: { authorization: `Bearer ${RUNNER_KEY}` },
        body: JSON.stringify({ args: ['auth', 'status'], accessToken }),
      });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(accessToken)}`);
      assert.match(res.json.error, /accessToken/);
    }
  });
});

test('a request token never reaches a log line', async () => {
  const lines = [];
  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => ({ stdout: 'ok' }),
    log: (...a) => lines.push(a.join(' ')),
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await request(`http://${LOOPBACK}:${port}`, {
      method: 'POST',
      path: '/run',
      headers: { authorization: `Bearer ${RUNNER_KEY}` },
      body: JSON.stringify({ args: ['auth', 'status'], accessToken: 'ya29.super-secret' }),
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
  assert.ok(!lines.join('\n').includes('ya29.super-secret'), lines.join('\n'));
});

test('sanitizedEnv honours a request token while still stripping the ambient one', () => {
  const saved = { ...process.env };
  try {
    process.env.GOG_ACCESS_TOKEN = 'ya29.ambient-must-never-win';
    // No argument: the box's own env var is still not a credential anyone asked
    // for, so it stays stripped exactly as before.
    assert.equal(sanitizedEnv().GOG_ACCESS_TOKEN, undefined);
    // With one: the request's token is what the child sees.
    assert.equal(sanitizedEnv('ya29.from-the-request').GOG_ACCESS_TOKEN, 'ya29.from-the-request');
  } finally {
    process.env = saved;
  }
});

// ---------------------------------------------------------------------------
// fly.toml — deploy config invariants.
//
// fly.toml is not code, so nothing else in this suite can catch a regression in
// it; a one-character edit here changes what the deployed app costs and how it
// behaves under idle. These tests pin the two settings whose interaction caused
// a real incident, so that changing them is a deliberate act with a failing test
// to explain itself.
// ---------------------------------------------------------------------------

// Read one [table] out of fly.toml. Deliberately not a TOML parser: it handles
// the flat `key = scalar` lines this file actually contains (numbers, booleans,
// double-quoted strings) and nothing else. `#` always begins a comment because
// no value in fly.toml contains one; if that ever stops being true, this helper
// must grow quoting awareness rather than be worked around.
function flyTomlTable(tableName) {
  const toml = fs.readFileSync(new URL('./fly.toml', import.meta.url), 'utf8');
  const out = {};
  let inTable = false;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inTable = line === `[${tableName}]`;
      continue;
    }
    if (!inTable) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^#]+?)\s*$/.exec(line);
    if (m) out[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

test('fly.toml keeps a Machine warm instead of autostopping mid-session', () => {
  // THE INCIDENT THIS PINS: with min_machines_running = 0 the Fly proxy stopped
  // the Machine after ~3 minutes of no requests —
  //   03:52:16  POST /run 200 298ms
  //   03:55:16  proxy: App gogcli-gog-runner has excess capacity, autostopping
  // — which is ordinary think-time between two tool calls in ONE conversation
  // turn. Every gog_* connector shares this single Machine, so the stop lands on
  // all of them at once.
  const service = flyTomlTable('http_service');

  assert.ok(
    service.min_machines_running >= 1,
    'at least one Machine must stay running so an idle session is not autostopped',
  );
  // Belt and braces: the floor only governs the proxy's autostop. A Machine
  // stopped some other way (deploy, host migration, OOM, `fly machine stop`)
  // still has to be woken by an incoming request, and that is what
  // auto_start_machines buys. The runner must survive a cold start either way —
  // see the ~4 s measurement in the fly.toml comment.
  assert.equal(service.auto_start_machines, true);
});

// ---------------------------------------------------------------------------
// GET /health/google — the LAYER 2 (Google) probe.
//
// /health answers "is this bearer key right and is the box up" and deliberately
// runs no gog. That is the whole of layer 1, and it is all the connector could
// ever measure before this endpoint existed — which is why a connector could
// report "connected" twice and then fail the very next Gmail call with a Google
// 401. This endpoint is the missing measurement: it actually asks Google.
// ---------------------------------------------------------------------------

// Build a server whose execFn records every call, so a test can assert both the
// argv the probe used and the options it ran under.
function spyServer(impl, log) {
  const calls = [];
  const execFn = (args, opts) => {
    calls.push({ args, opts });
    return impl(args, opts);
  };
  return { calls, execFn, log };
}

test('GET /health/google requires bearer', async () => {
  await withServer(async () => ({ stdout: '{"accounts":[]}' }), async (base) => {
    const noAuth = await request(base, { method: 'GET', path: '/health/google' });
    assert.equal(noAuth.status, 401);
    assert.deepEqual(noAuth.json, { error: 'unauthorized' });

    const wrongSameLen = await request(base, {
      method: 'GET',
      path: '/health/google',
      headers: bearer('x'.repeat(RUNNER_KEY.length)),
    });
    assert.equal(wrongSameLen.status, 401);
  });
});

test('GET /health/google runs a live gog probe and reports healthy accounts', async () => {
  const spy = spyServer(async () => ({
    stdout: JSON.stringify({
      accounts: [
        {
          email: 'me@example.com',
          created_at: '2026-08-01T00:00:00Z',
          valid: true,
          scopes: ['https://www.googleapis.com/auth/gmail.modify'],
          subject: '11223344',
        },
      ],
    }),
  }));
  await withServer(spy.execFn, async (base) => {
    const res = await request(base, {
      method: 'GET',
      path: '/health/google',
      headers: bearer(RUNNER_KEY),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.error, undefined);
    // Only the four health-relevant fields are echoed. `scopes` and `subject`
    // describe the credential, and this response is destined for logs.
    // Exactly these keys — `error` is absent (not null) on a healthy account,
    // and `scopes`/`subject` were dropped entirely.
    assert.deepEqual(res.json.accounts, [
      { email: 'me@example.com', created_at: '2026-08-01T00:00:00Z', valid: true },
    ]);
  });

  assert.equal(spy.calls.length, 1);
  // --check is what makes gog perform a real refresh against Google; --json is
  // what makes the result parseable. Neither is optional.
  assert.deepEqual(spy.calls[0].args, GOOGLE_PROBE_ARGS);
  assert.deepEqual(spy.calls[0].args, ['auth', 'list', '--check', '--json']);
  // A dedicated, SHORTER budget than /run's: an unreachable Google must not
  // hold a status probe open for the full 30 s exec timeout.
  assert.equal(spy.calls[0].opts.timeout, GOOGLE_PROBE_TIMEOUT_MS);
  assert.ok(GOOGLE_PROBE_TIMEOUT_MS < 30_000, 'probe budget must undercut EXEC_TIMEOUT_MS');
  // No accessToken: the probe measures the box's own stored credential, which
  // is precisely the one the next /run will use.
  assert.equal(spy.calls[0].opts.accessToken, undefined);
});

test('GET /health/google reports ok:false at HTTP 200 when a stored token is dead', async () => {
  await withServer(
    async () => ({
      stdout: JSON.stringify({
        accounts: [
          {
            email: 'me@example.com',
            created_at: '2026-08-01T00:00:00Z',
            valid: false,
            error: 'oauth2: "invalid_grant" "Token has been expired or revoked."',
          },
        ],
      }),
    }),
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      // 200, NOT 5xx: the runner is reachable and answered truthfully. Only a
      // probe that could not run at all gets a non-200, so the caller can tell
      // "I could not measure" from "I measured, and Google says no".
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, false);
      assert.match(res.json.error, /invalid_grant/);
      assert.equal(res.json.accounts[0].valid, false);
    },
  );
});

test('GET /health/google reports ok:false when the probe command itself fails', async () => {
  await withServer(
    async () => {
      const err = new Error('Command failed: gog auth list --check --json');
      err.stderr = 'oauth2: cannot fetch token: invalid_grant';
      throw err;
    },
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, false);
      assert.match(res.json.error, /invalid_grant/);
      assert.deepEqual(res.json.accounts, []);
    },
  );
});

test('GET /health/google reports ok:false when no account is stored at all', async () => {
  await withServer(async () => ({ stdout: JSON.stringify({ accounts: [] }) }), async (base) => {
    const res = await request(base, {
      method: 'GET',
      path: '/health/google',
      headers: bearer(RUNNER_KEY),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, false);
    assert.match(res.json.error, /no Google account/i);
  });
});

test('GET /health/google reports ok:false on output it cannot parse', async () => {
  for (const stdout of ['not json at all', '{"accounts":"nope"}', '']) {
    await withServer(async () => ({ stdout }), async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.status, 200, `stdout=${JSON.stringify(stdout)}`);
      assert.equal(res.json.ok, false, `stdout=${JSON.stringify(stdout)}`);
      assert.match(res.json.error, /unrecognized/i);
    });
  }
});

test('GET /health/google maps a probe timeout to its own cause', async () => {
  await withServer(
    async () => {
      const err = new Error('Command failed: gog auth list --check --json');
      err.killed = true;
      err.signal = 'SIGTERM';
      throw err;
    },
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, false);
      assert.match(res.json.error, /timed out/i);
    },
  );
});

test('the google probe never echoes gog output into the response or the log', async () => {
  // gog's stdout/stderr are NOT relayed. The endpoint reports a cause drawn
  // from a closed vocabulary, so there is no path by which a credential in the
  // child's output can reach a response body or a log aggregator.
  const secret = 'ya29.a0AfB_by-super-secret-token';
  const lines = [];
  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => {
      const err = new Error(`Command failed: gog auth list --check (token ${secret})`);
      err.stderr = `refresh failed with ${secret}`;
      throw err;
    },
    log: (line) => lines.push(line),
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const { port } = server.address();
  let res;
  try {
    res = await request(`http://${LOOPBACK}:${port}`, {
      method: 'GET',
      path: '/health/google',
      headers: bearer(RUNNER_KEY),
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, false);
  assert.ok(!res.raw.includes(secret), res.raw);
  assert.ok(!res.raw.includes('Command failed'), res.raw);
  assert.ok(!lines.join('\n').includes(secret), lines.join('\n'));
  // It still leaves an operator-readable trace of the outcome.
  assert.match(lines.join('\n'), /\/health\/google 200/);
});

test('THE LOCKOUT GUARD: /health and /healthz still answer when gog is dead', async () => {
  // Layer 1 (connector key) and layer 2 (Google) must stay independent. The
  // re-auth tools are themselves MCP tools, reachable only AFTER the connector
  // connects — so if a dead Google credential could block /health, the user
  // would be locked out of the very tools that repair it. These two endpoints
  // must therefore never invoke gog, no matter how broken Google is.
  const spy = spyServer(async () => {
    throw new Error('gog must not be invoked by a layer-1 health check');
  });
  await withServer(spy.execFn, async (base) => {
    const healthz = await request(base, { method: 'GET', path: '/healthz' });
    assert.equal(healthz.status, 200);
    assert.deepEqual(healthz.json, { ok: true });

    const health = await request(base, {
      method: 'GET',
      path: '/health',
      headers: bearer(RUNNER_KEY),
    });
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { ok: true });
  });
  assert.equal(spy.calls.length, 0, 'a layer-1 health check must never spawn gog');
});

// ---------------------------------------------------------------------------
// `measured`: the field that keeps "I could not ask" out of "Google said no".
//
// REVIEW DEFECT. Before this, every non-healthy outcome was a bare `ok:false`,
// and both connector call sites branched on `ok === true` alone — so a probe
// that TIMED OUT, could not be RUN at all (no `gog` on PATH, no
// `credentials.json` on the volume), or returned output we could not parse was
// filed at error level as `connect.google-unhealthy` / `refusal.google-unhealthy`
// — the events whose documented meaning is "Google was asked and refused". An
// operator grepping event names would close the incident on evidence that was
// never gathered, and `refusal.google-ok` — the only record that can ever prove
// or kill the narrow theory — would be silently unreachable.
//
// `ok` answers "is the Google layer healthy". `measured` answers the strictly
// prior question: "did anything actually find out?" The two are independent, and
// only the pair can be read honestly.
// ---------------------------------------------------------------------------

test('every PROBE_CAUSES value is classified as measured or not, exactly once', () => {
  // The partition is what makes `measured` trustworthy: a cause added later
  // cannot quietly default into "we measured this".
  const causes = Object.values(PROBE_CAUSES);
  for (const cause of causes) {
    const inMeasured = MEASURED_CAUSES.has(cause);
    const inUnmeasured = UNMEASURED_CAUSES.has(cause);
    assert.ok(inMeasured !== inUnmeasured, `cause is in neither or both sets: ${cause}`);
  }
  assert.equal(MEASURED_CAUSES.size + UNMEASURED_CAUSES.size, causes.length);
  // And an unrecognised cause resolves toward "not measured" — the direction
  // that can only under-claim.
  assert.equal(MEASURED_CAUSES.has('something nobody wrote down'), false);
});

test('a probe that could not run reports measured:false, not a verdict about Google', async () => {
  // gog missing from PATH, credentials.json absent from the volume, an exec
  // that blew its budget. None of these is a fact about the refresh token.
  const cases = [
    {
      what: 'the command failed',
      throws: () => {
        const err = new Error('Command failed: gog auth list --check --json');
        err.stderr = 'gog: command not found';
        throw err;
      },
      error: PROBE_CAUSES.failed,
    },
    {
      what: 'the command timed out',
      throws: () => {
        const err = new Error('Command failed: gog auth list --check --json');
        err.killed = true;
        err.signal = 'SIGTERM';
        throw err;
      },
      error: PROBE_CAUSES.timedOut,
    },
  ];
  for (const { what, throws, error } of cases) {
    await withServer(async () => throws(), async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.status, 200, what);
      assert.equal(res.json.ok, false, what);
      assert.equal(res.json.measured, false, what);
      assert.equal(res.json.error, error, what);
    });
  }
});

test('output we cannot parse is measured:false — it says nothing about Google', async () => {
  for (const stdout of ['not json at all', '{"accounts":"nope"}', '']) {
    await withServer(async () => ({ stdout }), async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.measured, false, `stdout=${JSON.stringify(stdout)}`);
      assert.equal(res.json.error, PROBE_CAUSES.unparseable);
    });
  }
});

test('gog declining to report validity is measured:false', async () => {
  // The probe ran, the output parsed, and gog still did not say whether the
  // token works. That is an unanswered question, not a refusal.
  await withServer(
    async () => ({ stdout: JSON.stringify({ accounts: [{ email: 'me@example.com' }] }) }),
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, false);
      assert.equal(res.json.measured, false);
      assert.equal(res.json.error, PROBE_CAUSES.unknownValidity);
    },
  );
});

test('an account gogcli says it did NOT check is never counted as healthy', async () => {
  // gogcli's annotateAuthListCheck (internal/cmd/auth_list_helpers.go) marks a
  // service-account entry `valid:true, error:"service account (not checked)"`.
  // Taking that `valid:true` at face value would report health from a
  // credential nothing measured — this defect, one layer down.
  await withServer(
    async () => ({
      stdout: JSON.stringify({
        accounts: [
          {
            email: 'svc@proj.iam.gserviceaccount.com',
            auth: 'service-account',
            valid: true,
            error: 'service account (not checked)',
          },
        ],
      }),
    }),
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, false);
      assert.equal(res.json.measured, false);
      assert.equal(res.json.error, PROBE_CAUSES.notChecked);
    },
  );
});

test('an unchecked account poisons an otherwise healthy answer', async () => {
  // `ok` is an AND across accounts, so one unmeasured entry is enough: the
  // layer as a whole was not measured.
  await withServer(
    async () => ({
      stdout: JSON.stringify({
        accounts: [
          { email: 'me@example.com', valid: true },
          { email: 'svc@proj.iam.gserviceaccount.com', valid: true, error: 'service account (not checked)' },
        ],
      }),
    }),
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, false);
      assert.equal(res.json.measured, false);
      assert.equal(res.json.error, PROBE_CAUSES.notChecked);
    },
  );
});

test('outcomes that ARE facts about the credential report measured:true', async () => {
  const cases = [
    {
      what: 'a dead refresh token',
      stdout: JSON.stringify({
        accounts: [
          { email: 'me@example.com', valid: false, error: 'oauth2: "invalid_grant" "Token has been expired or revoked."' },
        ],
      }),
      error: PROBE_CAUSES.invalidGrant,
    },
    {
      what: 'an account that failed its live check for some other reason',
      stdout: JSON.stringify({
        accounts: [{ email: 'me@example.com', valid: false, error: 'oauth2: server refused' }],
      }),
      error: PROBE_CAUSES.invalidAccount,
    },
    {
      what: 'no account authorized at all',
      stdout: JSON.stringify({ accounts: [] }),
      error: PROBE_CAUSES.noAccounts,
    },
  ];
  for (const { what, stdout, error } of cases) {
    await withServer(async () => ({ stdout }), async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, false, what);
      assert.equal(res.json.measured, true, what);
      assert.equal(res.json.error, error, what);
    });
  }
});

test('a rejected probe that carried Google’s own invalid_grant IS a measurement', async () => {
  // gog exited non-zero, but its stderr contains Google's verdict — the probe
  // reached Google and was told no. That is measured.
  await withServer(
    async () => {
      const err = new Error('Command failed: gog auth list --check --json');
      err.stderr = 'oauth2: cannot fetch token: invalid_grant';
      throw err;
    },
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, false);
      assert.equal(res.json.measured, true);
      assert.equal(res.json.error, PROBE_CAUSES.invalidGrant);
    },
  );
});

test('a healthy answer is measured by construction', async () => {
  await withServer(
    async () => ({ stdout: JSON.stringify({ accounts: [{ email: 'me@example.com', valid: true }] }) }),
    async (base) => {
      const res = await request(base, {
        method: 'GET',
        path: '/health/google',
        headers: bearer(RUNNER_KEY),
      });
      assert.equal(res.json.ok, true);
      // ok:true without measured:true would be incoherent — health is a claim
      // only a measurement can license.
      assert.equal(res.json.measured, true);
    },
  );
});

test('the log line distinguishes a failed measurement from a failed credential', async () => {
  const lines = [];
  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => {
      const err = new Error('Command failed');
      err.killed = true;
      throw err;
    },
    log: (line) => lines.push(line),
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await request(`http://${LOOPBACK}:${port}`, {
      method: 'GET',
      path: '/health/google',
      headers: bearer(RUNNER_KEY),
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
  const joined = lines.join('\n');
  // "NOT MEASURED", not "FAILED": an operator reading the runner's own log must
  // not conclude the credential was refused either.
  assert.match(joined, /google-probe NOT MEASURED/);
  assert.doesNotMatch(joined, /google-probe FAILED/);
});

// Poll until `cond()` holds, failing the test rather than hanging forever.
async function waitUntil(cond, what, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('a probe the caller abandoned still records what the probe found', async () => {
  // The connector's patience (4 s: GOOGLE_PROBE_TIMEOUT_MS in connector-auth.ts,
  // REFUSAL_PROBE_TIMEOUT_MS in connector-runtime.ts) is deliberately shorter
  // than this side's 10 s budget, so "the caller walked away mid-probe" is a
  // DESIGNED outcome, not a fault. It is also the case where the runner's own
  // record matters most: nothing reaches the client at all, so this log line is
  // the only surviving account of what gog found — and gog is slow precisely
  // when Google is slow, which is the interesting case.
  //
  // `res.on('close')` fires at the abandonment, long before the probe has an
  // answer, so the request line went out with an empty tail and the verdict was
  // then written down nowhere.
  const lines = [];
  let startProbe;
  const probeStarted = new Promise((resolve) => { startProbe = resolve; });
  let releaseProbe;
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });

  const server = createServer({
    runnerKey: RUNNER_KEY,
    execFn: async () => {
      startProbe();
      await probeGate;
      return {
        stdout: JSON.stringify({
          accounts: [{ email: 'a@example.com', valid: false, error: 'invalid_grant: expired' }],
        }),
      };
    },
    log: (line) => lines.push(line),
  });
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const req = http.request({
      host: LOOPBACK,
      port,
      method: 'GET',
      path: '/health/google',
      headers: bearer(RUNNER_KEY),
    });
    req.on('error', () => {}); // we destroy this socket ourselves; ECONNRESET is expected
    req.end();
    await probeStarted;
    req.destroy();

    await waitUntil(() => lines.some((l) => l.includes('/health/google')), 'the abandoned request line');
    const abandoned = lines.find((l) => l.includes('/health/google'));
    assert.match(abandoned, /google-probe running/, 'says a probe was in flight');
    assert.match(abandoned, /abandoned/, 'and does not report a status the caller never received');

    // The verdict must still be written down once gog answers.
    releaseProbe();
    await waitUntil(() => lines.length >= 2, 'the probe outcome line');
    assert.match(lines.join('\n'), /google-probe FAILED: .*invalid_grant/);
  } finally {
    releaseProbe();
    server.close();
    await once(server, 'close');
  }
});
