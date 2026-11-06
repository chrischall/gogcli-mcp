import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult, errorResult } from '@chrischall/mcp-utils';
import { blobStoreFromEnv, mintUploadSlot } from '@chrischall/mcp-utils/export';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import type { GogArg, GogFileArg } from '../../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from '../../src/tools/drive-extra.js';
import { installFakeBlobStore, type FakeBlobStore } from '../../../gogcli-mcp/tests/support/fake-blob-store.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return { ...actual, runOrDiagnose: vi.fn() };
});

const ORIGINAL_ENV = { ...process.env };
let fake: FakeBlobStore;
let harness: TestHarness;
let root: string;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_DATA_DIR;
  root = mkdtempSync(join(tmpdir(), 'drive-blobkeys-'));
  process.env.GOG_FILE_ROOTS = root;
  fake = installFakeBlobStore();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
  harness = await createTestHarness(registerExtraDriveTools, {
    elicitation: async () => ({ action: 'accept', content: { confirmed: true } }),
  });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

function upload(filename: string, bytes: string): string {
  const key = mintUploadSlot(blobStoreFromEnv()!, { filename }).blobKey;
  fake.put(key, bytes);
  return key;
}

const lastArgs = () => vi.mocked(lib.runOrDiagnose).mock.calls.at(-1)![0] as GogArg[];
const fileArg = (args: GogArg[]) => args.find((a): a is GogFileArg => typeof a === 'object' && a.kind === 'file');

describe('gog_drive_upload + blobKeys', () => {
  it('uploads the blob as gog\'s positional localPath (named by its slot) and deletes it after', async () => {
    const key = upload('photo.jpg', 'JPEGBYTES');
    const result = await harness.callTool('gog_drive_upload', { blobKeys: [key], parent: 'F1' });
    expect(result.isError).toBeFalsy();
    const args = lastArgs();
    expect(args.slice(0, 2)).toEqual(['drive', 'upload']);
    expect(args[2]).toMatchObject({ kind: 'file', positional: true, filename: 'photo.jpg', encoding: 'base64' });
    expect(args).toContain('--parent=F1');
    expect(fake.deleted).toEqual([key]);
  });

  it('keeps the blob when the upload fails', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(errorResult('Error: storage quota'));
    const key = upload('photo.jpg', 'JPEGBYTES');
    const result = await harness.callTool('gog_drive_upload', { blobKeys: [key] });
    expect(result.isError).toBe(true);
    expect(fake.deleted).toEqual([]);
  });

  it('wants exactly one of localPath, content or blobKeys', async () => {
    const key = upload('photo.jpg', 'x');
    const both = await harness.callTool('gog_drive_upload', { blobKeys: [key], content: 'eA==', name: 'x' });
    expect(both.content[0]!.text).toMatch(/exactly one of localPath, content or blobKeys/);
    expect(lib.runOrDiagnose).not.toHaveBeenCalled();
    expect(fake.requests).toEqual([]);
  });

  it('on a hosted deployment, a localPath that is not on the server points at the slot tool', async () => {
    const result = await harness.callTool('gog_drive_upload', { localPath: '/Users/someone/photo.jpg' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/server is remote.*gog_upload_slots.*`content`/s);
  });

  it('on a hosted deployment, a localPath that IS on the server still uploads', async () => {
    const path = join(root, 'export.pdf');
    writeFileSync(path, 'x');
    await harness.callTool('gog_drive_upload', { localPath: path });
    expect(lastArgs()).toEqual(['drive', 'upload', lib.pos(path)]);
  });
});
