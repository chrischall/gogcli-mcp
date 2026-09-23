import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerApiTools } from '../../src/tools/api.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { pos } from '../../src/argv.js';

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
    expect(runner.run).toHaveBeenCalledWith(['api', 'describe', pos('drive'), pos('v3')], { account: undefined });
  });

  it('describes a single method when method is provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_describe', { api: 'drive', version: 'v3', method: 'files.list' });
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'describe', pos('drive'), pos('v3'), pos('files.list')],
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
      ['api', 'call', pos('drive'), pos('v3'), pos('files.list'), '--params={"q":"x"}'],
      { account: undefined, gmailNoSend: true },
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
        'api', 'call', pos('drive'), pos('v3'), pos('files.create'),
        '--params={"fields":"id"}', '--body={"name":"f"}',
        '--scope=https://www.googleapis.com/auth/drive', '--allow-write', '--dry-run', '--force',
      ],
      { account: 'a@b.com', gmailNoSend: true },
    );
  });

  it('appends --force last even when dry-run is absent', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_api_call', {
      api: 'drive', version: 'v3', method: 'files.create', allowWrite: true,
    });
    const passedArgs = vi.mocked(runner.run).mock.calls[0][0];
    expect(passedArgs).toEqual(['api', 'call', pos('drive'), pos('v3'), pos('files.create'), '--allow-write', '--force']);
    expect(passedArgs[passedArgs.length - 1]).toBe('--force');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Call failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_call', { api: 'drive', version: 'v3', method: 'files.list' });
    expect(result.content[0].text).toBe('Error: Call failed');
  });

  // SEC-2: allowWrite is a model-set boolean, so it cannot stand in for the
  // user's confirmation of a send. Sends are refused here (and --gmail-no-send
  // is pinned on as a backstop); so is anything that routes future mail away.
  it.each([
    ['gmail', 'users.messages.send'],
    ['Gmail', 'users.drafts.send'],
    ['gmail', 'users.settings.forwardingAddresses.create'],
    ['gmail', 'users.settings.updateAutoForwarding'],
    ['gmail', 'users.settings.filters.create'],
    ['gmail', 'users.settings.delegates.create'],
  ])('refuses %s %s', async (api, method) => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_call', { api, version: 'v1', method, allowWrite: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not available through gog_api_call/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('still allows other gmail methods', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_call', { api: 'gmail', version: 'v1', method: 'users.labels.list' });
    expect(result.isError).toBeFalsy();
  });

  // SEC-1: the positional api/version/method are model-supplied too.
  it.each([
    [{ api: '--readonly=false', version: 'v3', method: 'files.list' }],
    [{ api: 'drive', version: '--', method: 'files.list' }],
    [{ api: 'drive', version: 'v3', method: '--disable-commands=' }],
  ])('refuses a safety-flag override in %j', async (input) => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_api_call', input);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not allowed/);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

// SEC-3/SEC-4: gog reads `--body=@path` from the host, so an unconfined body
// is a read primitive (gog's credentials.json is itself valid JSON).
describe('gog_api_call @file confinement', () => {
  let prevRoots: string | undefined;
  beforeEach(() => { prevRoots = process.env.GOG_FILE_ROOTS; process.env.GOG_FILE_ROOTS = '/nonexistent-gog-file-root'; });
  afterEach(() => { process.env.GOG_FILE_ROOTS = prevRoots; });

  it.each([
    [{ body: '@/Users/x/Library/Application Support/gogcli/credentials.json' }, /body/],
    [{ params: '@/etc/passwd' }, /params/],
  ])('refuses %j outside GOG_FILE_ROOTS', async (extra, param) => {
    const harness = await createTestHarness(registerApiTools);
    const result = await harness.callTool('gog_api_call', { api: 'drive', version: 'v3', method: 'files.create', allowWrite: true, ...extra });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the directories/);
    expect(result.content[0].text).toMatch(param);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('passes an inline JSON body through', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await createTestHarness(registerApiTools);
    await harness.callTool('gog_api_call', { api: 'drive', version: 'v3', method: 'files.list', body: '{"a":1}' });
    expect(runner.run).toHaveBeenCalled();
  });
});
