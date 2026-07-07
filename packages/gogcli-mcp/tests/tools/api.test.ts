import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerApiTools } from '../../src/tools/api.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerApiTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_api_list', () => {
  it('lists the default API set', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_list', {});
    expect(runner.run).toHaveBeenCalledWith(['api', 'list'], { account: undefined });
  });

  it('adds --all when requested', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_list', { all: true });
    expect(runner.run).toHaveBeenCalledWith(['api', 'list', '--all'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_list', {});
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_api_describe', () => {
  it('describes a whole API', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_describe', { api: 'drive', version: 'v3' });
    expect(runner.run).toHaveBeenCalledWith(['api', 'describe', 'drive', 'v3'], { account: undefined });
  });

  it('describes a single method when method is provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_describe', { api: 'drive', version: 'v3', method: 'files.list' });
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'describe', 'drive', 'v3', 'files.list'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Describe failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_describe', { api: 'x', version: 'v1' });
    expect(result.content[0].text).toBe('Error: Describe failed');
  });
});

describe('gog_api_call', () => {
  it('calls a read method with params', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_call', { api: 'drive', version: 'v3', method: 'files.list', params: '{"q":"x"}' });
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'drive', 'v3', 'files.list', '--params={"q":"x"}'],
      { account: undefined },
    );
  });

  it('passes body, scope, allow-write and dry-run for a write method', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_call', {
      api: 'drive', version: 'v3', method: 'files.create',
      params: '{"fields":"id"}', body: '{"name":"f"}', scope: 'https://www.googleapis.com/auth/drive',
      allowWrite: true, dryRun: true, account: 'a@b.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'api', 'call', 'drive', 'v3', 'files.create',
        '--params={"fields":"id"}', '--body={"name":"f"}',
        '--scope=https://www.googleapis.com/auth/drive', '--allow-write', '--dry-run', '--force',
      ],
      { account: 'a@b.com' },
    );
  });

  it('appends --force last even when dry-run is absent', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_call', {
      api: 'drive', version: 'v3', method: 'files.create', allowWrite: true,
    });
    const passedArgs = vi.mocked(runner.run).mock.calls[0][0];
    expect(passedArgs).toEqual(['api', 'call', 'drive', 'v3', 'files.create', '--allow-write', '--force']);
    expect(passedArgs[passedArgs.length - 1]).toBe('--force');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Call failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_call', { api: 'drive', version: 'v3', method: 'files.list' });
    expect(result.content[0].text).toBe('Error: Call failed');
  });
});
