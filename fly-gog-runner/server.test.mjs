import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createServer, sanitizedEnv, readBody, MAX_BODY_BYTES, installGracefulShutdown } from './server.mjs';

const RUNNER_KEY = 'test-runner-key-123';

// Spin up a createServer instance on an ephemeral port for one test, invoke the
// callback with a base URL, then close it.
async function withServer(execFn, fn) {
  const server = createServer({ runnerKey: RUNNER_KEY, execFn });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
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
    { name: 'over-long arg', body: JSON.stringify({ args: ['x'.repeat(4097)] }) },
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
    assert.equal(env.BENIGN_VAR, 'keep-me');
    assert.ok('PATH' in env);
  } finally {
    for (const k of ['RUNNER_KEY', 'GOG_ACCESS_TOKEN', 'GITHUB_TOKEN', 'SOME_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS', 'PORT', 'GOG_HOME', 'BENIGN_VAR']) {
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
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

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
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

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
  server.listen(0);
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
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

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
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

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
