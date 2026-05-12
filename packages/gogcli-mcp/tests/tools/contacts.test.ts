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

describe('gog_people_me', () => {
  it('calls run with people me', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"resourceName":"people/me"}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_me')!({});
    expect(runner.run).toHaveBeenCalledWith(['people', 'me'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Me failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_people_me')!({});
    expect(result.content[0].text).toBe('Error: Me failed');
  });
});

describe('gog_people_get', () => {
  it('calls run with userId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_get')!({ userId: 'people/c123' });
    expect(runner.run).toHaveBeenCalledWith(['people', 'get', 'people/c123'], { account: undefined });
  });
});

describe('gog_people_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_search')!({ query: 'alice' });
    expect(runner.run).toHaveBeenCalledWith(['people', 'search', 'alice'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_search')!({ query: 'alice', max: 100, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['people', 'search', 'alice', '--max=100', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_search')!({ query: 'x', all: false });
    expect(runner.run).toHaveBeenCalledWith(['people', 'search', 'x'], { account: undefined });
  });
});

describe('gog_people_relations', () => {
  it('calls run with no userId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_relations')!({});
    expect(runner.run).toHaveBeenCalledWith(['people', 'relations'], { account: undefined });
  });

  it('passes userId and --type when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_relations')!({ userId: 'people/c123', type: 'manager' });
    expect(runner.run).toHaveBeenCalledWith(
      ['people', 'relations', 'people/c123', '--type=manager'],
      { account: undefined },
    );
  });
});

describe('gog_people_raw', () => {
  it('calls run with userId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_raw')!({ userId: 'people/c123' });
    expect(runner.run).toHaveBeenCalledWith(['people', 'raw', 'people/c123'], { account: undefined });
  });

  it('passes --person-fields and --pretty when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_raw')!({
      userId: 'people/c123',
      personFields: 'names,emailAddresses',
      pretty: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['people', 'raw', 'people/c123', '--person-fields=names,emailAddresses', '--pretty'],
      { account: undefined },
    );
  });

  it('omits --pretty when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_people_raw')!({ userId: 'people/c123', pretty: false });
    expect(runner.run).toHaveBeenCalledWith(['people', 'raw', 'people/c123'], { account: undefined });
  });
});
