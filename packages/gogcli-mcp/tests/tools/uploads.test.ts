import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerUploadTools } from '../../src/tools/uploads.js';
import { blobFileName } from '../../src/upload-slots.js';
import { FAKE_BLOB_BASE, installFakeBlobStore } from '../support/fake-blob-store.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_DATA_DIR;
  delete process.env.MCP_BLOB_BASE_URL;
  delete process.env.MCP_BLOB_SIGNING_KEY;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

const text = (r: { content: Array<{ text?: string }> }) => r.content[0]!.text as string;

describe('gog_upload_slots', () => {
  it('is a local-only read (it mints URLs and uploads nothing upstream)', async () => {
    const harness = await createTestHarness(registerUploadTools);
    const { tools } = await harness.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['gog_upload_slots']);
    expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('mints one signed PUT slot per file, with the next step spelled out', async () => {
    const fake = installFakeBlobStore();
    const harness = await createTestHarness(registerUploadTools);
    const result = await harness.callTool('gog_upload_slots', {
      files: [{ filename: 'photo 1.jpg' }, { filename: 'notes.pdf', mimeType: 'application/pdf' }],
    });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result));
    expect(body.slots).toHaveLength(2);
    const [photo, pdf] = body.slots;
    expect(photo).toMatchObject({ filename: 'photo 1.jpg', mimeType: 'image/jpeg', method: 'PUT' });
    expect(pdf.mimeType).toBe('application/pdf');
    expect(photo.uploadUrl.startsWith(`${FAKE_BLOB_BASE}/uploads/`)).toBe(true);
    expect(photo.curl).toContain("-H 'Content-Type: image/jpeg'");
    expect(photo.expiresAt).toMatch(/Z$/);
    expect(photo).not.toHaveProperty('expiresAtMs');
    expect(blobFileName(photo.blobKey)).toBe('photo 1.jpg');
    expect(body.maxBytesPerFile).toBe(25 * 1024 * 1024);
    expect(body.next).toMatch(/PUT.*blobKeys/s);
    // Minting signs locally: nothing is fetched, nothing is stored.
    expect(fake.requests).toEqual([]);
  });

  it('refuses on a local install, pointing at paths and attachInline', async () => {
    const harness = await createTestHarness(registerUploadTools);
    const result = await harness.callTool('gog_upload_slots', { files: [{ filename: 'a.jpg' }] });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/local install.*attachInline/s);
  });

  it('refuses a filename that is a path', async () => {
    installFakeBlobStore();
    const harness = await createTestHarness(registerUploadTools);
    const result = await harness.callTool('gog_upload_slots', { files: [{ filename: '../a.jpg' }] });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/bare filename/);
  });

  it('caps a call at 10 files', async () => {
    installFakeBlobStore();
    const harness = await createTestHarness(registerUploadTools);
    const files = Array.from({ length: 11 }, (_, i) => ({ filename: `f${i}.jpg` }));
    const result = await harness.callTool('gog_upload_slots', { files });
    expect(result.isError).toBe(true);
  });
});
