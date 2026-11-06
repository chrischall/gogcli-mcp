import { vi } from 'vitest';

/**
 * An in-memory stand-in for mcp-host's blob store, behind a stubbed global
 * `fetch`. The real `blobStoreFromEnv()` from `@chrischall/mcp-utils/export`
 * signs and sends every request; this answers them. Signatures are not
 * checked — the signing is mcp-utils' and tested there.
 */
export const FAKE_BLOB_BASE = 'https://blobs.example/b/reg_0123456789abcdef01234567';

export interface FakeBlobStore {
  /** Objects by key. */
  blobs: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** Keys a DELETE removed, in order. */
  deleted: string[];
  /** Every request the server made, as `METHOD key`. */
  requests: string[];
  /** Store bytes under a key, as a caller's PUT would. */
  put(key: string, bytes: Uint8Array | string, contentType?: string): void;
  /** Make every DELETE answer this status (default 204). */
  failDeletesWith(status: number): void;
}

/** Set the blob env vars and stub `fetch` with the fake. Restore with `vi.unstubAllGlobals()`. */
export function installFakeBlobStore(env: NodeJS.ProcessEnv = process.env): FakeBlobStore {
  env.MCP_BLOB_BASE_URL = FAKE_BLOB_BASE;
  env.MCP_BLOB_SIGNING_KEY = 'test-signing-key';
  const basePath = new URL(FAKE_BLOB_BASE).pathname;
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const deleted: string[] = [];
  const requests: string[] = [];
  let deleteStatus = 204;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = decodeURIComponent(url.pathname.slice(basePath.length + 1));
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${key}`);
    if (method === 'DELETE') {
      if (deleteStatus >= 300) return new Response('', { status: deleteStatus });
      blobs.delete(key);
      deleted.push(key);
      return new Response(null, { status: deleteStatus });
    }
    const object = blobs.get(key);
    if (!object) return new Response('', { status: 404 });
    return new Response(new Uint8Array(object.bytes), { headers: { 'content-type': object.contentType } });
  }));
  return {
    blobs,
    deleted,
    requests,
    put(key, bytes, contentType = 'application/octet-stream') {
      blobs.set(key, { bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes, contentType });
    },
    failDeletesWith(status) {
      deleteStatus = status;
    },
  };
}
