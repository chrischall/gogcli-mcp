import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  blobStoreFromEnv,
  createBlobUrlMinter,
  readPayload,
  writePayload,
  BLOB_URL_MAX_TTL_MS,
  BLOB_URL_CEILING_MARGIN_MS,
  BLOB_URL_DEFAULT_TTL_MS,
} from '../src/blob-urls.js';

// ---------------------------------------------------------------------------
// Fixtures. These are VECTORS: the signatures below were computed against the
// payload shapes as mcp-host's `blob-key.ts` spells them, independently of this
// module's code. If a future edit changes how a payload is assembled — a
// separator, the order of the fields, the encoding of the MAC — these stop
// matching. That is the point.
// ---------------------------------------------------------------------------

const BASE_URL = 'https://mcp.example.com/b/reg_0123456789abcdef01234567';
const SIGNING_KEY = 'test-blob-signing-key';
const REGISTRATION_ID = 'reg_0123456789abcdef01234567';
const REST = 'gmail/attachments/report.pdf';
const OBJECT_KEY = `${REGISTRATION_ID}/${REST}`;
const EXP = 1767225600000;
const NOW = EXP - BLOB_URL_DEFAULT_TTL_MS;

/** base64url(HMAC-SHA256(SIGNING_KEY, `<key>\n<exp>`)). */
const READ_SIG = 'KrMn62kcDi-i9wW3JLvbZJdas4gP-EQuYoO-XMhcpNQ';
/** base64url(HMAC-SHA256(SIGNING_KEY, `put\0<key>\0application/pdf\0<exp>`)). */
const WRITE_PDF_SIG = 'qHPIRvchnjsbE8lam5dft3pIDBZu6Ae0HWZIG7kC9DQ';
/** The same key and exp, signed for `text/plain` instead. */
const WRITE_TEXT_SIG = 'FHtUlUVeEuREdbdKENy8rDU2ZETBQKF6V9IfaIWwWWo';

function sign(payload: string): string {
  return createHmac('sha256', SIGNING_KEY)
    .update(payload, 'utf8')
    .digest('base64url');
}

const minter = () => createBlobUrlMinter({ baseUrl: BASE_URL, signingKey: SIGNING_KEY });

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe('payload shapes', () => {
  it('signs a read as `<key>\\n<exp>` — a newline, never a NUL', () => {
    const payload = readPayload(OBJECT_KEY, EXP);
    expect(payload).toBe('reg_0123456789abcdef01234567/gmail/attachments/report.pdf\n1767225600000');
    expect(payload).toContain('\n');
    expect(payload).not.toContain('\0');
  });

  it('signs a write as `put\\0<key>\\0<ct>\\0<exp>` — NUL-separated, content type inside', () => {
    const payload = writePayload(OBJECT_KEY, 'application/pdf', EXP);
    // The NUL is written as a `\u0000` escape, never `\0`: `\0` followed by a
    // DIGIT is a legacy octal escape, so `'\01767…'` is U+0001 + "767…" — the
    // vector then silently pins the wrong bytes (it did, on this test's first run).
    expect(payload).toBe(
      'put\u0000reg_0123456789abcdef01234567/gmail/attachments/report.pdf\u0000application/pdf\u00001767225600000',
    );
    expect(payload.split('\0')).toEqual([
      'put',
      OBJECT_KEY,
      'application/pdf',
      String(EXP),
    ]);
    expect(payload).not.toContain('\n');
  });

  it('never lets the two shapes converge', () => {
    expect(readPayload(OBJECT_KEY, EXP)).not.toBe(writePayload(OBJECT_KEY, 'application/pdf', EXP));
    // A read signature must be unreplayable as a write, whatever the content type.
    expect(sign(readPayload(OBJECT_KEY, EXP))).not.toBe(
      sign(writePayload(OBJECT_KEY, '', EXP)),
    );
  });
});

describe('createBlobUrlMinter', () => {
  it('takes the registration id from the base URL\'s last path segment', () => {
    expect(minter().registrationId).toBe(REGISTRATION_ID);
  });

  it('mints a GET URL matching the pinned read vector', () => {
    const url = minter().getUrl(REST, { now: NOW });
    expect(url).toBe(
      `${BASE_URL}/gmail/attachments/report.pdf?exp=${EXP}&sig=${READ_SIG}`,
    );
    expect(params(url).get('sig')).toBe(sign(readPayload(OBJECT_KEY, EXP)));
  });

  it('mints a PUT URL matching the pinned write vector', () => {
    const target = minter().putUrl(REST, 'application/pdf', { now: NOW });
    expect(target.url).toBe(
      `${BASE_URL}/gmail/attachments/report.pdf?exp=${EXP}&sig=${WRITE_PDF_SIG}`,
    );
    expect(params(target.url).get('sig')).toBe(
      sign(writePayload(OBJECT_KEY, 'application/pdf', EXP)),
    );
  });

  it('carries the content type it signed BACK with the URL', () => {
    // The one field the gateway checks that no test in this repo can: it
    // rebuilds the payload from the PUT's own `content-type` header
    // (`gateway/src/blob.ts`, defaulting to application/octet-stream when the
    // header is absent), so a caller that drops the header, lets an HTTP
    // library default it, or re-cases it gets a 404 signature mismatch. Handing
    // back a URL alone makes that a thing the uploader has to REMEMBER; handing
    // back the pair makes it a thing it cannot drop.
    const target = minter().putUrl(REST, 'application/pdf', { now: NOW });
    expect(target.contentType).toBe('application/pdf');
    expect(Object.keys(target).sort()).toEqual(['contentType', 'url']);
  });

  it('changes the signature when the content type changes', () => {
    const pdf = params(minter().putUrl(REST, 'application/pdf', { now: NOW }).url).get('sig');
    const text = params(minter().putUrl(REST, 'text/plain', { now: NOW }).url).get('sig');
    expect(pdf).toBe(WRITE_PDF_SIG);
    expect(text).toBe(WRITE_TEXT_SIG);
    expect(pdf).not.toBe(text);
  });

  it('builds the object key as `<registrationId>/<rest>`, slashes and all', () => {
    const url = minter().getUrl('a/b/c.pdf', { now: NOW });
    // Raw, not `new URL(url).pathname` — same reason as the encoding cases below.
    expect(url.split('?')[0]).toBe(`${BASE_URL}/a/b/c.pdf`);
    expect(params(url).get('sig')).toBe(
      sign(readPayload(`${REGISTRATION_ID}/a/b/c.pdf`, EXP)),
    );
  });

  it('percent-encodes each URL segment while signing the logical key', () => {
    const url = minter().getUrl('in box/a b.pdf', { now: NOW });
    // Asserted on the RAW string the module returned, never through
    // `new URL(url).pathname`: the parser percent-encodes a space itself on the
    // way in, so a parsed pathname reads identically whether this module
    // encoded anything or not — deleting `encodeURIComponent` from the wire
    // left that assertion green (the one mutation of 25 that survived review).
    expect(url).toBe(
      `${BASE_URL}/in%20box/a%20b.pdf?exp=${EXP}&sig=${sign(readPayload(`${REGISTRATION_ID}/in box/a b.pdf`, EXP))}`,
    );
    // The gateway decodes per segment before it verifies, so the SIGNED key is
    // the logical one — an encoded key here would 404 on every space.
    expect(params(url).get('sig')).toBe(
      sign(readPayload(`${REGISTRATION_ID}/in box/a b.pdf`, EXP)),
    );
  });

  it('percent-encodes a `#` on the wire, so the query is still a query', () => {
    // `Invoice #1234.pdf` is an ordinary Gmail attachment name, and it is the
    // case a URL parser will NOT repair for us: unencoded, everything from the
    // `#` is a FRAGMENT, so `?exp=&sig=` never reaches the gateway and the
    // answer is 403 "missing signature" with nothing to debug. `?` truncates
    // the path the same way. Raw string again, for the reason above.
    const url = minter().getUrl('Invoice #1234.pdf', { now: NOW });
    expect(url).toBe(
      `${BASE_URL}/Invoice%20%231234.pdf?exp=${EXP}&sig=${sign(readPayload(`${REGISTRATION_ID}/Invoice #1234.pdf`, EXP))}`,
    );
    expect(url).not.toContain('#');
    expect(params(url).get('sig')).toBe(
      sign(readPayload(`${REGISTRATION_ID}/Invoice #1234.pdf`, EXP)),
    );
  });

  it('tolerates a trailing slash on the base URL', () => {
    const m = createBlobUrlMinter({ baseUrl: `${BASE_URL}/`, signingKey: SIGNING_KEY });
    expect(m.registrationId).toBe(REGISTRATION_ID);
    expect(m.getUrl(REST, { now: NOW })).toBe(
      `${BASE_URL}/gmail/attachments/report.pdf?exp=${EXP}&sig=${READ_SIG}`,
    );
  });

  it('defaults the expiry to one hour', () => {
    const exp = Number(params(minter().getUrl(REST, { now: NOW })).get('exp'));
    expect(exp - NOW).toBe(BLOB_URL_DEFAULT_TTL_MS);
    expect(BLOB_URL_DEFAULT_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('honours a shorter ttl', () => {
    const exp = Number(params(minter().getUrl(REST, { now: NOW, ttlMs: 5000 })).get('exp'));
    expect(exp).toBe(NOW + 5000);
  });

  it('clamps the expiry UNDER the gateway\'s 24-hour ceiling rather than trusting the caller', () => {
    const exp = Number(
      params(minter().getUrl(REST, { now: NOW, ttlMs: 7 * 24 * 60 * 60 * 1000 })).get('exp'),
    );
    expect(exp).toBe(NOW + BLOB_URL_MAX_TTL_MS - BLOB_URL_CEILING_MARGIN_MS);
    expect(BLOB_URL_MAX_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('never mints an exp AT the ceiling, so a clock a hair ahead is not a 403', () => {
    // `blob.ts` refuses with a strict `exp > Date.now() + MAX_TTL_MS`, judged on
    // the GATEWAY's clock against an exp computed on the CHILD's. Landing
    // exactly on the ceiling leaves zero skew budget: one millisecond of the
    // child running ahead is a hard 403 "expiry out of range", whose message
    // names no cause the caller can act on. And BLOB_URL_MAX_TTL_MS is exported,
    // so `ttlMs: BLOB_URL_MAX_TTL_MS` is the natural way to ask for the longest
    // legal link — the API invites exactly the request that would break.
    for (const ttlMs of [BLOB_URL_MAX_TTL_MS, BLOB_URL_MAX_TTL_MS + 1, Number.MAX_SAFE_INTEGER]) {
      const exp = Number(params(minter().getUrl(REST, { now: NOW, ttlMs })).get('exp'));
      expect(exp).toBeLessThan(NOW + BLOB_URL_MAX_TTL_MS);
      expect(exp).toBe(NOW + BLOB_URL_MAX_TTL_MS - BLOB_URL_CEILING_MARGIN_MS);
    }
    expect(BLOB_URL_CEILING_MARGIN_MS).toBeGreaterThan(0);
  });

  it('clamps a zero or negative ttl up to one second, never to an already-dead link', () => {
    expect(Number(params(minter().getUrl(REST, { now: NOW, ttlMs: 0 })).get('exp'))).toBe(NOW + 1000);
    expect(Number(params(minter().getUrl(REST, { now: NOW, ttlMs: -1 })).get('exp'))).toBe(NOW + 1000);
  });

  it('reads the clock when no `now` is given', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      expect(minter().getUrl(REST)).toBe(
        `${BASE_URL}/gmail/attachments/report.pdf?exp=${EXP}&sig=${READ_SIG}`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'https://mcp.example.com/b/',
    'https://mcp.example.com/b',
    'https://mcp.example.com/',
    'https://mcp.example.com',
  ])('refuses the base URL %j — no registration id in the path', (baseUrl) => {
    expect(() => createBlobUrlMinter({ baseUrl, signingKey: 'k' }))
      .toThrow(/registration id/i);
  });

  it('refuses a base URL that is not a URL', () => {
    expect(() => createBlobUrlMinter({ baseUrl: 'not a url', signingKey: 'k' }))
      .toThrow(/MCP_BLOB_BASE_URL/);
  });

  it('refuses an empty signing key', () => {
    expect(() => createBlobUrlMinter({ baseUrl: BASE_URL, signingKey: '' }))
      .toThrow(/MCP_BLOB_SIGNING_KEY/);
  });

  it.each([
    ['', 'empty'],
    ['/', 'empty segment'],
    ['a//b', 'empty segment'],
    ['../etc/passwd', 'traversal'],
    ['a/./b', 'traversal'],
    ['a/../b', 'traversal'],
  ])('refuses the object path %j (%s)', (rest) => {
    // The gateway refuses these outright rather than normalising them, so a URL
    // minted for one would 404 at the door. Fail here, where the message can say why.
    expect(() => minter().getUrl(rest, { now: NOW })).toThrow(/object path/i);
  });

  // EVERY refusal this module makes, not only the one easiest to reach. The key
  // is a credential and so is a signed URL, while an error message is the one
  // value here that is EXPECTED to be logged — so the guard has to bind the
  // constructor's three refusals as well as the mint-time one. With only the
  // `../escape` case it did not: rewriting the unparseable-base-URL throw to
  // interpolate `config.signingKey` left the whole suite green.
  it.each([
    ['empty signing key', () => createBlobUrlMinter({ baseUrl: BASE_URL, signingKey: '' })],
    ['unparseable base URL', () => createBlobUrlMinter({ baseUrl: 'not a url', signingKey: SIGNING_KEY })],
    ['base URL with no registration id', () => createBlobUrlMinter({ baseUrl: 'https://mcp.example.com/b/', signingKey: SIGNING_KEY })],
    ['refused object path', () => minter().getUrl('../escape', { now: NOW })],
  ])('never puts the signing key or a signed URL in the error for a %s', (_label, refuse) => {
    try {
      refuse();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(String(err)).not.toContain(SIGNING_KEY);
      expect(String(err)).not.toContain('sig=');
    }
  });
});

describe('blobStoreFromEnv', () => {
  it('returns the pair when both variables are set', () => {
    vi.stubEnv('MCP_BLOB_BASE_URL', BASE_URL);
    vi.stubEnv('MCP_BLOB_SIGNING_KEY', SIGNING_KEY);
    expect(blobStoreFromEnv()).toEqual({ baseUrl: BASE_URL, signingKey: SIGNING_KEY });
  });

  it('returns undefined on a local stdio install, where neither is set', () => {
    vi.stubEnv('MCP_BLOB_BASE_URL', '');
    vi.stubEnv('MCP_BLOB_SIGNING_KEY', '');
    expect(blobStoreFromEnv()).toBeUndefined();
  });

  it('returns undefined when only the base URL is set', () => {
    vi.stubEnv('MCP_BLOB_BASE_URL', BASE_URL);
    vi.stubEnv('MCP_BLOB_SIGNING_KEY', '');
    expect(blobStoreFromEnv()).toBeUndefined();
  });

  it('returns undefined when only the signing key is set', () => {
    vi.stubEnv('MCP_BLOB_BASE_URL', '');
    vi.stubEnv('MCP_BLOB_SIGNING_KEY', SIGNING_KEY);
    expect(blobStoreFromEnv()).toBeUndefined();
  });

  it('treats an unresolved .mcpb placeholder as unset', () => {
    vi.stubEnv('MCP_BLOB_BASE_URL', '${user_config.blob_base_url}');
    vi.stubEnv('MCP_BLOB_SIGNING_KEY', SIGNING_KEY);
    expect(blobStoreFromEnv()).toBeUndefined();
  });
});
