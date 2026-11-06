import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult, errorResult } from '@chrischall/mcp-utils';
import { blobStoreFromEnv, mintUploadSlot } from '@chrischall/mcp-utils/export';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import type { GogArg, GogFileArg } from '../../../gogcli-mcp/src/lib.js';
import { registerExtraDocsTools } from '../../src/tools/docs-extra.js';
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
  root = mkdtempSync(join(tmpdir(), 'docs-blobkeys-'));
  process.env.GOG_FILE_ROOTS = root;
  fake = installFakeBlobStore();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
  harness = await createTestHarness(registerExtraDocsTools, {
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

describe('docs image tools + blobKeys', () => {
  it.each(['gog_docs_insert_image', 'gog_docs_replace_image'])('%s passes the blob as --file, with --force, and deletes it after', async (tool) => {
    const key = upload('logo.png', 'PNGBYTES');
    const result = await harness.callTool(tool, { docId: 'd1', blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    const args = lastArgs();
    expect(fileArg(args)).toMatchObject({ flag: 'file', filename: 'logo.png', encoding: 'base64' });
    expect(fileArg(args)!.positional).toBeUndefined();
    expect(args.at(-1)).toBe('--force');
    expect(fake.deleted).toEqual([key]);
  });

  it('keeps the blob when gog fails', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(errorResult('Error: restricted'));
    const key = upload('logo.png', 'PNGBYTES');
    await harness.callTool('gog_docs_insert_image', { docId: 'd1', blobKeys: [key] });
    expect(fake.deleted).toEqual([]);
  });

  it('wants exactly one image source', async () => {
    const result = await harness.callTool('gog_docs_replace_image', { docId: 'd1' });
    expect(result.content[0]!.text).toMatch(/exactly one of file, url or blobKeys/);
  });

  it('url mode needs no --force', async () => {
    await harness.callTool('gog_docs_insert_image', { docId: 'd1', url: 'https://x.test/i.png' });
    expect(lastArgs()).not.toContain('--force');
  });

  it('on a hosted deployment, a file path that is not on the server points at the slot tool', async () => {
    const result = await harness.callTool('gog_docs_insert_image', { docId: 'd1', file: '/Users/someone/a.png' });
    expect(result.content[0]!.text).toMatch(/server is remote.*gog_upload_slots/s);
  });
});
