import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import { registerApiTools } from '../../src/tools/api.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { pos } from '../../src/argv.js';
import { resetConfirmTokenState } from '../../src/send-confirm-token.js';
import { CONFIRM_ACTION_INSTRUCTION } from '../../src/dispatch-confirmation.js';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerApiTools);

/** A client that CAN be prompted, answering with `answer` and recording the prompt. */
async function prompted(answer: ElicitResult = { action: 'accept', content: { confirmed: true } }) {
  const seen: ElicitRequest[] = [];
  const harness = await createTestHarness(registerApiTools, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_CONFIRM_MODE;
  delete process.env.MCP_CONFIRM_TTL_SECONDS;
  delete process.env.MCP_CONFIRM_SECRET;
  resetConfirmTokenState();
});

afterEach(() => { process.env = ORIGINAL_ENV; });

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
      allowWrite: true, dryRun: true, account: 'a@example.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'api', 'call', pos('drive'), pos('v3'), pos('files.create'),
        '--params={"fields":"id"}', '--body={"name":"f"}',
        '--scope=https://www.googleapis.com/auth/drive', '--allow-write', '--dry-run', '--force',
      ],
      { account: 'a@example.com', gmailNoSend: true },
    );
  });

  it('appends --force last even when dry-run is absent, once the user has confirmed', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const { harness } = await prompted();
    await harness.callTool('gog_api_call', {
      api: 'drive', version: 'v3', method: 'files.create', allowWrite: true,
    });
    const passedArgs = vi.mocked(runner.run).mock.calls[0][0];
    expect(passedArgs).toEqual(['api', 'call', pos('drive'), pos('v3'), pos('files.create'), '--allow-write', '--force']);
    expect(passedArgs[passedArgs.length - 1]).toBe('--force');
  });

  // SEC-2 (fleet-audit #931): allowWrite is a boolean the MODEL sets, and
  // --force skips gog's own confirmation, so a method blocklist could never be
  // complete (events.move/delete, acl.insert, sendAs.create, updateVacation,
  // batchDelete, ...). Every write now asks the user about the exact
  // api/method/params/body before anything is sent.
  describe('the write gate', () => {
    const write = {
      api: 'calendar', version: 'v3', method: 'events.delete',
      params: '{"calendarId":"primary","eventId":"e1","sendUpdates":"all"}',
    };

    it('prompts with the api, version, method, params and body, then runs once accepted', async () => {
      vi.mocked(runner.run).mockResolvedValue('{}');
      const { harness, details, seen } = await prompted();
      await harness.callTool('gog_api_call', { ...write, body: '{"a":1}', scope: 'https://www.googleapis.com/auth/calendar', allowWrite: true, account: 'a@example.com' });
      expect(seen[0]!.params.message).toMatch(/calendar v3 events\.delete/);
      expect(details()).toEqual({
        api: 'calendar', version: 'v3', method: 'events.delete',
        params: { calendarId: 'primary', eventId: 'e1', sendUpdates: 'all' },
        body: { a: 1 },
        scope: 'https://www.googleapis.com/auth/calendar',
      });
      expect(runner.run).toHaveBeenCalledWith(
        ['api', 'call', pos('calendar'), pos('v3'), pos('events.delete'), `--params=${write.params}`, '--body={"a":1}',
          '--scope=https://www.googleapis.com/auth/calendar', '--allow-write', '--force'],
        { account: 'a@example.com', gmailNoSend: true },
      );
    });

    it('shows a body that is not JSON (an @file reference) as the string it is', async () => {
      vi.mocked(runner.run).mockResolvedValue('{}');
      const { harness, details } = await prompted({ action: 'decline' });
      await harness.callTool('gog_api_call', { api: 'drive', version: 'v3', method: 'files.create', body: '@/body.json', params: 'not json', allowWrite: true });
      expect(details()).toEqual({ api: 'drive', version: 'v3', method: 'files.create', params: 'not json', body: '@/body.json' });
    });

    it('bounds an oversized body in the prompt, marking the cut', async () => {
      vi.mocked(runner.run).mockResolvedValue('{}');
      const { harness, details } = await prompted({ action: 'decline' });
      const body = JSON.stringify({ text: 'x'.repeat(3000) });
      await harness.callTool('gog_api_call', { api: 'docs', version: 'v1', method: 'documents.batchUpdate', body, allowWrite: true });
      const shown = details().body as string;
      expect(shown.startsWith(body.slice(0, 2048))).toBe(true);
      expect(shown).toMatch(/more characters not shown\]$/);
    });

    it('runs nothing when the user declines', async () => {
      const { harness } = await prompted({ action: 'decline' });
      const r = json(await harness.callTool('gog_api_call', { ...write, allowWrite: true }));
      expect(r).toMatchObject({ confirmed: false, cancelled: true, action: 'api.call' });
      expect(runner.run).not.toHaveBeenCalled();
    });

    it.each([
      ['a read', { api: 'calendar', version: 'v3', method: 'events.list' }],
      ['a dry run', { ...write, allowWrite: true, dryRun: true }],
      ['a write without allowWrite (gog refuses it itself)', { ...write }],
    ])('does not ask for %s', async (_label, args) => {
      process.env.MCP_CONFIRM_MODE = 'refuse';
      vi.mocked(runner.run).mockResolvedValue('{}');
      const harness = await setupHandlers();
      const r = await harness.callTool('gog_api_call', args);
      expect(r.isError).toBeFalsy();
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it('refuses a client that cannot be prompted under MCP_CONFIRM_MODE=refuse, naming the way through', async () => {
      process.env.MCP_CONFIRM_MODE = 'refuse';
      const harness = await setupHandlers();
      const r = json(await harness.callTool('gog_api_call', { ...write, allowWrite: true }));
      expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'api.call' });
      expect(r.note).toMatch(/dryRun/);
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('token fallback: previews in full, refuses a changed payload, runs on phase 2', async () => {
      process.env.MCP_CONFIRM_MODE = 'ask-user';
      vi.mocked(runner.run).mockResolvedValue('{}');
      const harness = await setupHandlers();
      const args = { ...write, body: '{"a":1}', allowWrite: true };
      const p1 = json(await harness.callTool('gog_api_call', args));
      expect(p1).toMatchObject({
        status: 'confirmation-required',
        preview: {
          api: 'calendar', version: 'v3', method: 'events.delete',
          params: { calendarId: 'primary', eventId: 'e1', sendUpdates: 'all' },
          body: { a: 1 },
        },
        instruction: CONFIRM_ACTION_INSTRUCTION,
      });
      expect(runner.run).not.toHaveBeenCalled();
      expect(json(await harness.callTool('gog_api_call', { ...args, body: '{"a":2}', confirmToken: p1.confirmToken })))
        .toMatchObject({ error: 'DRAFT_CHANGED' });
      expect(json(await harness.callTool('gog_api_call', { ...args, params: '{"calendarId":"primary","eventId":"e2"}', confirmToken: p1.confirmToken })))
        .toMatchObject({ error: 'DRAFT_CHANGED' });
      expect(runner.run).not.toHaveBeenCalled();
      await harness.callTool('gog_api_call', { ...args, confirmToken: p1.confirmToken });
      expect(runner.run).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runner.run).mock.calls[0][0]).toContain('--allow-write');
    });
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
