import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTasksTools } from '../../src/tools/tasks.js';
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
  registerTasksTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_tasks_lists', () => {
  it('calls run with tasks lists list', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"items":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_lists')!({});
    expect(runner.run).toHaveBeenCalledWith(['tasks', 'lists', 'list'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Lists failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_lists')!({});
    expect(result.content[0].text).toBe('Error: Lists failed');
  });
});

describe('gog_tasks_list', () => {
  it('calls run with tasklistId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"items":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_list')!({ tasklistId: 'list1' });
    expect(runner.run).toHaveBeenCalledWith(['tasks', 'list', 'list1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_list')!({ tasklistId: 'bad' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_tasks_get', () => {
  it('calls run with tasklistId and taskId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"task1"}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_get')!({ tasklistId: 'list1', taskId: 'task1' });
    expect(runner.run).toHaveBeenCalledWith(['tasks', 'get', 'list1', 'task1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Get failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_get')!({ tasklistId: 'l', taskId: 'bad' });
    expect(result.content[0].text).toBe('Error: Get failed');
  });
});

describe('gog_tasks_add', () => {
  it('calls run with required args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"task2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_add')!({ tasklistId: 'list1', title: 'Buy milk' });
    expect(runner.run).toHaveBeenCalledWith(
      ['tasks', 'add', 'list1', '--title=Buy milk'],
      { account: undefined },
    );
  });

  it('appends optional flags when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_add')!({ tasklistId: 'list1', title: 'Buy milk', notes: 'Whole milk', due: '2026-04-20' });
    expect(runner.run).toHaveBeenCalledWith(
      ['tasks', 'add', 'list1', '--title=Buy milk', '--notes=Whole milk', '--due=2026-04-20'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Add failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_add')!({ tasklistId: 'l', title: 't' });
    expect(result.content[0].text).toBe('Error: Add failed');
  });
});

describe('gog_tasks_done', () => {
  it('calls run with tasklistId and taskId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_done')!({ tasklistId: 'list1', taskId: 'task1' });
    expect(runner.run).toHaveBeenCalledWith(['tasks', 'done', 'list1', 'task1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Done failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_done')!({ tasklistId: 'l', taskId: 't' });
    expect(result.content[0].text).toBe('Error: Done failed');
  });
});

describe('gog_tasks_delete', () => {
  it('calls run with tasklistId and taskId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_delete')!({ tasklistId: 'list1', taskId: 'task1' });
    expect(runner.run).toHaveBeenCalledWith(['tasks', 'delete', 'list1', 'task1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_delete')!({ tasklistId: 'l', taskId: 't' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_tasks_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_tasks_run')!({ subcommand: 'update', args: ['list1', 'task1', '--title=New'] });
    expect(runner.run).toHaveBeenCalledWith(['tasks', 'update', 'list1', 'task1', '--title=New'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_tasks_run')!({ subcommand: 'clear', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
