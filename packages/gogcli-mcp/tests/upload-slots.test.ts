import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blobStoreFromEnv, mintUploadSlot } from '@chrischall/mcp-utils/export';
import {
  assertOneFileSource,
  blobFileName,
  confineUploadPath,
  confineUploadPaths,
  isHostedDeployment,
  MAX_BLOB_FILE_BYTES,
  readBlobFiles,
  releaseBlobs,
  requireUploadStore,
} from '../src/upload-slots.js';
import { installFakeBlobStore, type FakeBlobStore } from './support/fake-blob-store.js';

const ORIGINAL_ENV = { ...process.env };
let fake: FakeBlobStore;
let root: string;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_DATA_DIR;
  delete process.env.MCP_BLOB_BASE_URL;
  delete process.env.MCP_BLOB_SIGNING_KEY;
  root = mkdtempSync(join(tmpdir(), 'upload-slots-'));
  process.env.GOG_FILE_ROOTS = root;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

function slotKey(filename: string): string {
  return mintUploadSlot(blobStoreFromEnv()!, { filename }).blobKey;
}

const ok = { content: [{ type: 'text' as const, text: '{"id":"x1"}' }] };
const failed = { content: [{ type: 'text' as const, text: 'gog failed' }], isError: true };

describe('isHostedDeployment', () => {
  it('is false on a local install', () => {
    expect(isHostedDeployment()).toBe(false);
  });
  it('is true with an mcp-host data dir', () => {
    process.env.MCP_DATA_DIR = '/data';
    expect(isHostedDeployment()).toBe(true);
  });
  it('is true with a blob store', () => {
    installFakeBlobStore();
    expect(isHostedDeployment()).toBe(true);
  });
});

describe('requireUploadStore', () => {
  it('refuses on a local install, pointing at paths and inline bytes', () => {
    expect(() => requireUploadStore('blobKeys')).toThrow(/local install.*path.*attachInline/s);
  });
  it('returns the store when mcp-host lent one', () => {
    installFakeBlobStore();
    expect(requireUploadStore('blobKeys').prefix).toBe('reg_0123456789abcdef01234567');
  });
});

describe('blobFileName', () => {
  beforeEach(() => { fake = installFakeBlobStore(); });

  it('reads the filename a slot was minted for', () => {
    expect(blobFileName(slotKey('photo 1.jpg'))).toBe('photo 1.jpg');
  });
  it('refuses a key it did not mint, naming the slot tool', () => {
    expect(() => blobFileName('exports/abc/report.zip')).toThrow(/not an upload key.*gog_upload_slots/);
  });
  it('passes any other error through unchanged', () => {
    // A well-shaped key whose decoded name is a hidden file.
    const key = `uploads/00000000-0000-4000-8000-000000000000/${Buffer.from('.env').toString('base64url')}`;
    expect(() => blobFileName(key)).toThrow(/must not start with a dot/);
  });
});

describe('readBlobFiles', () => {
  beforeEach(() => { fake = installFakeBlobStore(); });

  it('is a no-op (and needs no store) without keys', async () => {
    delete process.env.MCP_BLOB_BASE_URL;
    expect(await readBlobFiles(undefined, 'attach')).toEqual([]);
    expect(await readBlobFiles([], 'attach')).toEqual([]);
  });

  it('turns each blob into a base64 file arg under its own filename, reading without deleting', async () => {
    const key = slotKey('photo.jpg');
    fake.put(key, 'JPEGDATA', 'image/jpeg');
    const [file] = await readBlobFiles([key], 'attach');
    expect(file).toMatchObject({
      blobKey: key,
      filename: 'photo.jpg',
      size: 8,
      sha256: createHash('sha256').update('JPEGDATA').digest('hex'),
      arg: { kind: 'file', flag: 'attach', encoding: 'base64', filename: 'photo.jpg', contents: Buffer.from('JPEGDATA').toString('base64') },
    });
    expect(file!.arg.positional).toBeUndefined();
    expect(fake.deleted).toEqual([]);
    expect(fake.requests).toEqual([`GET ${key}`]);
  });

  it('marks the arg positional when asked', async () => {
    const key = slotKey('message.eml');
    fake.put(key, 'From: a');
    const [file] = await readBlobFiles([key], 'file', { positional: true });
    expect(file!.arg.positional).toBe(true);
  });

  it('validates every key before fetching any', async () => {
    const good = slotKey('a.jpg');
    fake.put(good, 'x');
    await expect(readBlobFiles([good, 'not/a/key'], 'attach')).rejects.toThrow(/not an upload key/);
    expect(fake.requests).toEqual([]);
  });

  it('refuses the same key twice', async () => {
    const key = slotKey('a.jpg');
    await expect(readBlobFiles([key, key], 'attach')).rejects.toThrow(/same blobKey twice/);
  });

  it('refuses a local install', async () => {
    const key = slotKey('a.jpg');
    delete process.env.MCP_BLOB_SIGNING_KEY;
    await expect(readBlobFiles([key], 'attach')).rejects.toThrow(/local install/);
  });

  it('explains a blob that was never PUT (or already used)', async () => {
    const key = slotKey('a.jpg');
    await expect(readBlobFiles([key], 'attach')).rejects.toThrow(/a\.jpg could not be read from the upload store.*not found.*PUT the file/s);
  });

  it('refuses an empty upload', async () => {
    const key = slotKey('a.jpg');
    fake.put(key, '');
    await expect(readBlobFiles([key], 'attach')).rejects.toThrow(/a\.jpg is empty/);
  });

  it('caps a file at 25 MiB', async () => {
    expect(MAX_BLOB_FILE_BYTES).toBe(25 * 1024 * 1024);
    const key = slotKey('big.mov');
    fake.put(key, new Uint8Array(MAX_BLOB_FILE_BYTES + 1));
    await expect(readBlobFiles([key], 'attach')).rejects.toThrow(/big\.mov could not be read/);
  });
});

describe('releaseBlobs', () => {
  beforeEach(() => { fake = installFakeBlobStore(); });

  async function filesFor(...names: string[]) {
    const keys = names.map((n) => {
      const key = slotKey(n);
      fake.put(key, `bytes of ${n}`);
      return key;
    });
    return readBlobFiles(keys, 'attach');
  }

  it('returns the result untouched when there were no blobs', async () => {
    expect(await releaseBlobs(ok, [])).toBe(ok);
    expect(fake.requests).toEqual([]);
  });

  it('deletes every blob once the gog call succeeded', async () => {
    const files = await filesFor('a.jpg', 'b.jpg');
    expect(await releaseBlobs(ok, files)).toBe(ok);
    expect(fake.deleted).toEqual(files.map((f) => f.blobKey));
    expect(fake.blobs.size).toBe(0);
  });

  it('keeps every blob when the gog call failed, and says the keys can be reused', async () => {
    const files = await filesFor('a.jpg');
    const out = await releaseBlobs(failed, files);
    expect(fake.deleted).toEqual([]);
    expect(fake.blobs.size).toBe(1);
    expect(out.isError).toBe(true);
    expect(out.content[0]).toEqual(failed.content[0]);
    expect(out.content[1]!.text).toMatch(/a\.jpg.*kept.*same blobKeys/s);
  });

  it('reports a failed delete as a warning beside the success, never as a failure', async () => {
    const files = await filesFor('a.jpg', 'b.jpg');
    fake.failDeletesWith(500);
    const out = await releaseBlobs(ok, files);
    expect(out.isError).toBeUndefined();
    expect(out.content[0]).toEqual(ok.content[0]);
    expect(out.content[1]!.text).toMatch(/WARNING.*succeeded.*could not be deleted.*a\.jpg.*HTTP 500.*b\.jpg/s);
  });

  it('stringifies a non-Error delete failure', async () => {
    const [file] = await filesFor('a.jpg');
    const store = { ...file!.store, delete: async () => { throw 'boom'; } };
    const out = await releaseBlobs(ok, [{ ...file!, store }]);
    expect(out.content[1]!.text).toMatch(/a\.jpg \(boom\)/);
  });
});

describe('confineUploadPath / confineUploadPaths', () => {
  it('confines as before on a local install', () => {
    const inside = join(root, 'a.jpg');
    expect(confineUploadPath(inside, 'image')).toBe(inside);
    expect(() => confineUploadPath('/etc/passwd', 'image')).toThrow(/outside the directories/);
    expect(() => confineUploadPaths(['/etc/passwd'], 'attach')).toThrow(/outside the directories/);
    confineUploadPaths(undefined, 'attach');
  });

  it('on a hosted deployment, says the server is remote and points at the slot tool', () => {
    process.env.MCP_DATA_DIR = '/data';
    expect(() => confineUploadPath('/Users/someone/photo.jpg', 'image', 'or a public HTTPS `url`'))
      .toThrow(/server is remote.*`image`.*gog_upload_slots.*blobKeys.*or a public HTTPS `url`/s);
    // Inside the roots but not there: same refusal, not gog's bare ENOENT.
    expect(() => confineUploadPath(join(root, 'missing.eml'), 'file')).toThrow(/server is remote.*`file`/s);
    expect(() => confineUploadPaths([join(root, 'missing.jpg')], 'attach', { commaSeparated: false }))
      .toThrow(/server is remote.*`attach`/s);
  });

  it('on a hosted deployment, still accepts a file that really is on the server', () => {
    process.env.MCP_DATA_DIR = '/data';
    const inside = join(root, 'downloaded.pdf');
    writeFileSync(inside, 'x');
    expect(confineUploadPath(inside, 'file')).toBe(inside);
    confineUploadPaths([inside], 'attach');
  });
});

describe('assertOneFileSource', () => {
  it('accepts exactly one source', () => {
    assertOneFileSource({ image: 'a.png', url: undefined, blobKeys: undefined });
    assertOneFileSource({ image: undefined, blobKeys: ['k'] });
  });
  it('treats an empty blobKeys as absent', () => {
    expect(() => assertOneFileSource({ image: undefined, blobKeys: [] })).toThrow(/exactly one of image or blobKeys/);
  });
  it('refuses none or several, naming them', () => {
    expect(() => assertOneFileSource({ image: undefined, url: undefined, blobKeys: undefined }))
      .toThrow(/exactly one of image, url or blobKeys/);
    expect(() => assertOneFileSource({ image: 'a.png', blobKeys: ['k'] })).toThrow(/exactly one/);
  });
});
