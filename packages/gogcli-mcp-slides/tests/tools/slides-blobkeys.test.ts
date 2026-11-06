import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult, errorResult } from '@chrischall/mcp-utils';
import { blobStoreFromEnv, mintUploadSlot } from '@chrischall/mcp-utils/export';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import type { GogArg, GogFileArg } from '../../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from '../../src/tools/slides-extra.js';
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
  root = mkdtempSync(join(tmpdir(), 'slides-blobkeys-'));
  process.env.GOG_FILE_ROOTS = root;
  fake = installFakeBlobStore();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
  harness = await createTestHarness(registerExtraSlidesTools, {
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

describe('slides image tools + blobKeys', () => {
  it('gog_slides_add_slide passes the blob as the positional image, after the presentation id', async () => {
    const key = upload('slide.png', 'PNGBYTES');
    const result = await harness.callTool('gog_slides_add_slide', { presentationId: 'p1', blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    const args = lastArgs();
    expect(args[2]).toEqual(lib.pos('p1'));
    expect(args[3]).toMatchObject({ kind: 'file', positional: true, filename: 'slide.png' });
    expect(fake.deleted).toEqual([key]);
  });

  it.each([
    ['gog_slides_insert_image', { presentationId: 'p1', slideId: 's1', width: 100 }],
    ['gog_slides_replace_slide', { presentationId: 'p1', slideId: 's1' }],
  ] as const)('%s passes the blob as the positional image and deletes it after', async (tool, args) => {
    const key = upload('chart.png', 'PNGBYTES');
    const result = await harness.callTool(tool, { ...args, blobKeys: [key] });
    expect(result.isError).toBeFalsy();
    expect(fileArg(lastArgs())).toMatchObject({ positional: true, filename: 'chart.png' });
    expect(fake.deleted).toEqual([key]);
  });

  it('keeps the blob when gog fails', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(errorResult('Error: bad image'));
    const key = upload('slide.png', 'PNGBYTES');
    await harness.callTool('gog_slides_add_slide', { presentationId: 'p1', blobKeys: [key] });
    expect(fake.deleted).toEqual([]);
  });

  it('wants exactly one image source', async () => {
    const key = upload('slide.png', 'x');
    const none = await harness.callTool('gog_slides_add_slide', { presentationId: 'p1' });
    expect(none.content[0]!.text).toMatch(/exactly one of image or blobKeys/);
    const two = await harness.callTool('gog_slides_insert_image', { presentationId: 'p1', slideId: 's1', width: 1, url: 'https://x.test/i.png', blobKeys: [key] });
    expect(two.content[0]!.text).toMatch(/exactly one of image, url or blobKeys/);
    expect(lib.runOrDiagnose).not.toHaveBeenCalled();
  });

  it('on a hosted deployment, an image path that is not on the server points at the slot tool and url', async () => {
    const result = await harness.callTool('gog_slides_insert_image', { presentationId: 'p1', slideId: 's1', width: 1, image: '/Users/someone/a.png' });
    expect(result.content[0]!.text).toMatch(/server is remote.*gog_upload_slots.*public HTTPS image `url`/s);
  });
});
