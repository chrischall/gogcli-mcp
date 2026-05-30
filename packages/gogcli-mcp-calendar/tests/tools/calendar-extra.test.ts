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

// --- gog 0.18.0 Zoom S2S OAuth (Zoom is calendar conferencing — lives here) ---

describe('gog_zoom_auth_setup', () => {
  it('passes credentials and uses default alias when omitted', async () => {
    await handlers.get('gog_zoom_auth_setup')!({
      accountId: 'acct',
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'zoom', 'auth', 'setup',
        '--account-id=acct', '--client-id=cid', '--client-secret=csecret',
      ],
      { account: undefined },
    );
  });

  it('passes --alias and --skip-validate when provided', async () => {
    await handlers.get('gog_zoom_auth_setup')!({
      accountId: 'acct', clientId: 'cid', clientSecret: 'csecret',
      alias: 'work', skipValidate: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'zoom', 'auth', 'setup',
        '--alias=work',
        '--account-id=acct', '--client-id=cid', '--client-secret=csecret',
        '--skip-validate',
      ],
      { account: undefined },
    );
  });
});

describe('gog_zoom_auth_doctor', () => {
  it('validates default alias', async () => {
    await handlers.get('gog_zoom_auth_doctor')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['zoom', 'auth', 'doctor'], { account: undefined });
  });

  it('passes --alias when provided', async () => {
    await handlers.get('gog_zoom_auth_doctor')!({ alias: 'work' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['zoom', 'auth', 'doctor', '--alias=work'],
      { account: undefined },
    );
  });
});

// --- gog 0.19.0 calendar reads & CRUD ---

describe('gog_calendar_calendars', () => {
  it('calls runOrDiagnose with no flags', async () => {
    await handlers.get('gog_calendar_calendars')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'calendars'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_calendar_calendars')!({ max: 50, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'calendars', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_calendar_calendars')!({ all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'calendars'], { account: undefined });
  });
});

describe('gog_calendar_search', () => {
  it('calls runOrDiagnose with just the query', async () => {
    await handlers.get('gog_calendar_search')!({ query: 'standup' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'search', 'standup'], { account: undefined });
  });

  it('passes all filter flags when provided', async () => {
    await handlers.get('gog_calendar_search')!({
      query: 'standup',
      from: 'today',
      to: 'tomorrow',
      today: true,
      tomorrow: true,
      week: true,
      days: 7,
      weekStart: 'sun',
      calendar: 'primary',
      max: 10,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'calendar', 'search', 'standup',
        '--from=today', '--to=tomorrow',
        '--today', '--tomorrow', '--week',
        '--days=7', '--week-start=sun',
        '--calendar=primary', '--max=10',
      ],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_calendar_search')!({
      query: 'standup', today: false, tomorrow: false, week: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'search', 'standup'], { account: undefined });
  });
});

describe('gog_calendar_freebusy', () => {
  it('calls runOrDiagnose with required from/to only', async () => {
    await handlers.get('gog_calendar_freebusy')!({ from: 'A', to: 'B' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'freebusy', '--from=A', '--to=B'],
      { account: undefined },
    );
  });

  it('passes calendarIds and --all when provided', async () => {
    await handlers.get('gog_calendar_freebusy')!({
      from: 'A', to: 'B', calendarIds: 'primary,team@x.com', all: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'freebusy', 'primary,team@x.com', '--from=A', '--to=B', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_calendar_freebusy')!({ from: 'A', to: 'B', all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'freebusy', '--from=A', '--to=B'],
      { account: undefined },
    );
  });
});

describe('gog_calendar_colors', () => {
  it('calls runOrDiagnose with the colors subcommand', async () => {
    await handlers.get('gog_calendar_colors')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'colors'], { account: undefined });
  });
});

describe('gog_calendar_acl', () => {
  it('calls runOrDiagnose with calendarId only', async () => {
    await handlers.get('gog_calendar_acl')!({ calendarId: 'primary' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'acl', 'primary'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_calendar_acl')!({ calendarId: 'primary', max: 25, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'acl', 'primary', '--max=25', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_calendar_acl')!({ calendarId: 'primary', all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['calendar', 'acl', 'primary'], { account: undefined });
  });
});

describe('gog_calendar_move', () => {
  it('calls runOrDiagnose with the three positionals', async () => {
    await handlers.get('gog_calendar_move')!({
      calendarId: 'primary', eventId: 'ev1', destinationCalendarId: 'team@x.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'move', 'primary', 'ev1', 'team@x.com'],
      { account: undefined },
    );
  });

  it('passes --send-updates when provided', async () => {
    await handlers.get('gog_calendar_move')!({
      calendarId: 'primary', eventId: 'ev1', destinationCalendarId: 'team@x.com',
      sendUpdates: 'all',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'move', 'primary', 'ev1', 'team@x.com', '--send-updates=all'],
      { account: undefined },
    );
  });
});

describe('gog_calendar_out_of_office', () => {
  it('calls runOrDiagnose with required from/to only', async () => {
    await handlers.get('gog_calendar_out_of_office')!({ from: '2026-06-01', to: '2026-06-05' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'out-of-office', '--from=2026-06-01', '--to=2026-06-05'],
      { account: undefined },
    );
  });

  it('passes calendarId and all optional flags when provided', async () => {
    await handlers.get('gog_calendar_out_of_office')!({
      from: '2026-06-01', to: '2026-06-05',
      calendarId: 'primary',
      summary: 'Vacation',
      autoDecline: 'new',
      declineMessage: 'Away',
      allDay: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'calendar', 'out-of-office', 'primary',
        '--from=2026-06-01', '--to=2026-06-05',
        '--summary=Vacation', '--auto-decline=new',
        '--decline-message=Away', '--all-day',
      ],
      { account: undefined },
    );
  });

  it('omits --all-day when false', async () => {
    await handlers.get('gog_calendar_out_of_office')!({ from: '2026-06-01', to: '2026-06-05', allDay: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['calendar', 'out-of-office', '--from=2026-06-01', '--to=2026-06-05'],
      { account: undefined },
    );
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
