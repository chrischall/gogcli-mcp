import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { McpServer, ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import * as runner from '../../src/runner.js';
import { pos } from '../../src/argv.js';
import { resetConfirmTokenState } from '../../src/send-confirm-token.js';
import { CONFIRM_ACTION_INSTRUCTION } from '../../src/dispatch-confirmation.js';
import { registerChatTools } from '../../src/tools/chat.js';
import { registerDriveTools, shareTargetMeta } from '../../src/tools/drive.js';
import { registerClassroomTools, readCourse } from '../../src/tools/classroom.js';
import { registerCalendarTools, eventSnapshot, parseAttendees } from '../../src/tools/calendar.js';

vi.mock('../../src/runner.js');

// ============================================================================
// The dispatch rail beyond Gmail: Chat posts, Drive shares, Classroom
// announcements, guest-visible Calendar changes. Each is exercised three ways —
// a client that can be prompted, one that cannot (refusal + hint), and the
// opt-in confirmToken fallback.
// ============================================================================

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GOG_SEND_CONFIRM_FALLBACK;
  delete process.env.GOG_CONFIRM_TTL_SECONDS;
  delete process.env.GOG_CONFIRM_SECRET;
  process.env.GOG_ACCOUNT = 'me@example.com';
  resetConfirmTokenState();
});

afterEach(() => { process.env = ORIGINAL_ENV; });

type Register = (server: McpServer) => void;
const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);

/** A client that CAN be prompted, answering with `answer` and recording the prompt. */
async function prompted(register: Register, answer: ElicitResult = { action: 'accept', content: { confirmed: true } }) {
  const seen: ElicitRequest[] = [];
  const harness = await createTestHarness(register, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const unprompted = (register: Register) => createTestHarness(register);

/** Calls whose argv starts with these words. */
const callsTo = (...words: string[]) => vi.mocked(runner.run).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));

/** Answer reads with `reads[<joined command words>]`, everything else with `{}`. */
function stubReads(reads: Record<string, string>) {
  vi.mocked(runner.run).mockImplementation(async (args) => {
    const key = (args as unknown[]).filter((a) => typeof a === 'string' && !a.startsWith('--')).join(' ');
    for (const [prefix, out] of Object.entries(reads)) if (key.startsWith(prefix)) return out;
    return '{"ok":true}';
  });
}

describe('gog_chat_messages_send / gog_chat_dm_send', () => {
  it('prompts with the space and text, then posts once accepted', async () => {
    stubReads({});
    const { harness, details } = await prompted(registerChatTools);
    await harness.callTool('gog_chat_messages_send', { space: 'spaces/AAA', text: 'Ship it', thread: 'spaces/AAA/threads/T' });
    expect(details()).toMatchObject({ space: 'spaces/AAA', thread: 'spaces/AAA/threads/T', textPreview: 'Ship it', attachments: [] });
    expect(callsTo('chat', 'messages', 'send')).toHaveLength(1);
  });

  it('posts nothing when the user declines', async () => {
    const { harness } = await prompted(registerChatTools, { action: 'decline' });
    const r = json(await harness.callTool('gog_chat_dm_send', { email: 'alice@example.com', text: 'hi' }));
    expect(r).toMatchObject({ confirmed: false, cancelled: true, action: 'chat.dm-send' });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('refuses a client that cannot be prompted, naming the fallback switch', async () => {
    const harness = await unprompted(registerChatTools);
    const r = json(await harness.callTool('gog_chat_messages_send', { space: 'spaces/AAA', text: 'x' }));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'chat.message-send' });
    expect(r.note).toContain('GOG_SEND_CONFIRM_FALLBACK=token');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('token fallback: previews in full, posts on phase 2, refuses a changed text', async () => {
    process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
    stubReads({});
    const harness = await unprompted(registerChatTools);
    const args = { space: 'spaces/AAA', text: 'Ship it', attachInline: [{ filename: 'a.txt', contentBase64: Buffer.from('hey').toString('base64') }] };
    const p1 = json(await harness.callTool('gog_chat_messages_send', args));
    expect(p1).toMatchObject({
      status: 'confirmation-required',
      preview: { from: 'me@example.com', space: 'spaces/AAA', text: 'Ship it', attachments: [{ name: 'a.txt', size: 3 }] },
      instruction: CONFIRM_ACTION_INSTRUCTION,
    });
    expect(json(await harness.callTool('gog_chat_messages_send', { ...args, text: 'Ship it!', confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    await harness.callTool('gog_chat_messages_send', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('chat', 'messages', 'send')).toHaveLength(1);

    const dm = json(await harness.callTool('gog_chat_dm_send', { email: 'alice@example.com', text: 'hi' }));
    expect(dm.preview).toEqual({ from: 'me@example.com', to: 'alice@example.com', text: 'hi' });
    await harness.callTool('gog_chat_dm_send', { email: 'alice@example.com', text: 'hi', confirmToken: dm.confirmToken });
    expect(callsTo('chat', 'dm', 'send')).toHaveLength(1);
  });
});

describe('gog_drive_share', () => {
  const FILE = JSON.stringify({ file: { id: 'f1', name: 'Payroll 2026.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' } });

  it('reads the file and prompts with its name, grantee and role; shares once accepted', async () => {
    stubReads({ 'drive get': FILE });
    const { harness, details } = await prompted(registerDriveTools);
    await harness.callTool('gog_drive_share', { fileId: 'f1', to: 'user', email: 'bob@example.com', role: 'writer' });
    expect(details()).toEqual({
      file: { id: 'f1', name: 'Payroll 2026.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' },
      to: 'user', email: 'bob@example.com', role: 'writer', publicLink: false,
    });
    expect(callsTo('drive', 'share')).toHaveLength(1);
  });

  it('flags a public link in the prompt heading', async () => {
    stubReads({ 'drive get': FILE });
    const { harness, seen } = await prompted(registerDriveTools, { action: 'decline' });
    await harness.callTool('gog_drive_share', { fileId: 'f1', to: 'anyone' });
    expect(seen[0]!.params.message).toMatch(/ANYONE with the link/);
    expect(callsTo('drive', 'share')).toHaveLength(0);
  });

  it('returns a failed read without prompting or sharing', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('File not found: f1'));
    const { harness, seen } = await prompted(registerDriveTools);
    const r = await harness.callTool('gog_drive_share', { fileId: 'f1', to: 'user', email: 'b@example.com' });
    expect(r.isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(callsTo('drive', 'share')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted, and says how the user can share it', async () => {
    stubReads({ 'drive get': FILE });
    const harness = await unprompted(registerDriveTools);
    const r = json(await harness.callTool('gog_drive_share', { fileId: 'f1', to: 'domain', domain: 'example.com' }));
    expect(r.note).toMatch(/share it themselves from Google Drive/);
    expect(r.note).toContain('GOG_SEND_CONFIRM_FALLBACK=token');
  });

  it('token fallback: binds the file as read — a renamed file is DRAFT_CHANGED', async () => {
    process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
    stubReads({ 'drive get': FILE });
    const harness = await unprompted(registerDriveTools);
    const args = { fileId: 'f1', to: 'anyone' as const };
    const p1 = json(await harness.callTool('gog_drive_share', args));
    expect(p1.preview).toMatchObject({ file: { name: 'Payroll 2026.xlsx' }, publicLink: true, role: 'reader' });
    stubReads({ 'drive get': JSON.stringify({ file: { id: 'f1', name: 'Renamed' } }) });
    expect(json(await harness.callTool('gog_drive_share', { ...args, confirmToken: p1.confirmToken }))).toMatchObject({ error: 'DRAFT_CHANGED' });
    stubReads({ 'drive get': FILE });
    await harness.callTool('gog_drive_share', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('drive', 'share')).toHaveLength(1);
    expect(callsTo('drive', 'share')[0]![0]).toContain('--force');
  });

  it('shareTargetMeta tolerates unreadable output', () => {
    expect(shareTargetMeta('nope')).toEqual({});
  });
});

describe('gog_classroom_announcements_create', () => {
  const COURSE = JSON.stringify({ course: { id: 'c1', name: 'Algebra II', section: 'Period 3' } });

  it('posts a DRAFT without reading the course or asking', async () => {
    stubReads({});
    const { harness, seen } = await prompted(registerClassroomTools);
    await harness.callTool('gog_classroom_announcements_create', { courseId: 'c1', text: 'x', state: 'DRAFT' });
    expect(seen).toHaveLength(0);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(callsTo('classroom', 'announcements', 'create')).toHaveLength(1);
  });

  it('prompts with the class, the text and when it publishes', async () => {
    stubReads({ 'classroom courses get': COURSE });
    const { harness, details } = await prompted(registerClassroomTools);
    await harness.callTool('gog_classroom_announcements_create', { courseId: 'c1', text: 'Quiz Friday', scheduled: '2026-09-25T08:00:00Z' });
    expect(details()).toEqual({
      course: { id: 'c1', name: 'Algebra II', section: 'Period 3' },
      publishes: 'at 2026-09-25T08:00:00Z',
      textPreview: 'Quiz Friday',
    });
    expect(callsTo('classroom', 'announcements', 'create')).toHaveLength(1);
  });

  it('refuses a client that cannot be prompted, pointing at DRAFT', async () => {
    stubReads({ 'classroom courses get': COURSE });
    const harness = await unprompted(registerClassroomTools);
    const r = json(await harness.callTool('gog_classroom_announcements_create', { courseId: 'c1', text: 'x' }));
    expect(r.note).toMatch(/state DRAFT instead/);
    expect(callsTo('classroom', 'announcements', 'create')).toHaveLength(0);
  });

  it('token fallback: phase 1 previews, phase 2 posts', async () => {
    process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
    stubReads({ 'classroom courses get': COURSE });
    const harness = await unprompted(registerClassroomTools);
    const p1 = json(await harness.callTool('gog_classroom_announcements_create', { courseId: 'c1', text: 'Quiz Friday' }));
    expect(p1.preview).toEqual({ course: { id: 'c1', name: 'Algebra II', section: 'Period 3' }, publishes: 'immediately', text: 'Quiz Friday' });
    await harness.callTool('gog_classroom_announcements_create', { courseId: 'c1', text: 'Quiz Friday', confirmToken: p1.confirmToken });
    expect(callsTo('classroom', 'announcements', 'create')).toHaveLength(1);
  });

  it('returns a failed course read without posting', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('course not found'));
    const { harness } = await prompted(registerClassroomTools);
    expect((await harness.callTool('gog_classroom_announcements_create', { courseId: 'c1', text: 'x' })).isError).toBe(true);
    expect(callsTo('classroom', 'announcements', 'create')).toHaveLength(0);
  });

  it('readCourse names nothing for unreadable output', async () => {
    vi.mocked(runner.run).mockResolvedValue('not json');
    expect(await readCourse('c9', undefined)).toEqual({ course: { id: 'c9' } });
    vi.mocked(runner.run).mockResolvedValue('{"course":{"name":7}}');
    expect(await readCourse('c9', undefined)).toEqual({ course: { id: 'c9' } });
  });
});

describe('calendar', () => {
  const EVENT = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    event: {
      id: 'e1',
      etag: '"v1"',
      summary: 'Budget review',
      start: { dateTime: '2026-09-30T14:00:00-04:00' },
      end: { dateTime: '2026-09-30T15:00:00-04:00' },
      organizer: { email: 'boss@example.com' },
      attendees: [
        { email: 'me@example.com', self: true },
        { email: 'boss@example.com' },
        { email: 'room-4@resource.calendar.google.com', resource: true },
      ],
      ...overrides,
    },
  });

  describe('gog_calendar_create', () => {
    it('creates a guest-free event without asking', async () => {
      stubReads({});
      const { harness, seen } = await prompted(registerCalendarTools);
      await harness.callTool('gog_calendar_create', { calendarId: 'primary', summary: 'Focus', from: 'a', to: 'b' });
      expect(seen).toHaveLength(0);
      expect(callsTo('calendar', 'create')).toHaveLength(1);
    });

    it('treats a rooms-only attendee list as guest-free', async () => {
      stubReads({});
      const { harness, seen } = await prompted(registerCalendarTools);
      await harness.callTool('gog_calendar_create', { calendarId: 'primary', summary: 'Focus', from: 'a', to: 'b', attendees: 'room@r.example;resource' });
      expect(seen).toHaveLength(0);
    });

    it('asks before putting an event on guests\' calendars', async () => {
      stubReads({});
      const { harness, details } = await prompted(registerCalendarTools, { action: 'decline' });
      await harness.callTool('gog_calendar_create', { calendarId: 'primary', summary: 'Sync', from: 'a', to: 'b', attendees: 'alice@example.com;optional,bob@example.com' });
      expect(details()).toMatchObject({ summary: 'Sync', guests: ['alice@example.com', 'bob@example.com'], allDay: false, withZoom: false });
      expect(callsTo('calendar', 'create')).toHaveLength(0);
    });

    it('refuses a client that cannot be prompted, pointing at a guest-free create', async () => {
      const harness = await unprompted(registerCalendarTools);
      const r = json(await harness.callTool('gog_calendar_create', { calendarId: 'primary', summary: 'Sync', from: 'a', to: 'b', attendees: 'alice@example.com' }));
      expect(r.note).toMatch(/without attendees/);
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('token fallback: previews, then creates on phase 2', async () => {
      process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
      stubReads({});
      const harness = await unprompted(registerCalendarTools);
      const args = { calendarId: 'primary', summary: 'Sync', from: 'a', to: 'b', attendees: 'alice@example.com' };
      const p1 = json(await harness.callTool('gog_calendar_create', args));
      expect(p1.preview).toMatchObject({ guests: ['alice@example.com'] });
      await harness.callTool('gog_calendar_create', { ...args, confirmToken: p1.confirmToken });
      expect(callsTo('calendar', 'create')).toHaveLength(1);
    });
  });

  describe('gog_calendar_update', () => {
    it('never reads or asks for a reminder-only change', async () => {
      stubReads({ 'calendar event': EVENT() });
      const { harness, seen } = await prompted(registerCalendarTools);
      await harness.callTool('gog_calendar_update', { calendarId: 'primary', eventId: 'e1', reminders: ['popup:10m'] });
      expect(seen).toHaveLength(0);
      expect(callsTo('calendar', 'event')).toHaveLength(0);
      expect(callsTo('calendar', 'update')).toHaveLength(1);
    });

    it('updates a guest-free event without asking', async () => {
      stubReads({ 'calendar event': EVENT({ attendees: [{ email: 'me@example.com', self: true }] }) });
      const { harness, seen } = await prompted(registerCalendarTools);
      await harness.callTool('gog_calendar_update', { calendarId: 'primary', eventId: 'e1', summary: 'Renamed' });
      expect(seen).toHaveLength(0);
      expect(callsTo('calendar', 'update')).toHaveLength(1);
    });

    it('asks before changing an event that has guests, showing it as it stands', async () => {
      stubReads({ 'calendar event': EVENT() });
      const { harness, details } = await prompted(registerCalendarTools);
      await harness.callTool('gog_calendar_update', { calendarId: 'primary', eventId: 'e1', from: '2026-10-01T14:00:00-04:00', removeZoom: false });
      expect(details()).toEqual({
        calendarId: 'primary',
        eventId: 'e1',
        current: {
          summary: 'Budget review',
          start: '2026-09-30T14:00:00-04:00',
          end: '2026-09-30T15:00:00-04:00',
          organizer: 'boss@example.com',
          guests: ['boss@example.com'],
        },
        changes: { from: '2026-10-01T14:00:00-04:00' },
      });
      expect(callsTo('calendar', 'update')).toHaveLength(1);
    });

    it('asks when a guest-free event gains guests', async () => {
      stubReads({ 'calendar event': EVENT({ attendees: undefined }) });
      const { harness, seen } = await prompted(registerCalendarTools, { action: 'decline' });
      await harness.callTool('gog_calendar_update', { calendarId: 'primary', eventId: 'e1', addAttendees: 'new@example.com' });
      expect(seen).toHaveLength(1);
      expect(callsTo('calendar', 'update')).toHaveLength(0);
    });

    it('returns a failed event read without updating', async () => {
      vi.mocked(runner.run).mockRejectedValue(new Error('event not found'));
      const { harness } = await prompted(registerCalendarTools);
      expect((await harness.callTool('gog_calendar_update', { calendarId: 'primary', eventId: 'e1', summary: 'x' })).isError).toBe(true);
      expect(callsTo('calendar', 'update')).toHaveLength(0);
    });

    it('token fallback: an event edited elsewhere between the phases (etag rotated) is DRAFT_CHANGED', async () => {
      process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
      stubReads({ 'calendar event': EVENT() });
      const harness = await unprompted(registerCalendarTools);
      const args = { calendarId: 'primary', eventId: 'e1', summary: 'Budget review (moved)' };
      const p1 = json(await harness.callTool('gog_calendar_update', args));
      expect(p1.status).toBe('confirmation-required');
      stubReads({ 'calendar event': EVENT({ etag: '"v2"' }) });
      expect(json(await harness.callTool('gog_calendar_update', { ...args, confirmToken: p1.confirmToken })))
        .toMatchObject({ error: 'DRAFT_CHANGED', reason: 'message-id-rotated' });
      expect(callsTo('calendar', 'update')).toHaveLength(0);
    });
  });

  describe('gog_calendar_respond', () => {
    it('always asks, showing the event, organizer and response', async () => {
      stubReads({ 'calendar event': EVENT() });
      const { harness, details } = await prompted(registerCalendarTools);
      await harness.callTool('gog_calendar_respond', { calendarId: 'primary', eventId: 'e1', status: 'declined', comment: 'Conflict' });
      expect(details()).toMatchObject({ event: { summary: 'Budget review', organizer: 'boss@example.com' }, response: 'declined', comment: 'Conflict' });
      expect(callsTo('calendar', 'respond')).toHaveLength(1);
    });

    it('refuses a client that cannot be prompted', async () => {
      stubReads({ 'calendar event': EVENT() });
      const harness = await unprompted(registerCalendarTools);
      const r = json(await harness.callTool('gog_calendar_respond', { calendarId: 'primary', eventId: 'e1', status: 'accepted' }));
      expect(r.note).toMatch(/respond from Google Calendar/);
      expect(callsTo('calendar', 'respond')).toHaveLength(0);
    });

    it('returns a failed event read without responding', async () => {
      vi.mocked(runner.run).mockRejectedValue(new Error('event not found'));
      const { harness } = await prompted(registerCalendarTools);
      expect((await harness.callTool('gog_calendar_respond', { calendarId: 'primary', eventId: 'e1', status: 'accepted' })).isError).toBe(true);
    });

    it('token fallback: phase 2 records the response', async () => {
      process.env.GOG_SEND_CONFIRM_FALLBACK = 'token';
      stubReads({ 'calendar event': EVENT() });
      const harness = await unprompted(registerCalendarTools);
      const args = { calendarId: 'primary', eventId: 'e1', status: 'tentative' as const };
      const { confirmToken } = json(await harness.callTool('gog_calendar_respond', args));
      await harness.callTool('gog_calendar_respond', { ...args, confirmToken });
      expect(callsTo('calendar', 'respond')).toHaveLength(1);
      expect(callsTo('calendar', 'respond')[0]![0]).toEqual(['calendar', 'respond', pos('primary'), pos('e1'), '--status=tentative']);
    });
  });

  it('parseAttendees drops modifiers, rooms and blanks', () => {
    expect(parseAttendees(undefined)).toEqual([]);
    expect(parseAttendees(' a@x.com;optional , ,room@r;Resource,b@y.com;comment=hi ')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('eventSnapshot tolerates unreadable and partial output, and all-day dates', () => {
    expect(eventSnapshot('nope')).toEqual({ guests: [] });
    expect(eventSnapshot('{"event":{"start":{"date":"2026-10-01"},"attendees":[{"email":5},{}],"summary":3}}'))
      .toEqual({ start: '2026-10-01', guests: [] });
  });
});
