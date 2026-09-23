import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, symlink, truncate, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import {
  uploadToBlobStore,
  ATTACHMENT_DOWNLOAD_ROOT,
  BLOB_UPLOAD_TIMEOUT_MS,
  MAX_BLOB_UPLOAD_BYTES,
} from '../src/blob-upload.js';

const SIG = 'AbCdEf-_1234';
const CONTENT = Buffer.from('%PDF-1.7 twelve bytes and a few more');

interface Received {
  method?: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

let server: Server;
let base: string;
let received: Received[];
let handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;
let root: string;
let outside: string;

function signedUrl(path = '/b/reg_1/gmail/m1/a1/Guest%20Copy.pdf'): string {
  return `${base}${path}?exp=1757000000000&sig=${SIG}`;
}

beforeEach(async () => {
  received = [];
  handler = (_req, res) => { res.writeHead(200); res.end(); };
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      received.push({ method: req.method, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const scratch = await mkdtemp(join(tmpdir(), 'blob-upload-'));
  root = join(scratch, 'gog-attachments');
  outside = join(scratch, 'outside');
  await mkdir(join(root, 'm1', 'a1'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'm1', 'a1', 'Guest_Copy.pdf'), CONTENT);
  await writeFile(join(outside, 'refresh-token'), 'secret');
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(join(root, '..'), { recursive: true, force: true });
});

const file = () => join(root, 'm1', 'a1', 'Guest_Copy.pdf');
const request = (overrides: Partial<{ path: string; url: string; contentType: string }> = {}) => ({
  path: file(),
  url: signedUrl(),
  contentType: 'application/pdf',
  ...overrides,
});
const failure = (promise: Promise<unknown>) => promise.then(
  () => { throw new Error('expected the upload to fail'); },
  (err: Error) => err,
);

describe('uploadToBlobStore', () => {
  it('PUTs the file to the signed URL and reports the size streamed and the status', async () => {
    handler = (_req, res) => { res.writeHead(201); res.end(); };

    const outcome = await uploadToBlobStore(request(), { root });

    expect(outcome).toEqual({ bytes: CONTENT.length, status: 201 });
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('PUT');
    expect(received[0].body.equals(CONTENT)).toBe(true);
    // Content-Length from the file's own size — a chunked PUT is a 411 at the
    // gateway, so this must never be left to the transport.
    expect(received[0].headers['content-length']).toBe(String(CONTENT.length));
    expect(received[0].headers['transfer-encoding']).toBeUndefined();
  });

  // The PUT signature commits to the content type, so any normalisation —
  // re-casing, a charset appended, a default substituted — is a refusal that
  // reads like a missing object.
  it('sends the content type byte for byte as given', async () => {
    await uploadToBlobStore(request({ contentType: 'Application/PDF; Name="x"' }), { root });

    expect(received[0].headers['content-type']).toBe('Application/PDF; Name="x"');
  });

  it('accepts a path relative to the root', async () => {
    await expect(uploadToBlobStore(request({ path: 'm1/a1/Guest_Copy.pdf' }), { root }))
      .resolves.toEqual({ bytes: CONTENT.length, status: 200 });
  });

  describe('confinement to the download root', () => {
    it('refuses a path that walks out of the root, without dialling', async () => {
      const err = await failure(uploadToBlobStore(
        request({ path: join(root, '..', 'outside', 'refresh-token') }), { root },
      ));

      expect(err.message).toMatch(/must be inside/);
      expect(received).toHaveLength(0);
    });

    it('refuses a sibling that merely shares the root as a prefix', async () => {
      await mkdir(`${root}-evil`);
      await writeFile(`${root}-evil/x`, 'nope');

      const err = await failure(uploadToBlobStore(request({ path: `${root}-evil/x` }), { root }));

      expect(err.message).toMatch(/must be inside/);
      expect(received).toHaveLength(0);
    });

    it('refuses a symlink inside the root that points outside it', async () => {
      await symlink(join(outside, 'refresh-token'), join(root, 'm1', 'escape'));

      const err = await failure(uploadToBlobStore(request({ path: join(root, 'm1', 'escape') }), { root }));

      expect(err.message).toMatch(/must be inside/);
      expect(received).toHaveLength(0);
    });

    it('refuses a directory', async () => {
      const err = await failure(uploadToBlobStore(request({ path: join(root, 'm1') }), { root }));

      expect(err.message).toMatch(/regular file/);
      expect(received).toHaveLength(0);
    });

    it('says the file is missing, rather than failing somewhere later', async () => {
      const err = await failure(uploadToBlobStore(request({ path: join(root, 'm1', 'gone.pdf') }), { root }));

      expect(err.message).toMatch(/could not be found/);
      expect(received).toHaveLength(0);
    });

    it('confines to the real attachment root when no root is given', async () => {
      // Per-user and private now (SEC-6), not the shared /tmp/gog-attachments.
      expect(ATTACHMENT_DOWNLOAD_ROOT).toBe(join(tmpdir(), `gogcli-mcp-attachments-${userInfo().uid}`));

      const err = await failure(uploadToBlobStore(request({ path: '/etc/passwd' })));

      expect(err.message).toContain(`must be inside ${ATTACHMENT_DOWNLOAD_ROOT}`);
      expect(received).toHaveLength(0);
    });
  });

  // mcp-host's blob store answers 413 past 100 MiB, but only after the whole
  // transfer has run — and a caller reads a late size error as a signing one.
  it('refuses a file over the blob store\'s ceiling before dialling', async () => {
    expect(MAX_BLOB_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    const big = join(root, 'm1', 'a1', 'huge.bin');
    await writeFile(big, '');
    await truncate(big, MAX_BLOB_UPLOAD_BYTES + 1); // sparse: no 100 MiB write

    const err = await failure(uploadToBlobStore(request({ path: big }), { root }));

    expect(err.message).toContain(`${MAX_BLOB_UPLOAD_BYTES + 1} bytes`);
    expect(err.message).toContain(String(MAX_BLOB_UPLOAD_BYTES));
    expect(received).toHaveLength(0);
  });

  it('refuses a URL that is not absolute http(s), without dialling', async () => {
    for (const url of ['not a url at all', 'ftp://blob.example/x', '']) {
      const err = await failure(uploadToBlobStore(request({ url }), { root }));
      expect(err.message).toMatch(/absolute http\(s\) URL/);
    }
    expect(received).toHaveLength(0);
  });

  it('throws with the blob store\'s status and a bounded quote of its answer', async () => {
    handler = (_req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'signature does not verify' }));
    };

    const err = await failure(uploadToBlobStore(request(), { root }));

    expect(err.message).toMatch(/403/);
    expect(err.message).toContain('signature does not verify');
  });

  it('quotes no more than a snippet of a long error body', async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.write('x'.repeat(400));
      setTimeout(() => {
        res.write('y'.repeat(400));
        setTimeout(() => res.end('z'.repeat(400)), 20);
      }, 20);
    };

    const err = await failure(uploadToBlobStore(request(), { root }));

    expect(err.message).toMatch(/500/);
    expect(err.message).not.toContain('z');
    expect(err.message.length).toBeLessThan(1000);
  });

  it('gives up at its total deadline rather than hanging the MCP request', async () => {
    handler = () => { /* never answers */ };

    const err = await failure(uploadToBlobStore(request(), { root, timeoutMs: 50 }));

    expect(err.message).toMatch(/did not finish within 50ms/);
  });

  it('keeps a deadline of its own by default', () => {
    expect(BLOB_UPLOAD_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  // A signed URL is a credential with up to 24 h of anybody-who-holds-it access
  // to the object, and everything thrown here is expected to be logged.
  describe('never lets the signed URL or its bare signature into a message', () => {
    it('scrubs the blob store quoting the request back', async () => {
      handler = (req, res) => { res.writeHead(403); res.end(`refused PUT ${base}${req.url} (sig ${SIG})`); };

      const err = await failure(uploadToBlobStore(request(), { root }));

      expect(err.message).not.toContain(signedUrl());
      expect(err.message).not.toContain(SIG);
      expect(err.message).toContain('<signed url>');
    });

    it('scrubs a transport failure', async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server = createServer();
      server.listen(0);

      const err = await failure(uploadToBlobStore(request(), { root }));

      expect(err.message).toMatch(/ECONNREFUSED/);
      expect(err.message).not.toContain(SIG);
    });

    it('scrubs a response severed mid-body', async () => {
      handler = (_req, res) => {
        res.writeHead(403, { 'content-length': '1000' });
        res.write('partial', () => res.socket?.destroy());
      };

      const err = await failure(uploadToBlobStore(request(), { root }));

      expect(err.message).toMatch(/upload to the blob store did not complete/);
      expect(err.message).not.toContain(SIG);
    });

    it('scrubs a TLS failure on an https URL', async () => {
      const url = signedUrl().replace('http:', 'https:');

      const err = await failure(uploadToBlobStore(request({ url }), { root }));

      expect(err.message).toMatch(/upload to the blob store did not complete/);
      expect(err.message).not.toContain(url);
      expect(err.message).not.toContain(SIG);
    });

    // `split('')` would cut the message into characters and interleave the
    // replacement between every one of them.
    it('leaves a message intact when the URL is empty', async () => {
      const err = await failure(uploadToBlobStore(request({ url: '' }), { root }));

      expect(err.message).not.toContain('<signed url>');
      expect(err.message).toMatch(/absolute http\(s\) URL/);
    });
  });
});
