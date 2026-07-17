import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createServer, sanitizedEnv, readBody, MAX_BODY_BYTES } from './server.mjs';

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

test('POST /run returns 502 {error,stderr} on execFn failure', async () => {
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
    assert.equal(res.status, 502);
    assert.equal(res.json.error, 'gog exited with code 1');
    assert.equal(res.json.stderr, 'boom: bad flag');
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
