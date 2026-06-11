import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraDriveTools } from '../../src/tools/drive-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupHandlers, toText, type ToolHandler } from '../../../gogcli-mcp/tests/helpers/test-harness.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers(registerExtraDriveTools);
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

  // gog 0.22.0 adds --since; --include-quoted and pagination were already supported by gog.
  it('includes --since, --include-quoted and pagination flags when set', async () => {
    await handlers.get('gog_drive_comments_list')!({
      fileId: 'f1', since: '2026-06-01T00:00:00Z', includeQuoted: true, max: 5, page: 'tok', all: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'list', 'f1', '--since=2026-06-01T00:00:00Z', '--include-quoted', '--max=5', '--page=tok', '--all'],
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

  // gog 0.18.0: --action atomically flips resolved state on the parent comment.
  it('passes --action=resolve when action provided', async () => {
    await handlers.get('gog_drive_comments_reply')!({
      fileId: 'f1', commentId: 'c1', content: 'lgtm, resolving', action: 'resolve',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'reply', 'f1', 'c1', 'lgtm, resolving', '--action=resolve'],
      { account: undefined },
    );
  });

  it('passes --action=reopen when action provided', async () => {
    await handlers.get('gog_drive_comments_reply')!({
      fileId: 'f1', commentId: 'c1', content: 'actually wait', action: 'reopen',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'reply', 'f1', 'c1', 'actually wait', '--action=reopen'],
      { account: undefined },
    );
  });
});

// --- gog 0.18.0 ---

describe('gog_drive_comments_resolve', () => {
  it('calls runOrDiagnose with fileId and commentId', async () => {
    await handlers.get('gog_drive_comments_resolve')!({ fileId: 'f1', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'resolve', 'f1', 'c1'],
      { account: undefined },
    );
  });

  it('forwards account', async () => {
    await handlers.get('gog_drive_comments_resolve')!({ fileId: 'f1', commentId: 'c1', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'resolve', 'f1', 'c1'],
      { account: 'a@b.com' },
    );
  });
});

describe('gog_drive_comments_reopen', () => {
  it('calls runOrDiagnose with fileId and commentId', async () => {
    await handlers.get('gog_drive_comments_reopen')!({ fileId: 'f1', commentId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'comments', 'reopen', 'f1', 'c1'],
      { account: undefined },
    );
  });
});

// --- gog 0.19.0 ---

describe('gog_drive_du', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_du')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'du'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_du')!({
      parent: 'folder1', depth: 3, max: 20, sort: 'files', order: 'asc', noAllDrives: true, account: 'a@b.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'du', '--parent=folder1', '--depth=3', '--max=20', '--sort=files', '--order=asc', '--no-all-drives'],
      { account: 'a@b.com' },
    );
  });

  it('handles depth/max=0 and omits noAllDrives when false', async () => {
    await handlers.get('gog_drive_du')!({ depth: 0, max: 0, noAllDrives: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'du', '--depth=0', '--max=0'],
      { account: undefined },
    );
  });
});

describe('gog_drive_tree', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_tree')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'tree'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_tree')!({ parent: 'folder1', depth: 4, max: 100, noAllDrives: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'tree', '--parent=folder1', '--depth=4', '--max=100', '--no-all-drives'],
      { account: undefined },
    );
  });

  it('handles depth=0 and omits noAllDrives when false', async () => {
    await handlers.get('gog_drive_tree')!({ depth: 0, noAllDrives: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'tree', '--depth=0'], { account: undefined });
  });
});

describe('gog_drive_changes_start_token', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_changes_start_token')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'changes', 'start-token'], { account: undefined });
  });

  it('passes --drive when provided', async () => {
    await handlers.get('gog_drive_changes_start_token')!({ drive: 'd1', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'changes', 'start-token', '--drive=d1'],
      { account: 'a@b.com' },
    );
  });
});

describe('gog_drive_changes_list', () => {
  it('calls runOrDiagnose with token only', async () => {
    await handlers.get('gog_drive_changes_list')!({ token: 'tok1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'changes', 'list', '--token=tok1'],
      { account: undefined },
    );
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_changes_list')!({
      token: 'tok1', max: 50, page: 'p2', all: true, includeRemoved: true, drive: 'd1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'changes', 'list', '--token=tok1', '--max=50', '--page=p2', '--all', '--include-removed', '--drive=d1'],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_drive_changes_list')!({ token: 'tok1', all: false, includeRemoved: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'changes', 'list', '--token=tok1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_labels_list', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_labels_list')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'labels', 'list'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_labels_list')!({
      language: 'en', view: 'LABEL_VIEW_FULL', minimumRole: 'APPLIER', publishedOnly: true, adminAccess: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'list', '--language=en', '--view=LABEL_VIEW_FULL', '--minimum-role=APPLIER', '--published-only', '--admin-access'],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_drive_labels_list')!({ publishedOnly: false, adminAccess: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'labels', 'list'], { account: undefined });
  });
});

describe('gog_drive_labels_get', () => {
  it('calls runOrDiagnose with name only', async () => {
    await handlers.get('gog_drive_labels_get')!({ name: 'labels/abc' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'labels', 'get', 'labels/abc'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_labels_get')!({
      name: 'labels/abc', language: 'en', view: 'LABEL_VIEW_BASIC', adminAccess: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'get', 'labels/abc', '--language=en', '--view=LABEL_VIEW_BASIC', '--admin-access'],
      { account: undefined },
    );
  });

  it('omits --admin-access when false', async () => {
    await handlers.get('gog_drive_labels_get')!({ name: 'labels/abc', adminAccess: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'labels', 'get', 'labels/abc'], { account: undefined });
  });
});

describe('gog_drive_labels_file_list', () => {
  it('calls runOrDiagnose with fileId only', async () => {
    await handlers.get('gog_drive_labels_file_list')!({ fileId: 'f1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'file', 'list', 'f1'],
      { account: undefined },
    );
  });

  it('passes --max and --page when provided', async () => {
    await handlers.get('gog_drive_labels_file_list')!({ fileId: 'f1', max: 25, page: 'tok' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'file', 'list', 'f1', '--max=25', '--page=tok'],
      { account: undefined },
    );
  });
});

describe('gog_drive_labels_file_apply', () => {
  it('calls runOrDiagnose with fileId and labelId only', async () => {
    await handlers.get('gog_drive_labels_file_apply')!({ fileId: 'f1', labelId: 'l1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'file', 'apply', 'f1', 'l1'],
      { account: undefined },
    );
  });

  it('passes all repeatable field flags and fields-json', async () => {
    await handlers.get('gog_drive_labels_file_apply')!({
      fileId: 'f1',
      labelId: 'l1',
      text: ['t1=hello', 't2=world'],
      selection: ['s1=c1,c2'],
      integer: ['i1=42'],
      date: ['d1=2026-01-01'],
      user: ['u1=a@b.com'],
      unset: ['x1', 'x2'],
      fieldsJson: '{"f":"v"}',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'drive', 'labels', 'file', 'apply', 'f1', 'l1',
        '--text=t1=hello', '--text=t2=world',
        '--selection=s1=c1,c2',
        '--integer=i1=42',
        '--date=d1=2026-01-01',
        '--user=u1=a@b.com',
        '--unset=x1', '--unset=x2',
        '--fields-json={"f":"v"}',
      ],
      { account: undefined },
    );
  });

  it('omits empty arrays', async () => {
    await handlers.get('gog_drive_labels_file_apply')!({
      fileId: 'f1', labelId: 'l1', text: [], selection: [], integer: [], date: [], user: [], unset: [],
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'file', 'apply', 'f1', 'l1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_labels_file_remove', () => {
  it('calls runOrDiagnose with fileId and labelId', async () => {
    await handlers.get('gog_drive_labels_file_remove')!({ fileId: 'f1', labelId: 'l1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'labels', 'file', 'remove', 'f1', 'l1'],
      { account: undefined },
    );
  });
});

describe('gog_drive_activity', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_activity')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'activity', 'query'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_activity')!({
      file: 'f1',
      folder: 'fo1',
      actions: 'edit,share',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      filter: 'detail.action_detail_case:RENAME',
      max: 25,
      page: 'p2',
      all: true,
      consolidate: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'drive', 'activity', 'query',
        '--file=f1', '--folder=fo1', '--actions=edit,share',
        '--from=2026-01-01T00:00:00Z', '--to=2026-02-01T00:00:00Z',
        '--filter=detail.action_detail_case:RENAME', '--max=25', '--page=p2', '--all', '--consolidate',
      ],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_drive_activity')!({ all: false, consolidate: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'activity', 'query'], { account: undefined });
  });
});

describe('gog_drive_audit_sharing', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_drive_audit_sharing')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['drive', 'audit', 'sharing'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_audit_sharing')!({
      file: 'f1',
      parent: 'fo1',
      depth: 3,
      max: 100,
      internalDomain: ['example.com', 'corp.example.com'],
      publicOnly: true,
      externalOnly: true,
      noAllDrives: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'drive', 'audit', 'sharing',
        '--file=f1', '--parent=fo1', '--depth=3', '--max=100',
        '--internal-domain=example.com', '--internal-domain=corp.example.com',
        '--public-only', '--external-only', '--no-all-drives',
      ],
      { account: undefined },
    );
  });

  it('handles depth/max=0, empty domains, and omits booleans when false', async () => {
    await handlers.get('gog_drive_audit_sharing')!({
      depth: 0, max: 0, internalDomain: [], publicOnly: false, externalOnly: false, noAllDrives: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'audit', 'sharing', '--depth=0', '--max=0'],
      { account: undefined },
    );
  });
});

describe('gog_drive_audit_user', () => {
  it('calls runOrDiagnose with user only', async () => {
    await handlers.get('gog_drive_audit_user')!({ user: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'audit', 'user', 'a@b.com'],
      { account: undefined },
    );
  });

  it('passes all flags', async () => {
    await handlers.get('gog_drive_audit_user')!({
      user: 'a@b.com', file: 'f1', parent: 'fo1', depth: 3, max: 100, noAllDrives: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'audit', 'user', 'a@b.com', '--file=f1', '--parent=fo1', '--depth=3', '--max=100', '--no-all-drives'],
      { account: undefined },
    );
  });

  it('handles depth/max=0 and omits noAllDrives when false', async () => {
    await handlers.get('gog_drive_audit_user')!({ user: 'a@b.com', depth: 0, max: 0, noAllDrives: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'audit', 'user', 'a@b.com', '--depth=0', '--max=0'],
      { account: undefined },
    );
  });
});

// gog 0.24.0
describe('gog_drive_revisions_list', () => {
  it('lists revisions with pagination', async () => {
    await handlers.get('gog_drive_revisions_list')!({ fileId: 'f1', max: 10, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'revisions', 'list', 'f1', '--max=10', '--page=tok', '--all'],
      { account: undefined },
    );
  });
});

describe('gog_drive_revisions_get', () => {
  it('gets one revision', async () => {
    await handlers.get('gog_drive_revisions_get')!({ fileId: 'f1', revisionId: 'r3', account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['drive', 'revisions', 'get', 'f1', 'r3'],
      { account: 'a@b.com' },
    );
  });
});
