import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExtraDriveTools } from '../../src/tools/drive-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function toText(text: string) {
  return { content: [{ type: 'text', text }] };
}

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerExtraDriveTools(server);
  return handlers;
}

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers();
});

describe('gog_drive_download', () => {
  it('calls runOrDiagnose with fileId only', async () => {
    await handlers.get('gog_drive_download')!({ fileId: 'f1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'download', 'f1'], { account: undefined });
  });

  it('passes --out and --format when provided', async () => {
    await handlers.get('gog_drive_download')!({ fileId: 'f1', out: '/tmp/file.pdf', format: 'pdf', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'download', 'f1', '--out=/tmp/file.pdf', '--format=pdf'],
      { account: 'a@b.com' },
    );
  });
});

describe('gog_drive_upload', () => {
  it('calls runOrDiagnose with localPath only', async () => {
    await handlers.get('gog_drive_upload')!({ localPath: '/tmp/x.txt' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'upload', '/tmp/x.txt'], { account: undefined });
  });

  it('passes all upload flags', async () => {
    await handlers.get('gog_drive_upload')!({
      localPath: '/tmp/x.txt',
      name: 'renamed.txt',
      parent: 'folder1',
      replace: 'file2',
      mimeType: 'text/plain',
      keepRevisionForever: true,
      convert: true,
      convertTo: 'doc',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'drive', 'upload', '/tmp/x.txt',
        '--name=renamed.txt',
        '--parent=folder1',
        '--replace=file2',
        '--mime-type=text/plain',
        '--keep-revision-forever',
        '--convert',
        '--convert-to=doc',
      ],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_drive_upload')!({ localPath: '/tmp/x.txt', keepRevisionForever: false, convert: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'upload', '/tmp/x.txt'], { account: undefined });
  });
});

describe('gog_drive_copy', () => {
  it('calls runOrDiagnose with fileId and name', async () => {
    await handlers.get('gog_drive_copy')!({ fileId: 'f1', name: 'Copy' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'copy', 'f1', 'Copy'], { account: undefined });
  });

  it('passes --parent when provided', async () => {
    await handlers.get('gog_drive_copy')!({ fileId: 'f1', name: 'Copy', parent: 'folder1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'copy', 'f1', 'Copy', '--parent=folder1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_url', () => {
  it('calls runOrDiagnose with single fileId', async () => {
    await handlers.get('gog_drive_url')!({ fileIds: ['f1'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'url', 'f1'], { account: undefined });
  });

  it('calls runOrDiagnose with multiple fileIds', async () => {
    await handlers.get('gog_drive_url')!({ fileIds: ['f1', 'f2', 'f3'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'url', 'f1', 'f2', 'f3'], { account: undefined });
  });
});

describe('gog_drive_permissions', () => {
  it('calls runOrDiagnose with fileId', async () => {
    await handlers.get('gog_drive_permissions')!({ fileId: 'f1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'permissions', 'f1'], { account: undefined });
  });

  it('passes --max and --page when provided', async () => {
    await handlers.get('gog_drive_permissions')!({ fileId: 'f1', max: 50, page: 'tok' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'permissions', 'f1', '--max=50', '--page=tok'],
      { account: undefined },
    );
  });
});

describe('gog_drive_unshare', () => {
  it('calls runOrDiagnose with fileId and permissionId', async () => {
    await handlers.get('gog_drive_unshare')!({ fileId: 'f1', permissionId: 'p1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'unshare', 'f1', 'p1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_drives_list', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_drives_list')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'drives'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_drive_drives_list')!({ max: 50, page: 'tok', all: true, query: 'engineering' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'drives', '--max=50', '--page=tok', '--all', '--query=engineering'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_drive_drives_list')!({ all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'drives'], { account: undefined });
  });
});

describe('gog_drive_comments_list', () => {
  it('calls runOrDiagnose with fileId', async () => {
    await handlers.get('gog_drive_comments_list')!({ fileId: 'f1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'list', 'f1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_comments_get', () => {
  it('calls runOrDiagnose with fileId and commentId', async () => {
    await handlers.get('gog_drive_comments_get')!({ fileId: 'f1', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'get', 'f1', 'c1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_comments_add', () => {
  it('calls runOrDiagnose with fileId and content', async () => {
    await handlers.get('gog_drive_comments_add')!({ fileId: 'f1', content: 'LGTM' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'create', 'f1', 'LGTM'],
      { account: undefined },
    );
  });
});

describe('gog_drive_comments_update', () => {
  it('calls runOrDiagnose with fileId, commentId, and content', async () => {
    await handlers.get('gog_drive_comments_update')!({ fileId: 'f1', commentId: 'c1', content: 'edited' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'update', 'f1', 'c1', 'edited'],
      { account: undefined },
    );
  });
});

describe('gog_drive_comments_delete', () => {
  it('calls runOrDiagnose with fileId and commentId', async () => {
    await handlers.get('gog_drive_comments_delete')!({ fileId: 'f1', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'delete', 'f1', 'c1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_comments_reply', () => {
  it('calls runOrDiagnose with fileId, commentId, and content', async () => {
    await handlers.get('gog_drive_comments_reply')!({ fileId: 'f1', commentId: 'c1', content: 'thanks' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'reply', 'f1', 'c1', 'thanks'],
      { account: undefined },
    );
  });
});
