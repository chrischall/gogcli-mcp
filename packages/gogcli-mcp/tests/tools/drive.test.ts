import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDriveTools } from '../../src/tools/drive.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerDriveTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_drive_ls', () => {
  it('calls run with no folderId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"files":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_ls', {});
    expect(runner.run).toHaveBeenCalledWith(['drive', 'ls'], { account: undefined });
  });

  it('passes folderId as --parent flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_ls', { folderId: 'folder1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'ls', '--parent=folder1'], { account: undefined });
  });

  it('supports max, page, query, and allDrives flags', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_ls', {
      folderId: 'folder1',
      max: 50,
      page: 'tok',
      query: "name contains 'x'",
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'ls', '--parent=folder1', '--max=50', '--page=tok', "--query=name contains 'x'"],
      { account: undefined },
    );
  });

  it('passes --no-all-drives when allDrives is false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_ls', { allDrives: false });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'ls', '--no-all-drives'], { account: undefined });
  });

  it('omits all-drives flag when allDrives is true (default)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_ls', { allDrives: true });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'ls'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Ls failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_ls', {});
    expect(result.content[0].text).toBe('Error: Ls failed');
  });
});

describe('gog_drive_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"files":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_search', { query: 'budget' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'search', 'budget'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Search failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_search', { query: 'x' });
    expect(result.content[0].text).toBe('Error: Search failed');
  });
});

describe('gog_drive_get', () => {
  it('calls run with fileId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"file1"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_get', { fileId: 'file1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'get', 'file1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_get', { fileId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_drive_mkdir', () => {
  it('calls run with folder name', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"new-folder"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_mkdir', { name: 'Reports' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'mkdir', 'Reports'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Mkdir failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_mkdir', { name: 'Bad' });
    expect(result.content[0].text).toBe('Error: Mkdir failed');
  });
});

describe('gog_drive_rename', () => {
  it('calls run with fileId and newName', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_rename', { fileId: 'file1', newName: 'Budget 2026' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'rename', 'file1', 'Budget 2026'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Rename failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_rename', { fileId: 'bad', newName: 'x' });
    expect(result.content[0].text).toBe('Error: Rename failed');
  });
});

describe('gog_drive_move', () => {
  it('calls run with fileId and --parent flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_move', { fileId: 'file1', parentId: 'folder1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'move', 'file1', '--parent=folder1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Move failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_move', { fileId: 'f', parentId: 'p' });
    expect(result.content[0].text).toBe('Error: Move failed');
  });
});

describe('gog_drive_delete', () => {
  it('calls run with fileId (trash by default)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_delete', { fileId: 'file1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'delete', 'file1', '--force'], { account: undefined });
  });

  it('appends --permanent when permanent=true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_delete', { fileId: 'file1', permanent: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'delete', 'file1', '--permanent', '--force'],
      { account: undefined },
    );
  });

  it('omits --permanent when permanent=false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_delete', { fileId: 'file1', permanent: false });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'delete', 'file1', '--force'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_delete', { fileId: 'bad' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_drive_share', () => {
  it('calls run with required args for user share', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_share', { fileId: 'file1', to: 'user', email: 'bob@example.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'share', 'file1', '--to=user', '--email=bob@example.com'],
      { account: undefined },
    );
  });

  it('appends domain and role when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_share', { fileId: 'file1', to: 'domain', domain: 'example.com', role: 'writer' });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'share', 'file1', '--to=domain', '--domain=example.com', '--role=writer'],
      { account: undefined },
    );
  });

  it('appends --force for to=anyone (gog gates public sharing; runner injects --no-input)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_share', { fileId: 'file1', to: 'anyone' });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'share', 'file1', '--to=anyone', '--force'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Share failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_share', { fileId: 'f', to: 'anyone' });
    expect(result.content[0].text).toBe('Error: Share failed');
  });
});

describe('gog_drive_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_run', { subcommand: 'copy', args: ['file1', 'My Copy'] });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'copy', 'file1', 'My Copy'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_run', { subcommand: 'copy', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});

describe('gog_drive_extract_text', () => {
  const PDF_META = JSON.stringify({ file: { name: 'Guest_Copy.pdf', mimeType: 'application/pdf' } });
  const DOC_META = JSON.stringify({ file: { name: 'Notes', mimeType: 'application/vnd.google-apps.document' } });

  it('OCR-converts a PDF, exports text, and deletes the temp doc', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(PDF_META)                                   // drive get
      .mockResolvedValueOnce(JSON.stringify({ id: 'tmpDoc1' }))          // files.copy
      .mockResolvedValueOnce('﻿UTOPIA OF THE SEAS itinerary')       // files.export (with BOM)
      .mockResolvedValueOnce('trashed');                                 // cleanup delete
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_extract_text', { fileId: 'pdf1' });
    const j = JSON.parse(result.content[0].text as string);
    expect(j).toMatchObject({ fileId: 'pdf1', name: 'Guest_Copy.pdf', mimeType: 'application/pdf', extractedVia: 'ocr-convert' });
    expect(j.text).toBe('UTOPIA OF THE SEAS itinerary'); // BOM stripped
    // The copy is the OCR pass itself and carries an extended timeout: a large
    // scanned PDF routinely outruns the runner's 30s default, and the whole
    // conversion is wasted when it does.
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'drive', 'v3', 'files.copy', '--allow-write', '--force',
        '--params={"fileId":"pdf1"}', '--body={"name":"gogcli-ocr-pdf1","mimeType":"application/vnd.google-apps.document"}'],
      { account: undefined, timeout: 300_000 },
    );
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'drive', 'v3', 'files.export', '--params={"fileId":"tmpDoc1","mimeType":"text/plain"}'],
      { account: undefined },
    );
    expect(runner.run).toHaveBeenCalledWith(['drive', 'delete', 'tmpDoc1', '--permanent', '--force'], { account: undefined });
  });

  it('passes an ocrLanguage hint on the copy', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(PDF_META)
      .mockResolvedValueOnce(JSON.stringify({ result: { id: 'tmpDoc2' } })) // id nested under result
      .mockResolvedValueOnce('text')
      .mockResolvedValueOnce('ok');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_extract_text', { fileId: 'pdf1', ocrLanguage: 'fr' });
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'drive', 'v3', 'files.copy', '--allow-write', '--force',
        '--params={"fileId":"pdf1","ocrLanguage":"fr"}', '--body={"name":"gogcli-ocr-pdf1","mimeType":"application/vnd.google-apps.document"}'],
      { account: undefined, timeout: 300_000 },
    );
    expect(runner.run).toHaveBeenCalledWith(['drive', 'delete', 'tmpDoc2', '--permanent', '--force'], { account: undefined });
  });

  it('exports a native Google Doc directly with no convert or temp cleanup', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(DOC_META)     // drive get
      .mockResolvedValueOnce('doc body');  // files.export
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_extract_text', { fileId: 'doc1' });
    const j = JSON.parse(result.content[0].text as string);
    expect(j.extractedVia).toBe('native-export');
    expect(j.text).toBe('doc body');
    // no files.copy and no delete
    const calls = vi.mocked(runner.run).mock.calls.map((c) => c[0]);
    expect(calls.some((a) => (a as string[]).includes('files.copy'))).toBe(false);
    expect(calls.some((a) => (a as string[])[1] === 'delete')).toBe(false);
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'drive', 'v3', 'files.export', '--params={"fileId":"doc1","mimeType":"text/plain"}'],
      { account: undefined },
    );
  });

  it('paginates with offset and maxChars', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(DOC_META)
      .mockResolvedValueOnce('0123456789');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_extract_text', { fileId: 'doc1', offset: 3, maxChars: 4 });
    const j = JSON.parse(result.content[0].text as string);
    expect(j).toMatchObject({ totalChars: 10, offset: 3, returnedChars: 4, truncated: true, text: '3456' });
  });

  it('still deletes the temp doc when extraction fails mid-flight', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(PDF_META)                              // drive get
      .mockResolvedValueOnce(JSON.stringify({ id: 'tmpDoc3' }))     // files.copy
      .mockRejectedValueOnce(new Error('export exploded'))          // files.export fails
      .mockResolvedValueOnce('user@x.com')                          // diagnose -> auth list
      .mockResolvedValueOnce('deleted');                            // cleanup delete
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_extract_text', { fileId: 'pdf1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('export exploded');
    expect(runner.run).toHaveBeenCalledWith(['drive', 'delete', 'tmpDoc3', '--permanent', '--force'], { account: undefined });
  });

  it('errors clearly when OCR conversion returns no id (and creates nothing to clean up)', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(PDF_META)               // drive get
      .mockResolvedValueOnce('{}')                   // files.copy: no id
      .mockResolvedValueOnce('user@x.com');          // diagnose -> auth list
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_extract_text', { fileId: 'pdf1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('did not return a document id');
    const calls = vi.mocked(runner.run).mock.calls.map((c) => c[0]);
    expect(calls.some((a) => (a as string[])[1] === 'delete')).toBe(false);
  });

  it('swallows a cleanup-delete failure and still returns the extracted text', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(PDF_META)                            // drive get
      .mockResolvedValueOnce(JSON.stringify({ id: 'tmpDoc4' }))   // files.copy
      .mockResolvedValueOnce('the text')                          // files.export
      .mockRejectedValueOnce(new Error('delete failed'));         // cleanup delete rejects
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_extract_text', { fileId: 'pdf1' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text as string).text).toBe('the text');
  });

  it('threads the account through every step', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(DOC_META)
      .mockResolvedValueOnce('body');
    const harness = await setupHandlers();
    await harness.callTool('gog_drive_extract_text', { fileId: 'doc1', account: 'me@x.com' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'get', 'doc1'], { account: 'me@x.com' });
  });
});

describe('gog_drive_read_bytes', () => {
  it('returns file bytes as a base64 resource with a summary', async () => {
    const blob = Buffer.from('%PDF-1.4 hello').toString('base64');
    vi.mocked(runner.run).mockResolvedValueOnce(JSON.stringify({ file: { name: 'a.pdf', mimeType: 'application/pdf' } }));
    vi.mocked(runner.runBinary).mockResolvedValueOnce(blob);
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_read_bytes', { fileId: 'f1' });
    const res = result.content.find((c: { type: string }) => c.type === 'resource') as { resource: { blob: string; mimeType: string; uri: string } };
    expect(res.resource.blob).toBe(blob);
    expect(res.resource.mimeType).toBe('application/pdf');
    expect(res.resource.uri).toBe('gogdrive://f1/a.pdf');
    expect(result.content[0].text).toContain('a.pdf');
    expect(runner.runBinary).toHaveBeenCalledWith(
      ['api', 'call', 'drive', 'v3', 'files.get', '--params={"fileId":"f1","alt":"media"}'],
      { account: undefined },
    );
  });

  it('names the text fallback when the resource type is one hosts refuse to render', async () => {
    // The bytes arrive fine; some hosts just drop a non-image embedded resource
    // ("Resources of type 'application/pdf' are not currently supported"), and
    // then the text block is all the caller gets.
    vi.mocked(runner.run).mockResolvedValueOnce(JSON.stringify({ file: { name: 'a.pdf', mimeType: 'application/pdf' } }));
    vi.mocked(runner.runBinary).mockResolvedValueOnce(Buffer.from('%PDF-1.4').toString('base64'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_read_bytes', { fileId: 'f1' });
    expect(result.content[0].text).toContain('gog_drive_extract_text');
  });

  it('does not add the fallback hint for an image, which hosts do render', async () => {
    vi.mocked(runner.run).mockResolvedValueOnce(JSON.stringify({ file: { name: 'a.png', mimeType: 'image/png' } }));
    vi.mocked(runner.runBinary).mockResolvedValueOnce(Buffer.from('x').toString('base64'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_read_bytes', { fileId: 'f3' });
    expect(result.content[0].text).not.toContain('gog_drive_extract_text');
  });

  it('falls back to octet-stream and "file" when metadata lacks name/mime', async () => {
    vi.mocked(runner.run).mockResolvedValueOnce('{}');
    vi.mocked(runner.runBinary).mockResolvedValueOnce(Buffer.from('x').toString('base64'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_read_bytes', { fileId: 'f2' });
    const res = result.content.find((c: { type: string }) => c.type === 'resource') as { resource: { mimeType: string; uri: string } };
    expect(res.resource.mimeType).toBe('application/octet-stream');
    expect(res.resource.uri).toBe('gogdrive://f2/file');
  });

  it('surfaces the connector-degradation error via diagnose', async () => {
    vi.mocked(runner.run)
      .mockResolvedValueOnce(JSON.stringify({ file: { name: 'a.pdf', mimeType: 'application/pdf' } }))
      .mockResolvedValueOnce('user@x.com'); // diagnose -> auth list
    vi.mocked(runner.runBinary).mockRejectedValueOnce(new Error('Raw byte retrieval is not available over the hosted connector'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_drive_read_bytes', { fileId: 'f1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available over the hosted connector');
  });
});
