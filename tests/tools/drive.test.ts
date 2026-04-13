import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDriveTools } from '../../src/tools/drive.js';
import * as runner from '../../src/runner.js';

vi.mock('../../src/runner.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerDriveTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_drive_ls', () => {
  it('calls run with no folderId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"files":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_ls')!({});
    expect(runner.run).toHaveBeenCalledWith(['drive', 'ls'], { account: undefined });
  });

  it('appends folderId when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_ls')!({ folderId: 'folder1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'ls', 'folder1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Ls failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_ls')!({});
    expect(result.content[0].text).toBe('Error: Ls failed');
  });
});

describe('gog_drive_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"files":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_search')!({ query: 'budget' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'search', 'budget'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Search failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_search')!({ query: 'x' });
    expect(result.content[0].text).toBe('Error: Search failed');
  });
});

describe('gog_drive_get', () => {
  it('calls run with fileId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"file1"}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_get')!({ fileId: 'file1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'get', 'file1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_get')!({ fileId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_drive_mkdir', () => {
  it('calls run with folder name', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"new-folder"}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_mkdir')!({ name: 'Reports' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'mkdir', 'Reports'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Mkdir failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_mkdir')!({ name: 'Bad' });
    expect(result.content[0].text).toBe('Error: Mkdir failed');
  });
});

describe('gog_drive_rename', () => {
  it('calls run with fileId and newName', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_rename')!({ fileId: 'file1', newName: 'Budget 2026' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'rename', 'file1', 'Budget 2026'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Rename failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_rename')!({ fileId: 'bad', newName: 'x' });
    expect(result.content[0].text).toBe('Error: Rename failed');
  });
});

describe('gog_drive_move', () => {
  it('calls run with fileId and --parent flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_move')!({ fileId: 'file1', parentId: 'folder1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'move', 'file1', '--parent=folder1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Move failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_move')!({ fileId: 'f', parentId: 'p' });
    expect(result.content[0].text).toBe('Error: Move failed');
  });
});

describe('gog_drive_delete', () => {
  it('calls run with fileId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_delete')!({ fileId: 'file1' });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'delete', 'file1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_delete')!({ fileId: 'bad' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_drive_share', () => {
  it('calls run with required args for user share', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_share')!({ fileId: 'file1', to: 'user', email: 'bob@example.com' });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'share', 'file1', '--to=user', '--email=bob@example.com'],
      { account: undefined },
    );
  });

  it('appends domain and role when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_share')!({ fileId: 'file1', to: 'domain', domain: 'example.com', role: 'writer' });
    expect(runner.run).toHaveBeenCalledWith(
      ['drive', 'share', 'file1', '--to=domain', '--domain=example.com', '--role=writer'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Share failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_share')!({ fileId: 'f', to: 'anyone' });
    expect(result.content[0].text).toBe('Error: Share failed');
  });
});

describe('gog_drive_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_drive_run')!({ subcommand: 'copy', args: ['file1', 'My Copy'] });
    expect(runner.run).toHaveBeenCalledWith(['drive', 'copy', 'file1', 'My Copy'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_drive_run')!({ subcommand: 'copy', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
