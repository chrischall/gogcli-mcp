import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExtraCalendarTools } from '../../src/tools/calendar-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function toText(text: string) {
  return { content: [{ type: 'text', text }] };
}

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerExtraCalendarTools(server);
  return handlers;
}

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers();
});

describe('gog_meet_create', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_meet_create')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'create'], { account: undefined });
  });

  it('passes --access and --open when provided', async () => {
    await handlers.get('gog_meet_create')!({ access: 'open', open: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['meet', 'create', '--access=open', '--open'],
      { account: undefined },
    );
  });

  it('omits --open when false', async () => {
    await handlers.get('gog_meet_create')!({ open: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'create'], { account: undefined });
  });
});

describe('gog_meet_get', () => {
  it('calls runOrDiagnose with meetingCode', async () => {
    await handlers.get('gog_meet_get')!({ meetingCode: 'abc-defg-hij' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'get', 'abc-defg-hij'], { account: undefined });
  });
});

describe('gog_meet_update', () => {
  it('calls runOrDiagnose with meetingCode and --access', async () => {
    await handlers.get('gog_meet_update')!({ meetingCode: 'abc-defg-hij', access: 'restricted' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['meet', 'update', 'abc-defg-hij', '--access=restricted'],
      { account: undefined },
    );
  });

  it('omits --access when not provided', async () => {
    await handlers.get('gog_meet_update')!({ meetingCode: 'abc-defg-hij' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'update', 'abc-defg-hij'], { account: undefined });
  });
});

describe('gog_meet_end', () => {
  it('calls runOrDiagnose with meetingCode', async () => {
    await handlers.get('gog_meet_end')!({ meetingCode: 'abc-defg-hij' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'end', 'abc-defg-hij'], { account: undefined });
  });
});

describe('gog_meet_history', () => {
  it('calls runOrDiagnose with meetingCode', async () => {
    await handlers.get('gog_meet_history')!({ meetingCode: 'abc-defg-hij' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'history', 'abc-defg-hij'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_meet_history')!({
      meetingCode: 'abc-defg-hij',
      max: 50,
      page: 'tok',
      all: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['meet', 'history', 'abc-defg-hij', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_meet_history')!({ meetingCode: 'abc-defg-hij', all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['meet', 'history', 'abc-defg-hij'], { account: undefined });
  });
});

describe('gog_meet_participants', () => {
  it('calls runOrDiagnose with meetingCode', async () => {
    await handlers.get('gog_meet_participants')!({ meetingCode: 'abc-defg-hij' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['meet', 'participants', 'abc-defg-hij'],
      { account: undefined },
    );
  });

  it('passes --conference and pagination flags', async () => {
    await handlers.get('gog_meet_participants')!({
      meetingCode: 'abc-defg-hij',
      conference: 'conf123',
      max: 100,
      page: 'tok',
      all: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'meet', 'participants', 'abc-defg-hij',
        '--conference=conf123',
        '--max=100',
        '--page=tok',
        '--all',
      ],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_meet_participants')!({ meetingCode: 'abc-defg-hij', all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['meet', 'participants', 'abc-defg-hij'],
      { account: undefined },
    );
  });
});
