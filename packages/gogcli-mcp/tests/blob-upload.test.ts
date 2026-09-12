import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadToBlobStore, RUNNER_UPLOAD_TIMEOUT_MS } from '../src/blob-upload.js';

// A minted PUT URL, with the two shapes the scrubber has to recognise: the
// whole string, and the bare signature it carries.
const SIG = 'AbCdEf-_1234';
const PUT_URL = `https://host.example/b/reg_1/gmail/m1/Guest%20Copy.pdf?exp=1757000000000&sig=${SIG}`;

const ENV = { GOG_RUNNER_URL: 'https://runner.example', GOG_RUNNER_KEY: 'runner-key' };

const REQUEST = { path: '/tmp/gog-attachments/m1/Guest_Copy.pdf', url: PUT_URL, contentType: 'application/pdf' };

function answers(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return vi.fn(async () => ({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('uploadToBlobStore', () => {
  it('POSTs the path, the URL and the content type to the runner, bearing its key', async () => {
    const fetchMock = answers(200, { ok: true, status: 200, bytes: 99723 });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await uploadToBlobStore(REQUEST, { env: { ...ENV, GOG_RUNNER_URL: 'https://runner.example//' } });

    expect(outcome).toEqual({ bytes: 99723, status: 200 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Trailing slashes trimmed — `<endpoint>//upload` is a different route.
    expect(url).toBe('https://runner.example/upload');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer runner-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      path: REQUEST.path,
      url: PUT_URL,
      contentType: 'application/pdf',
    });
    // A deadline of our own: the runner's 120 s is an INACTIVITY timer and
    // cannot bound a transfer that keeps dribbling, so nothing else protects
    // the MCP caller from a request that never ends.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses, without dialling, when no gog runner is configured', async () => {
    const fetchMock = answers(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadToBlobStore(REQUEST, { env: { GOG_RUNNER_URL: ENV.GOG_RUNNER_URL } }))
      .rejects.toThrow(/GOG_RUNNER_URL.*GOG_RUNNER_KEY/s);
    await expect(uploadToBlobStore(REQUEST, { env: { GOG_RUNNER_KEY: ENV.GOG_RUNNER_KEY } }))
      .rejects.toThrow(/GOG_RUNNER_URL.*GOG_RUNNER_KEY/s);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the blob store\'s own verdict when the runner relays a refusal', async () => {
    vi.stubGlobal('fetch', answers(422, {
      error: 'the blob store refused the upload with 403: forbidden',
      status: 403,
      retryable: false,
    }));

    await expect(uploadToBlobStore(REQUEST, { env: ENV }))
      .rejects.toThrow(/the blob store refused the upload with 403: forbidden/);
  });

  it('names the runner\'s status when it answers with no error text', async () => {
    vi.stubGlobal('fetch', answers(502, { retryable: true }));

    await expect(uploadToBlobStore(REQUEST, { env: ENV })).rejects.toThrow(/502/);
  });

  it('survives an answer that is not JSON at all (a proxy\'s HTML error page)', async () => {
    vi.stubGlobal('fetch', answers(504, '<html>gateway timeout</html>'));

    // The body is quoted, not parsed — and the throw is about the upload, never
    // a SyntaxError from somewhere inside this module.
    await expect(uploadToBlobStore(REQUEST, { env: ENV })).rejects.toThrow(/504/);
  });

  // A signed URL is a credential with up to 24 h of anybody-who-holds-it access
  // to the object. The runner scrubs its own words, but the far side's text is
  // a third party's and may quote the request URL straight back — and an error
  // thrown here is the one value on this path that is expected to be logged.
  it('never lets the signed URL, or its bare signature, into the error it throws', async () => {
    vi.stubGlobal('fetch', answers(422, { error: `refused: PUT ${PUT_URL} (sig ${SIG})`, status: 403 }));

    const err = await uploadToBlobStore(REQUEST, { env: ENV }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(PUT_URL);
    expect((err as Error).message).not.toContain(SIG);
    expect((err as Error).message).toContain('<signed url>');
  });

  it('scrubs a transport failure too — a rejected fetch may quote the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while sending ${PUT_URL}`);
    }));

    const err = await uploadToBlobStore(REQUEST, { env: ENV }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(PUT_URL);
    expect((err as Error).message).not.toContain(SIG);
    expect((err as Error).message).toContain('ECONNREFUSED');
  });

  it('reports a transport failure that threw something other than an Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'socket hang up'; }));

    await expect(uploadToBlobStore(REQUEST, { env: ENV })).rejects.toThrow(/socket hang up/);
  });

  // The response ARRIVES and then its body fails to read — a severed or
  // truncated answer. That is a third shape of transport failure, and the
  // module's contract is about every one of them: nothing it throws carries the
  // URL. undici's own body errors ('terminated', 'Premature close') happen to
  // name nothing, so this is the guarantee being a property of the function
  // rather than a fact about today's runtime.
  it('scrubs a body that fails to read, as it scrubs a failed dial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => { throw new Error(`terminated while reading ${PUT_URL}`); },
    })));

    const err = await uploadToBlobStore(REQUEST, { env: ENV }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(PUT_URL);
    expect((err as Error).message).not.toContain(SIG);
    expect((err as Error).message).toContain('terminated');
  });

  it('reports a body read that rejected with something other than an Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => { throw 'premature close'; },
    })));

    await expect(uploadToBlobStore(REQUEST, { env: ENV })).rejects.toThrow(/premature close/);
  });

  // The whole-string replacement is what does the work for a URL with no `sig`
  // at all — and a URL that is not parseable must still be redacted rather than
  // throwing on the way to a redaction.
  it('scrubs a URL that carries no signature and does not parse', async () => {
    const odd = 'not a url at all';
    vi.stubGlobal('fetch', answers(422, { error: `refused: ${odd}`, status: 400 }));

    const err = await uploadToBlobStore({ ...REQUEST, url: odd }, { env: ENV }).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(odd);
    expect((err as Error).message).toContain('<signed url>');
  });

  // `split('')` cuts a message into single characters and interleaves the
  // replacement between every one of them, so an empty needle does not redact a
  // message, it destroys it. Today's one call site always mints a URL first —
  // this is a property of the function, which is why it is asserted on it.
  it('an empty URL leaves the message intact rather than shredding it', async () => {
    vi.stubGlobal('fetch', answers(422, { error: 'the blob store refused the upload', status: 403 }));

    const err = await uploadToBlobStore({ ...REQUEST, url: '' }, { env: ENV }).catch((e: Error) => e);
    expect((err as Error).message).toContain('the blob store refused the upload');
    expect((err as Error).message).not.toContain('<signed url>');
  });

  it('reads the ambient environment, and its own deadline, when given neither', async () => {
    const fetchMock = answers(200, { ok: true, status: 200, bytes: 12 });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GOG_RUNNER_URL', ENV.GOG_RUNNER_URL);
    vi.stubEnv('GOG_RUNNER_KEY', ENV.GOG_RUNNER_KEY);

    await expect(uploadToBlobStore(REQUEST)).resolves.toEqual({ bytes: 12, status: 200 });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://runner.example/upload');
  });

  it('exposes its deadline as a constant rather than a literal at the call site', () => {
    expect(RUNNER_UPLOAD_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  // The rule this repo already applies at the other hop (`DEADLINE_GRACE_MS` in
  // connector-runtime.ts: 30 s backend budget + 5 s): the CALLER's deadline sits
  // ABOVE the backend's own, so the backend loses the race only when it
  // genuinely cannot answer. The doc block here cited that rule while the
  // numbers inverted it — 90 s against the runner's 120 s — so a socket that
  // went quiet was aborted on this side 30 s before the runner's own timer could
  // name it, turning "the upload timed out after 120000ms" into exactly the
  // opaque client abort the rule exists to prevent.
  //
  // Restated rather than imported: `fly-gog-runner/server.mjs` must not be
  // pulled into the Worker bundle (the same reason the attachment ceilings are
  // restated in attachments.ts), so the two move by hand and this is the guard.
  it('sits above the runner\'s own upload timeout, so the runner answers first', () => {
    const UPLOAD_TIMEOUT_MS_ON_THE_BOX = 120_000; // server.mjs UPLOAD_TIMEOUT_MS
    expect(RUNNER_UPLOAD_TIMEOUT_MS).toBeGreaterThan(UPLOAD_TIMEOUT_MS_ON_THE_BOX);
  });
});
