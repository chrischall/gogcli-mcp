import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from '../../src/tools/auth.js';
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
  registerAuthTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_auth_list', () => {
  it('calls run with auth list args', async () => {
    vi.mocked(runner.run).mockResolvedValue('user@gmail.com\nadmin@example.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_list')!({});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'list']);
    expect(result.content[0].text).toBe('user@gmail.com\nadmin@example.com');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('No accounts configured'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_list')!({});
    expect(result.content[0].text).toBe('Error: No accounts configured');
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run).mockRejectedValue('something went wrong');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_list')!({});
    expect(result.content[0].text).toBe('something went wrong');
  });
});

describe('gog_auth_status', () => {
  it('calls run with auth status args', async () => {
    vi.mocked(runner.run).mockResolvedValue('keyring: system\ncredentials: ~/.config/gog');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_status')!({});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'status']);
    expect(result.content[0].text).toContain('keyring');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Status failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_status')!({});
    expect(result.content[0].text).toBe('Error: Status failed');
  });
});

describe('gog_auth_services', () => {
  it('calls run with auth services args', async () => {
    vi.mocked(runner.run).mockResolvedValue('sheets: spreadsheets.readonly');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_services')!({});
    expect(runner.run).toHaveBeenCalledWith(['auth', 'services']);
    expect(result.content[0].text).toContain('sheets');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Services failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_services')!({});
    expect(result.content[0].text).toBe('Error: Services failed');
  });
});

describe('gog_auth_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('removed user@gmail.com');
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_run')!({ subcommand: 'remove', args: ['user@gmail.com'] });
    expect(runner.run).toHaveBeenCalledWith(['auth', 'remove', 'user@gmail.com']);
    expect(result.content[0].text).toBe('removed user@gmail.com');
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('token info');
    const handlers = setupHandlers();
    await handlers.get('gog_auth_run')!({ subcommand: 'tokens', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['auth', 'tokens']);
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Remove failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_auth_run')!({ subcommand: 'remove', args: ['x@y.com'] });
    expect(result.content[0].text).toBe('Error: Remove failed');
  });
});
