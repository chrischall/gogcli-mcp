import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraCalendarTools } from '../../src/tools/calendar-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupHandlers, toText, type ToolHandler } from '../../../gogcli-mcp/tests/helpers/test-harness.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers(registerExtraCalendarTools);
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
