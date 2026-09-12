import { createHmac } from 'node:crypto';
import { readEnvVar } from '@chrischall/mcp-utils';

/**
 * Signed URLs for mcp-host's per-registration blob store.
 *
 * ## Why this exists
 *
 * A hosted MCP has no HTTP surface of its own — mcp-host proxies MCP protocol
 * to a stdio child and nothing else — so there is no way for a tool to hand an
 * agent BYTES. `gog_gmail_attachment` works around that by uploading to the
 * user's Drive and returning a `webViewLink`, which needs a Google session to
 * open (so `curl` cannot), writes a file into the user's Drive as a side effect
 * of reading mail, and is refused outright under `GOG_READONLY`.
 *
 * mcp-host answers this with a blob store at `/b/<registrationId>/<rest>` that
 * sits OUTSIDE OAuth: a signed URL is the entire access control. A registration
 * receives two variables at spawn —
 *
 *   MCP_BLOB_BASE_URL     https://<host>/b/<registrationId>
 *   MCP_BLOB_SIGNING_KEY  that registration's derived key
 *
 * — and mints its own links. Neither exists on a local stdio install, which is
 * why {@link blobStoreFromEnv} answers `undefined` rather than throwing: the
 * absence is a fact about the host, and the CALLER is the one that knows
 * whether the delivery mode the user asked for needs it.
 *
 * ## The payload shapes
 *
 * Transcribed from mcp-host's `gateway/src/blob-key.ts`, which is what verifies
 * them:
 *
 *   GET    signs  `<key>\n<exp>`
 *   PUT    signs  `put\0<key>\0<ct>\0<exp>`
 *   PUT†   signs  `putp\0<key>\0<ct>\0<exp>`   (retention-exempt — not minted here)
 *   DELETE signs  `del\0<key>\0<exp>`
 *   LIST   signs  `list\0<relPrefix>\0<exp>`
 *
 * The shapes MUST NOT converge, which is why a read payload carries a newline
 * and never a NUL while every other verb is NUL-separated behind a distinct
 * leading word. A signature that lets someone READ an object can then never be
 * replayed to overwrite or destroy it. The write payload commits to the content
 * type as well, so a signature for a PDF cannot be spent storing a script at the
 * same key — which in turn means the `Content-Type` header on the PUT must be
 * byte-identical to the one signed, or the signature simply does not verify.
 *
 * Only the two verbs this repo needs are minted: a read and an ordinary write.
 * Adding a third means adding its shape, not generalising these two.
 *
 * ## Where this belongs
 *
 * In `@chrischall/mcp-utils`, the moment a SECOND MCP needs it. It lives here
 * now only to avoid a cross-repo release chain for one feature. mcp-host's own
 * blob-store doc makes the argument for moving it: N MCPs re-implementing the
 * signing is N chances to get the security-critical part wrong, and the part
 * that is easy to get wrong is exactly the part below — which bytes are signed,
 * and which of them are percent-encoded on the way into the URL.
 *
 * `node:crypto` rather than WebCrypto (which `google-token.ts` uses, for the
 * Worker build): HMAC through `crypto.subtle` is async, and a URL minter that
 * returns a promise infects every call site for no gain here. The Worker build
 * sets `nodejs_compat` (wrangler.jsonc), so `createHmac` resolves there too if
 * this module is ever pulled into that graph.
 */

/**
 * The gateway refuses an `exp` more than 24 hours out (`MAX_TTL_MS` in
 * `gateway/src/blob.ts`) — "a far-future exp is a signature that never stops
 * working". Clamped rather than validated: the caller asking for a week should
 * get a working day-long link, not a rejection they cannot act on.
 */
export const BLOB_URL_MAX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How far UNDER that ceiling the longest link we will mint sits.
 *
 * The gateway's refusal is strict (`exp > Date.now() + MAX_TTL_MS`) and it is
 * judged on the GATEWAY's clock against an `exp` computed on this child's, so
 * landing exactly on the ceiling leaves no skew budget at all: one millisecond
 * of this process running ahead is a hard 403 whose message names no cause the
 * caller can act on. `BLOB_URL_MAX_TTL_MS` is exported, so `ttlMs:
 * BLOB_URL_MAX_TTL_MS` is the natural way to ask for the longest legal link —
 * the API would otherwise invite exactly the request that breaks.
 *
 * A minute: far more than two well-behaved clocks drift, and irrelevant
 * against a 24-hour link.
 */
export const BLOB_URL_CEILING_MARGIN_MS = 60 * 1000;

/**
 * One hour.
 *
 * A signed URL IS a credential — anyone holding it reads the object, with no
 * session and no bearer — so its lifetime is the window in which a leak is
 * spendable, and the only reason to lengthen it is a consumer that comes back
 * late. Nothing here does: an agent handed a download link fetches it within
 * the same turn. An hour is far more than that needs while still surviving a
 * slow client, a retry, and a person who copies the link into a terminal.
 */
export const BLOB_URL_DEFAULT_TTL_MS = 60 * 60 * 1000;

/** The smallest link worth minting. A `ttlMs` of 0 would be dead on arrival. */
const MIN_TTL_MS = 1000;

/** The two variables mcp-host hands a child at spawn. */
export interface BlobStoreConfig {
  /** `https://<host>/b/<registrationId>` — MCP_BLOB_BASE_URL. */
  baseUrl: string;
  /** That registration's derived key — MCP_BLOB_SIGNING_KEY. */
  signingKey: string;
}

export interface MintOptions {
  /** Link lifetime, clamped into [1s, 24h]. Defaults to {@link BLOB_URL_DEFAULT_TTL_MS}. */
  ttlMs?: number;
  /** Epoch ms to measure the expiry from. Defaults to the clock; injected by tests. */
  now?: number;
}

/**
 * A signed write URL and the content type that URL's signature commits to.
 *
 * They travel together because they are only correct together — see
 * `BlobUrlMinter.putUrl`.
 */
export interface BlobPutTarget {
  readonly url: string;
  readonly contentType: string;
}

export interface BlobUrlMinter {
  /** The last path segment of the base URL — the prefix every object key sits under. */
  readonly registrationId: string;
  /**
   * A URL that STORES bytes at `rest`, WITH the content type it was signed
   * under.
   *
   * The pair rather than the URL alone, because the gateway rebuilds the write
   * payload from the PUT's own `content-type` header: a caller that drops the
   * header, lets an HTTP library default it, or re-cases it produces a
   * signature that does not verify, and the refusal looks like a missing
   * object rather than a wrong header. Returning the URL by itself makes that
   * a thing the uploader has to remember; returning both makes it one it
   * cannot drop.
   *
   * The PUT must also send `Content-Length` — the gateway answers 411 without
   * one, and `Number(null)` is 0, so an absent length is not read as empty.
   */
  putUrl(rest: string, contentType: string, options?: MintOptions): BlobPutTarget;
  /** A URL that READS the object at `rest`. */
  getUrl(rest: string, options?: MintOptions): string;
}

/** `<key>\n<exp>` — the read shape. Newline, never a NUL. */
export function readPayload(objectKey: string, exp: number): string {
  return `${objectKey}\n${exp}`;
}

/** `put\0<key>\0<ct>\0<exp>` — the ordinary write shape. */
export function writePayload(objectKey: string, contentType: string, exp: number): string {
  return `put\0${objectKey}\0${contentType}\0${exp}`;
}

function sign(signingKey: string, payload: string): string {
  return createHmac('sha256', signingKey).update(payload, 'utf8').digest('base64url');
}

/**
 * Split `rest` into the segments the gateway will see, refusing the ones it
 * refuses.
 *
 * `parsePath` in `gateway/src/blob.ts` decodes each segment and then rejects
 * any that is empty, `.` or `..` — deliberately rejecting rather than
 * normalising, "because normalising means the bytes signed and the bytes used
 * are different strings". So a URL minted for one of these can never be spent;
 * refusing here turns a silent 404 at the door into a message at the call site.
 */
function objectPathSegments(rest: string): string[] {
  const segments = rest.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    // Names the offending path, never the key or the URL.
    throw new Error(
      `invalid blob object path ${JSON.stringify(rest)}: every segment must be non-empty and neither "." nor ".."`,
    );
  }
  return segments;
}

function expiryFor(options: MintOptions | undefined): number {
  const now = options?.now ?? Date.now();
  const requested = options?.ttlMs ?? BLOB_URL_DEFAULT_TTL_MS;
  const ceiling = BLOB_URL_MAX_TTL_MS - BLOB_URL_CEILING_MARGIN_MS;
  return now + Math.min(Math.max(requested, MIN_TTL_MS), ceiling);
}

/**
 * A minter bound to one registration's base URL and key.
 *
 * Throws on a base URL it cannot read a registration id out of, or an empty
 * key — both are configuration faults, and half-working here would mint links
 * that 404 later with nothing to point at.
 */
export function createBlobUrlMinter(config: BlobStoreConfig): BlobUrlMinter {
  if (!config.signingKey) {
    throw new Error('MCP_BLOB_SIGNING_KEY is empty — cannot sign blob-store URLs');
  }

  let parsed: URL;
  try {
    parsed = new URL(config.baseUrl);
  } catch {
    // The value itself is not a secret, but it is not worth echoing either.
    throw new Error('MCP_BLOB_BASE_URL is not a valid URL');
  }

  // `https://<host>/b/<registrationId>`, with or without a trailing slash. The
  // registration id is the LAST path segment, and it is also the first segment
  // of every object key — the gateway derives the signing key from the id in
  // the PATH, so the two must be the same string.
  //
  // Two segments are required, not one. On "last segment" alone a base URL of
  // `…/b/` — the store's mount with the id missing — reads as the id `b`, and
  // is indistinguishable from a tolerated trailing slash. Since the store is
  // always mounted under a prefix (`/b/<id>`; `handleBlob` matches nothing
  // else), a single-segment path is a misconfiguration, and saying so here
  // beats minting links that 404 at the door with nothing to point at.
  const pathSegments = parsed.pathname.split('/').filter((seg) => seg !== '');
  const registrationId = pathSegments.length >= 2 ? pathSegments[pathSegments.length - 1] : undefined;
  if (!registrationId) {
    throw new Error('MCP_BLOB_BASE_URL has no registration id in its path');
  }

  // Rebuilt rather than reused so a trailing slash on the configured value
  // cannot become a double slash — an empty first segment the gateway refuses.
  const basePrefix = `${parsed.origin}/${pathSegments.join('/')}`;

  function mint(rest: string, exp: number, payload: (objectKey: string) => string): string {
    const segments = objectPathSegments(rest);
    // Signed DECODED, sent ENCODED. The gateway percent-decodes each segment
    // before it builds the key it verifies against, so a key containing a space
    // or a '+' signs one string and is checked as another unless the encoding
    // happens ONLY on the wire. Per segment, never over the joined string: an
    // encoded '/' would invent a separator the signed key does not have.
    const url = `${basePrefix}/${segments.map(encodeURIComponent).join('/')}`;
    const signature = sign(config.signingKey, payload(`${registrationId}/${segments.join('/')}`));
    return `${url}?exp=${exp}&sig=${signature}`;
  }

  return {
    registrationId,
    putUrl(rest, contentType, options) {
      const exp = expiryFor(options);
      return {
        url: mint(rest, exp, (key) => writePayload(key, contentType, exp)),
        contentType,
      };
    },
    getUrl(rest, options) {
      const exp = expiryFor(options);
      return mint(rest, exp, (key) => readPayload(key, exp));
    },
  };
}

/**
 * The blob store as this process's environment describes it, or `undefined`
 * when it is absent — a local stdio install, where mcp-host is not the host.
 *
 * `readEnvVar` rather than `process.env` directly: it already treats a blank
 * value and an unresolved `.mcpb` placeholder (`${user_config.x}`) as unset,
 * which is the same rule the rest of this package's configuration follows.
 * BOTH or neither — a base URL with no key cannot sign anything, and a key with
 * no base URL has nowhere to point.
 */
export function blobStoreFromEnv(): BlobStoreConfig | undefined {
  const baseUrl = readEnvVar('MCP_BLOB_BASE_URL');
  const signingKey = readEnvVar('MCP_BLOB_SIGNING_KEY');
  if (!baseUrl || !signingKey) return undefined;
  return { baseUrl, signingKey };
}
