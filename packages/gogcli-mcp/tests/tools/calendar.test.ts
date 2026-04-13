import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCalendarTools } from '../../src/tools/calendar.js';
import * as runner from '../../src/runner.js';

vi.mock('../../src/runner.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerCalendarTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_calendar_events', () => {
  it('calls run with no filters', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"items":[]}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_events')!({});
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'events'], { account: undefined });
  });

  it('appends calendarId and filters when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_events')!({
      calendarId: 'primary',
      from: '2026-01-01',
      to: '2026-01-31',
      today: true,
      query: 'standup',
      all: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'events', 'primary', '--from=2026-01-01', '--to=2026-01-31', '--today', '--query=standup', '--all'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Events failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_events')!({});
    expect(result.content[0].text).toBe('Error: Events failed');
  });
});

describe('gog_calendar_get', () => {
  it('calls run with calendarId and eventId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"evt1"}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_get')!({ calendarId: 'primary', eventId: 'evt1' });
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'event', 'primary', 'evt1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_get')!({ calendarId: 'primary', eventId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_calendar_create', () => {
  it('calls run with required args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"id":"evt2"}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_create')!({
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
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_create')!({
      calendarId: 'primary',
      summary: 'All-day',
      from: '2026-04-14',
      to: '2026-04-15',
      description: 'Desc',
      location: 'NYC',
      attendees: 'a@b.com,c@d.com',
      allDay: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'calendar', 'create', 'primary',
        '--summary=All-day', '--from=2026-04-14', '--to=2026-04-15',
        '--description=Desc', '--location=NYC', '--attendees=a@b.com,c@d.com', '--all-day',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_create')!({ calendarId: 'p', summary: 's', from: 'f', to: 't' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_calendar_update', () => {
  it('calls run with only provided fields', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_update')!({
      calendarId: 'primary',
      eventId: 'evt1',
      summary: 'New Title',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'update', 'primary', 'evt1', '--summary=New Title'],
      { account: undefined },
    );
  });

  it('passes all optional fields when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_update')!({
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

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_update')!({ calendarId: 'p', eventId: 'e' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

describe('gog_calendar_delete', () => {
  it('calls run with calendarId and eventId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_delete')!({ calendarId: 'primary', eventId: 'evt1' });
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'delete', 'primary', 'evt1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_delete')!({ calendarId: 'p', eventId: 'e' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_calendar_respond', () => {
  it('calls run with status', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_respond')!({ calendarId: 'primary', eventId: 'evt1', status: 'accepted' });
    expect(runner.run).toHaveBeenCalledWith(
      ['calendar', 'respond', 'primary', 'evt1', '--status=accepted'],
      { account: undefined },
    );
  });

  it('appends comment when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_respond')!({
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
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_respond')!({ calendarId: 'p', eventId: 'e', status: 'accepted' });
    expect(result.content[0].text).toBe('Error: Respond failed');
  });
});

describe('gog_calendar_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_calendar_run')!({ subcommand: 'calendars', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['calendar', 'calendars'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_calendar_run')!({ subcommand: 'freebusy', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
