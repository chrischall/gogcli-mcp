import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContactsTools } from '../../src/tools/contacts.js';
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
  registerContactsTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_contacts_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"connections":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_contacts_search')!({ query: 'alice' });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'search', 'alice'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Search failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_contacts_search')!({ query: 'x' });
    expect(result.content[0].text).toBe('Error: Search failed');
  });
});

describe('gog_contacts_list', () => {
  it('calls run with contacts list', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"connections":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_contacts_list')!({});
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'list'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_contacts_list')!({});
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_contacts_get', () => {
  it('calls run with resourceName', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"resourceName":"people/c123"}');
    const handlers = setupHandlers();
    await handlers.get('gog_contacts_get')!({ resourceName: 'people/c123' });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'get', 'people/c123'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_contacts_get')!({ resourceName: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_contacts_create', () => {
  it('calls run with required givenName', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"resourceName":"people/c456"}');
    const handlers = setupHandlers();
    await handlers.get('gog_contacts_create')!({ givenName: 'Alice' });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'create', '--given=Alice'], { account: undefined });
  });

  it('appends optional fields when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_contacts_create')!({
      givenName: 'Alice',
      familyName: 'Smith',
      email: 'alice@example.com',
      phone: '555-1234',
      org: 'Acme',
      title: 'Engineer',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'contacts', 'create',
        '--given=Alice', '--family=Smith', '--email=alice@example.com',
        '--phone=555-1234', '--org=Acme', '--title=Engineer',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_contacts_create')!({ givenName: 'Bad' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_contacts_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_contacts_run')!({ subcommand: 'delete', args: ['people/c123'] });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'delete', 'people/c123'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_contacts_run')!({ subcommand: 'update', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
