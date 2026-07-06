import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerContactsTools } from '../../src/tools/contacts.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerContactsTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_contacts_search', () => {
  it('calls run with query', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"connections":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_contacts_search', { query: 'alice' });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'search', 'alice'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Search failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_contacts_search', { query: 'x' });
    expect(result.content[0].text).toBe('Error: Search failed');
  });
});

describe('gog_contacts_list', () => {
  it('calls run with contacts list', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"connections":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_contacts_list', {});
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'list'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_contacts_list', {});
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_contacts_get', () => {
  it('calls run with resourceName', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"resourceName":"people/c123"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_contacts_get', { resourceName: 'people/c123' });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'get', 'people/c123'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_contacts_get', { resourceName: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_contacts_create', () => {
  it('calls run with required givenName', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"resourceName":"people/c456"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_contacts_create', { givenName: 'Alice' });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'create', '--given=Alice'], { account: undefined });
  });

  it('appends optional fields when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_contacts_create', {
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
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_contacts_create', { givenName: 'Bad' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_contacts_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_contacts_run', { subcommand: 'delete', args: ['people/c123'] });
    expect(runner.run).toHaveBeenCalledWith(['contacts', 'delete', 'people/c123'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_contacts_run', { subcommand: 'update', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
