import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerChatTools } from '../../src/tools/chat.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerChatTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_chat_spaces_list', () => {
  it('lists spaces', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"spaces":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_spaces_list', {});
    expect(runner.run).toHaveBeenCalledWith(['chat', 'spaces', 'list'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"spaces":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_spaces_list', { max: 20, pageToken: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'spaces', 'list', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Spaces failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_chat_spaces_list', {});
    expect(result.content[0].text).toBe('Error: Spaces failed');
  });

  // The constraint is the ACCOUNT, not the token, so it has to be in the
  // description a model reads — a source comment would not reach it. Every chat
  // tool carries the note, because any of them can be the first one called.
  it('warns in EVERY description that Chat is Workspace-only', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const configs = new Map<string, { description?: string }>();
    vi.spyOn(server, 'registerTool').mockImplementation((name, config) => {
      configs.set(name, config as { description?: string });
      return undefined as never;
    });
    registerChatTools(server);
    expect(configs.size).toBe(12);
    for (const [name, config] of configs) {
      expect(config.description, name).toMatch(/consumer accounts|Workspace/i);
    }
  });
});

describe('gog_chat_spaces_find', () => {
  it('searches by display name', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_spaces_find', { displayName: 'Team' });
    expect(runner.run).toHaveBeenCalledWith(['chat', 'spaces', 'find', 'Team'], { account: undefined });
  });

  it('passes --exact and --max', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_spaces_find', { displayName: 'Team', exact: true, max: 5 });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'spaces', 'find', 'Team', '--exact', '--max=5'],
      { account: undefined },
    );
  });
});

describe('gog_chat_spaces_create', () => {
  it('creates a space with members', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_spaces_create', { displayName: 'Launch', members: ['a@b.com', 'c@d.com'] });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'spaces', 'create', 'Launch', '--member=a@b.com', '--member=c@d.com'],
      { account: undefined },
    );
  });

  it('creates an empty space', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_spaces_create', { displayName: 'Solo' });
    expect(runner.run).toHaveBeenCalledWith(['chat', 'spaces', 'create', 'Solo'], { account: undefined });
  });
});

describe('gog_chat_threads_list', () => {
  it('lists threads in a space', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_threads_list', { space: 'spaces/AAA', max: 10 });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'threads', 'list', 'spaces/AAA', '--max=10'],
      { account: undefined },
    );
  });
});

describe('gog_chat_messages_list', () => {
  it('lists messages in a space', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_messages_list', { space: 'spaces/AAA' });
    expect(runner.run).toHaveBeenCalledWith(['chat', 'messages', 'list', 'spaces/AAA'], { account: undefined });
  });

  it('filters by thread, unread and order', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_messages_list', {
      space: 'spaces/AAA', thread: 'spaces/AAA/threads/T', unread: true, order: 'createTime desc', max: 50,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'list', 'spaces/AAA', '--thread=spaces/AAA/threads/T', '--unread',
        '--order=createTime desc', '--max=50'],
      { account: undefined },
    );
  });

  it('rejects a sort order Chat does not accept', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_chat_messages_list', { space: 'spaces/AAA', order: 'newest' });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('gog_chat_messages_send', () => {
  it('sends text to a space', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_messages_send', { space: 'spaces/AAA', text: 'hi' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'send', 'spaces/AAA', '--text=hi'],
      { account: undefined },
    );
  });

  it('replies in a thread and attaches a server-side path', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_messages_send', {
      space: 'spaces/AAA', text: 'see this', thread: 'spaces/AAA/threads/T', attach: ['/tmp/a.png'],
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'send', 'spaces/AAA', '--text=see this', '--thread=spaces/AAA/threads/T', '--attach=/tmp/a.png'],
      { account: undefined },
    );
  });

  it('carries caller-side bytes as a file arg', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_messages_send', {
      space: 'spaces/AAA',
      text: 'chart',
      attachInline: [{ filename: 'chart.png', contentBase64: Buffer.from('png').toString('base64') }],
    });
    const args = vi.mocked(runner.run).mock.calls[0][0];
    expect(args).toContainEqual(expect.objectContaining({
      kind: 'file', flag: 'attach', filename: 'chart.png', encoding: 'base64',
    }));
  });

  it('sends an attachment with no text at all', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_messages_send', { space: 'spaces/AAA', attach: ['/tmp/a.png'] });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'send', 'spaces/AAA', '--attach=/tmp/a.png'],
      { account: undefined },
    );
  });

  it('refuses a message with neither text nor an attachment', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_chat_messages_send', { space: 'spaces/AAA' });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('gog_chat_dm_send', () => {
  it('sends a direct message by email', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_dm_send', { email: 'a@b.com', text: 'hi' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'dm', 'send', 'a@b.com', '--text=hi'],
      { account: undefined },
    );
  });

  it('replies in an existing DM thread', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_dm_send', { email: 'a@b.com', text: 'hi', thread: 'spaces/D/threads/T' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'dm', 'send', 'a@b.com', '--text=hi', '--thread=spaces/D/threads/T'],
      { account: undefined },
    );
  });
});

describe('gog_chat_dm_space', () => {
  it('resolves the DM space for an address', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_dm_space', { email: 'a@b.com' });
    expect(runner.run).toHaveBeenCalledWith(['chat', 'dm', 'space', 'a@b.com'], { account: undefined });
  });
});

describe('gog_chat_reactions_list', () => {
  it('lists reactions, qualifying a bare message ID with its space', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_reactions_list', { message: 'MSG', space: 'spaces/AAA', max: 10 });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'reactions', 'list', 'MSG', '--space=spaces/AAA', '--max=10'],
      { account: undefined },
    );
  });

  it('omits --space when the message is already fully qualified', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_reactions_list', { message: 'spaces/AAA/messages/M' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'reactions', 'list', 'spaces/AAA/messages/M'],
      { account: undefined },
    );
  });
});

describe('gog_chat_reactions_create', () => {
  it('adds an emoji reaction', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_reactions_create', { message: 'spaces/AAA/messages/M', emoji: '👍' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'reactions', 'create', 'spaces/AAA/messages/M', '👍'],
      { account: undefined },
    );
  });

  it('passes --space for a bare message ID', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_reactions_create', { message: 'M', emoji: '👍', space: 'spaces/AAA' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'reactions', 'create', 'M', '👍', '--space=spaces/AAA'],
      { account: undefined },
    );
  });
});

describe('gog_chat_reactions_delete', () => {
  it('deletes a reaction by resource name', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_reactions_delete', { reaction: 'spaces/AAA/messages/M/reactions/R' });
    expect(runner.run).toHaveBeenCalledWith(
      ['chat', 'messages', 'reactions', 'delete', 'spaces/AAA/messages/M/reactions/R'],
      { account: undefined },
    );
  });
});

describe('gog_chat_run', () => {
  it('passes the subcommand and args through', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_chat_run', { subcommand: 'spaces', args: ['list'] });
    expect(runner.run).toHaveBeenCalledWith(['chat', 'spaces', 'list'], { account: undefined });
  });
});
