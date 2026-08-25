import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAppScriptTools } from '../../src/tools/appscript.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerAppScriptTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_appscript_get', () => {
  it('gets project metadata', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_get', { scriptId: 'S1' });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'get', 'S1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Get failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_appscript_get', { scriptId: 'S1' });
    expect(result.content[0].text).toBe('Error: Get failed');
  });
});

describe('gog_appscript_content', () => {
  it('reads the project source', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_content', { scriptId: 'S1', account: 'me@x.com' });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'content', 'S1'], { account: 'me@x.com' });
  });
});

describe('gog_appscript_pull', () => {
  it('pulls into a directory', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_pull', { scriptId: 'S1', dir: '/tmp/proj' });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'pull', 'S1', '/tmp/proj'], { account: undefined });
  });

  it('passes --overwrite', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_pull', { scriptId: 'S1', dir: '/tmp/proj', overwrite: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['appscript', 'pull', 'S1', '/tmp/proj', '--overwrite'],
      { account: undefined },
    );
  });

  // The directory resolves where gog runs, which is a different machine on the
  // hosted connector. A caller who does not know that gets a "success" whose
  // files they cannot reach.
  it('says in its description where the directory resolves', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const configs = new Map<string, { description?: string }>();
    vi.spyOn(server, 'registerTool').mockImplementation((name, config) => {
      configs.set(name, config as { description?: string });
      return undefined as never;
    });
    registerAppScriptTools(server);
    const desc = configs.get('gog_appscript_pull')?.description ?? '';
    expect(desc).toContain('RESOLVED WHERE GOG RUNS');
    expect(desc).toMatch(/gog_appscript_content/);
  });
});

describe('gog_appscript_create', () => {
  it('creates a standalone project', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_create', { title: 'Helpers' });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'create', '--title=Helpers'], { account: undefined });
  });

  it('binds the project to a Drive file', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_create', { title: 'Bound', parentId: 'FILE1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['appscript', 'create', '--title=Bound', '--parent-id=FILE1'],
      { account: undefined },
    );
  });
});

describe('gog_appscript_deployments', () => {
  it('lists deployments with pagination', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_deployments', { scriptId: 'S1', max: 10, pageToken: 'tok' });
    expect(runner.run).toHaveBeenCalledWith(
      ['appscript', 'deployments', 'S1', '--max=10', '--page=tok'],
      { account: undefined },
    );
  });
});

describe('gog_appscript_versions', () => {
  it('lists versions', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_versions', { scriptId: 'S1', all: true });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'versions', 'S1', '--all'], { account: undefined });
  });
});

describe('gog_appscript_run_function', () => {
  it('runs a deployed function', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_run_function', { scriptId: 'S1', functionName: 'doWork' });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'run', 'S1', 'doWork'], { account: undefined });
  });

  it('passes params and --dev-mode', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_run_function', {
      scriptId: 'S1', functionName: 'doWork', params: '["a",1]', devMode: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['appscript', 'run', 'S1', 'doWork', '--params=["a",1]', '--dev-mode'],
      { account: undefined },
    );
  });

  it('rejects params that are not a JSON array before spawning gog', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_appscript_run_function', {
      scriptId: 'S1', functionName: 'doWork', params: '{"a":1}',
    });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects params that are not JSON at all', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_appscript_run_function', {
      scriptId: 'S1', functionName: 'doWork', params: 'a,1',
    });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('gog_appscript_run', () => {
  it('passes the subcommand and args through', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_appscript_run', { subcommand: 'get', args: ['S1'] });
    expect(runner.run).toHaveBeenCalledWith(['appscript', 'get', 'S1'], { account: undefined });
  });
});
