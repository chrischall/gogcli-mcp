import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCalendarTools, CALENDAR_EVENTS_COMPACT_FIELDS } from '../../src/tools/calendar.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerCalendarTools);

// gog_calendar_events answers in the compact rung by default, so every call
// carries the mask. These keep the window-flag tests below about window flags
// while still asserting the shipped default rather than an opted-out view.
const evArgs = (...extra: string[]) =>
  ['calendar', 'events', ...extra, `--fields=${CALENDAR_EVENTS_COMPACT_FIELDS}`];
const evOpts = { account: undefined, fieldsMask: CALENDAR_EVENTS_COMPACT_FIELDS };

beforeEach(() => vi.clearAllMocks());

describe('gog_calendar_events', () => {
  it('calls run with no filters', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"items":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', {});
    expect(runner.run).toHaveBeenCalledWith(evArgs(), evOpts);
  });

  // The cheap rung is the default. Measured at 66% smaller on a 25-event
  // window — the largest saving available in this repo, because a calendar
  // event's description and attendee list dwarf the fields a caller acts on.
  it('sends no mask for the full view', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"items":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { view: 'full' });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'events'],
      { account: undefined, fieldsMask: undefined },
    );
  });

  // A Google field mask drops nextPageToken from the envelope, so a compact
  // read returns page one with an EMPTY cursor. This tool's own description
  // warns that a wide range is usually incomplete and to page until the cursor
  // is gone — a mask that silently removes the cursor would turn that guidance
  // into a guarantee of the wrong answer. Verified live against gog 0.39.0.
  it('names the paging field in the mask', () => {
    expect(CALENDAR_EVENTS_COMPACT_FIELDS).toMatch(/^nextPageToken,/);
  });

  it('rejects a view rung this tool does not honour', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_events', { view: 'raw' });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  // The window flags are pinned as SEPARATE cases on purpose: gog >= 0.36.0
  // (openclaw/gogcli#981) rejects a fixed preset combined with from/to/days,
  // and days combined with to, so one test passing them all at once would
  // assert an arg array gog refuses to run.
  it('appends calendarId and an explicit from/to range', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', {
      calendarId: 'primary',
      from: '2026-01-01',
      to: '2026-01-31',
      query: 'standup',
      all: true,
    });
    expect(runner.run).toHaveBeenCalledWith(evArgs('primary', '--from=2026-01-01', '--to=2026-01-31', '--query=standup', '--all'), evOpts);
  });

  it('appends --today on its own', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { today: true });
    expect(runner.run).toHaveBeenCalledWith(evArgs('--today'), evOpts);
  });

  it('anchors --days at --from when both are given', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { from: '2026-09-25', days: 5 });
    expect(runner.run).toHaveBeenCalledWith(evArgs('--from=2026-09-25', '--days=5'), evOpts);
  });

  it('passes --days alone as a today-anchored window', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { days: 7 });
    expect(runner.run).toHaveBeenCalledWith(evArgs('--days=7'), evOpts);
  });

  it('repeats --event-types for each requested type', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { eventTypes: ['default', 'out-of-office'] });
    expect(runner.run).toHaveBeenCalledWith(evArgs('--event-types=default', '--event-types=out-of-office'), evOpts);
  });

  it('appends --timezone when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { timezone: 'America/New_York' });
    expect(runner.run).toHaveBeenCalledWith(evArgs('--timezone=America/New_York'), evOpts);
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Events failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_events', {});
    expect(result.content[0].text).toBe('Error: Events failed');
  });
});

describe('gog_calendar_get', () => {
  it('calls run with calendarId and eventId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"evt1"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_get', { calendarId: 'primary', eventId: 'evt1' });
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'event', 'primary', 'evt1'], { account: undefined });
  });

  it('appends --timezone when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"evt1"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_get', { calendarId: 'primary', eventId: 'evt1', timezone: 'local' });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'event', 'primary', 'evt1', '--timezone=local'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_get', { calendarId: 'primary', eventId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_calendar_create', () => {
  it('calls run with required args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"evt2"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'Standup',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T09:30:00Z',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'create', 'primary', '--summary=Standup', '--from=2026-04-14T09:00:00Z', '--to=2026-04-14T09:30:00Z'],
      { account: undefined },
    );
  });

  it('appends optional flags when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'All-day',
      from: '2026-04-14',
      to: '2026-04-15',
      description: 'Desc',
      location: 'NYC',
      attendees: 'a@b.com,c@d.com',
      allDay: true,
      timezone: 'America/New_York',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'calendar', 'create', 'primary',
        '--summary=All-day', '--from=2026-04-14', '--to=2026-04-15',
        '--description=Desc', '--location=NYC', '--attendees=a@b.com,c@d.com', '--all-day',
        '--timezone=America/New_York',
      ],
      { account: undefined },
    );
  });

  // gog 0.18.0: --with-zoom attaches a Zoom conference via description-mode
  // integration (native conference card not supported for non-Workspace-Marketplace
  // OAuth clients).
  it('passes --with-zoom when withZoom is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'Sync',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T09:30:00Z',
      withZoom: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'calendar', 'create', 'primary',
        '--summary=Sync', '--from=2026-04-14T09:00:00Z', '--to=2026-04-14T09:30:00Z',
        '--with-zoom',
      ],
      { account: undefined },
    );
  });

  it('omits --with-zoom when false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_create', {
      calendarId: 'primary', summary: 's', from: 'f', to: 't', withZoom: false,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'create', 'primary', '--summary=s', '--from=f', '--to=t'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_create', { calendarId: 'p', summary: 's', from: 'f', to: 't' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_calendar_update', () => {
  it('calls run with only provided fields', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary',
      eventId: 'evt1',
      summary: 'New Title',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--summary=New Title'],
      { account: undefined },
    );
  });

  // gog 0.24.0
  it('passes repeatable --attachment values, and an empty string to clear', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', attachments: ['https://drive.google.com/file/d/a', 'https://x.test/b.pdf'],
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--attachment=https://drive.google.com/file/d/a', '--attachment=https://x.test/b.pdf'],
      { account: undefined },
    );
    await harness.callTool('gog_calendar_update', { calendarId: 'primary', eventId: 'evt1', attachments: [''] });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--attachment='],
      { account: undefined },
    );
  });

  it('passes all optional fields when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary',
      eventId: 'evt1',
      summary: 'New',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T10:00:00Z',
      description: 'Desc',
      location: 'NYC',
      attendees: 'a@b.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'calendar', 'update', 'primary', 'evt1',
        '--summary=New', '--from=2026-04-14T09:00:00Z', '--to=2026-04-14T10:00:00Z',
        '--description=Desc', '--location=NYC', '--attendees=a@b.com',
      ],
      { account: undefined },
    );
  });

  // gog 0.31.1: --add-attendee preserves existing attendees; --attendees replaces all.
  it('passes --add-attendee with modifiers without touching --attendees', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary',
      eventId: 'evt1',
      addAttendees: 'room@resource.calendar.google.com;resource,x@y.com;optional',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'calendar', 'update', 'primary', 'evt1',
        '--add-attendee=room@resource.calendar.google.com;resource,x@y.com;optional',
      ],
      { account: undefined },
    );
  });

  // gog 0.18.0 Zoom flags: with-zoom adds, regenerate-zoom replaces, remove-zoom strips.
  it('passes --with-zoom / --regenerate-zoom / --remove-zoom independently', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', withZoom: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--with-zoom'],
      { account: undefined },
    );

    vi.clearAllMocks();
    vi.mocked(runner.run).mockResolvedValue('{}');
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', regenerateZoom: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--regenerate-zoom'],
      { account: undefined },
    );

    vi.clearAllMocks();
    vi.mocked(runner.run).mockResolvedValue('{}');
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', removeZoom: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--remove-zoom'],
      { account: undefined },
    );
  });

  // gog 0.34.x (#926): remove-meet clears an event's Google Meet conference data.
  it('passes --remove-meet', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', removeMeet: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--remove-meet'],
      { account: undefined },
    );
  });

  it('omits zoom flags when all false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1',
      withZoom: false, regenerateZoom: false, removeZoom: false,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_update', { calendarId: 'p', eventId: 'e' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

describe('gog_calendar_delete', () => {
  it('calls run with calendarId and eventId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_delete', { calendarId: 'primary', eventId: 'evt1' });
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'delete', 'primary', 'evt1', '--force'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_delete', { calendarId: 'p', eventId: 'e' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_calendar_respond', () => {
  it('calls run with status', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_respond', { calendarId: 'primary', eventId: 'evt1', status: 'accepted' });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'respond', 'primary', 'evt1', '--status=accepted'],
      { account: undefined },
    );
  });

  it('appends comment when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_respond', {
      calendarId: 'primary',
      eventId: 'evt1',
      status: 'declined',
      comment: 'Can\'t make it',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'respond', 'primary', 'evt1', '--status=declined', '--comment=Can\'t make it'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Respond failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_respond', { calendarId: 'p', eventId: 'e', status: 'accepted' });
    expect(result.content[0].text).toBe('Error: Respond failed');
  });
});

describe('gog_calendar_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_run', { subcommand: 'calendars', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'calendars'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_run', { subcommand: 'freebusy', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});


describe('gog_calendar_events — pagination (previously absent entirely)', () => {
  // gog defaults this command to --max=10 and the tool exposed NEITHER max nor
  // a cursor, so a wide date range silently returned 10 events with a live
  // token the caller could not use. Measured live: 2025-01-01..2026-08-01 gave
  // 10 of 12.
  it('passes --max and --page through to gog', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"events":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { max: 100, pageToken: 'CURSOR' });
    const args = vi.mocked(runner.run).mock.calls[0][0] as string[];
    expect(args).toContain('--max=100');
    expect(args).toContain('--page=CURSOR');
  });

  it('accepts the deprecated page alias', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"events":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { page: 'CURSOR' });
    expect(vi.mocked(runner.run).mock.calls[0][0]).toContain('--page=CURSOR');
  });

  it('keeps --all meaning ALL CALENDARS, not all pages', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"events":[]}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_events', { all: true });
    expect(vi.mocked(runner.run).mock.calls[0][0]).toContain('--all');
  });

  it('marks a capped range truncated, with no fabricated total', async () => {
    vi.mocked(runner.run).mockResolvedValue(JSON.stringify({
      events: [{ id: 'e1' }, { id: 'e2' }],
      nextPageToken: 'MORE',
    }));
    const harness = await setupHandlers();
    const out = JSON.parse((await harness.callTool('gog_calendar_events',
      { from: '2025-01-01', to: '2026-08-01' })).content[0].text as string);
    expect(out.truncated).toBe(true);
    expect(out.returned).toBe(2);
    expect(out).not.toHaveProperty('totalMatches');
    expect(out.warning).toContain('INCOMPLETE RESULT SET: returned 2 matches and MORE EXIST');
  });

  it('leaves a complete range unannotated', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"events":[{"id":"e1"}],"nextPageToken":""}');
    const harness = await setupHandlers();
    const out = JSON.parse((await harness.callTool('gog_calendar_events', {})).content[0].text as string);
    expect(out).not.toHaveProperty('truncated');
    expect(out).not.toHaveProperty('nextPageToken');
  });
});

// Reminders (gog >= 0.38.0 for --no-reminders, openclaw/gogcli#1002/#1016).
// Three distinct states share these two params and gog spells each one
// differently, so each is pinned separately: custom overrides, "no reminders at
// all", and — on update only — "go back to whatever the calendar says", which
// is an EMPTY --reminder rather than a flag of its own. All three were verified
// against a real gog 0.38.0 with --dry-run.
describe('gog_calendar_create reminders', () => {
  it('passes each reminder as its own repeated flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'Standup',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T09:30:00Z',
      reminders: ['popup:30m', 'email:1d'],
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'create', 'primary', '--summary=Standup', '--from=2026-04-14T09:00:00Z', '--to=2026-04-14T09:30:00Z',
        '--reminder=popup:30m', '--reminder=email:1d'],
      { account: undefined },
    );
  });

  it('passes --no-reminders', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'Quiet',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T09:30:00Z',
      noReminders: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'create', 'primary', '--summary=Quiet', '--from=2026-04-14T09:00:00Z', '--to=2026-04-14T09:30:00Z',
        '--no-reminders'],
      { account: undefined },
    );
  });

  it('rejects reminders and noReminders together, as gog does', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'Both',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T09:30:00Z',
      reminders: ['popup:10m'],
      noReminders: true,
    });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects more than the five reminders Google allows', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_calendar_create', {
      calendarId: 'primary',
      summary: 'Too many',
      from: '2026-04-14T09:00:00Z',
      to: '2026-04-14T09:30:00Z',
      reminders: ['popup:1m', 'popup:2m', 'popup:3m', 'popup:4m', 'popup:5m', 'popup:6m'],
    });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('gog_calendar_update reminders', () => {
  it('replaces the overrides', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', reminders: ['popup:15m'],
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--reminder=popup:15m'],
      { account: undefined },
    );
  });

  // Verified live: `calendar update … --reminder= --dry-run` patches
  // reminders.useDefault=true with overrides cleared.
  it('restores the calendar defaults with an empty reminder list', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', reminders: [],
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--reminder='],
      { account: undefined },
    );
  });

  it('turns every reminder off', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', noReminders: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--no-reminders'],
      { account: undefined },
    );
  });

  it('leaves reminders alone when neither param is given', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_calendar_update', {
      calendarId: 'primary', eventId: 'evt1', summary: 'Renamed',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--summary=Renamed'],
      { account: undefined },
    );
  });
});
