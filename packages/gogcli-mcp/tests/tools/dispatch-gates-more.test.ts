import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { McpServer, ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import * as runner from '../../src/runner.js';
import { pos } from '../../src/argv.js';
import { resetConfirmTokenState } from '../../src/send-confirm-token.js';
import { registerChatTools } from '../../src/tools/chat.js';
import { registerAppScriptTools, projectSnapshot } from '../../src/tools/appscript.js';
import { registerClassroomTools, readCoursework, readSubmission, studentLabel } from '../../src/tools/classroom.js';
import { registerCalendarTools, eventSnapshot } from '../../src/tools/calendar.js';
import { registerDriveTools, commentMentions, commentSnapshot } from '../../src/tools/drive.js';

vi.mock('../../src/runner.js');

// ============================================================================
// The dispatch rail, second wave (fleet audit 2026-09-24 SEC-6): tools that
// notify people, grant access, run code under the account's authority or
// delete for good. Same three ways as dispatch-gates.test.ts — a client that
// can be prompted, one that cannot (refusal + hint), and the confirmToken
// fallback — plus each tool's "nothing to ask about" path stays unprompted.
// ============================================================================

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_CONFIRM_MODE;
  delete process.env.MCP_CONFIRM_TTL_SECONDS;
  delete process.env.MCP_CONFIRM_SECRET;
  process.env.GOG_ACCOUNT = 'me@example.com';
  resetConfirmTokenState();
});

afterEach(() => { process.env = ORIGINAL_ENV; });

type Register = (server: McpServer) => void;
const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);

async function prompted(register: Register, answer: ElicitResult = { action: 'accept', content: { confirmed: true } }) {
  const seen: ElicitRequest[] = [];
  const harness = await createTestHarness(register, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const unprompted = (register: Register) => createTestHarness(register);

const callsTo = (...words: string[]) => vi.mocked(runner.run).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));

/** Answer reads with `reads[<joined command words>]`, everything else with `{}`; a `failing` prefix rejects. */
function stubReads(reads: Record<string, string>, failing?: string) {
  vi.mocked(runner.run).mockImplementation(async (args) => {
    const key = (args as unknown[]).filter((a) => typeof a === 'string' && !a.startsWith('--')).join(' ');
    if (failing && key.startsWith(failing)) throw new Error(`${failing} failed`);
    for (const [prefix, out] of Object.entries(reads)) if (key.startsWith(prefix)) return out;
    return '{"ok":true}';
  });
}

describe('gog_chat_spaces_create', () => {
  it('creates a member-less space without asking', async () => {
    stubReads({});
    const { harness, seen } = await prompted(registerChatTools);
    await harness.callTool('gog_chat_spaces_create', { displayName: 'Solo' });
    expect(seen).toHaveLength(0);
    expect(callsTo('chat', 'spaces', 'create')).toHaveLength(1);
  });

  it('asks with the name and members, then creates once accepted', async () => {
    stubReads({});
    const { harness, details } = await prompted(registerChatTools);
    await harness.callTool('gog_chat_spaces_create', { displayName: 'Launch', members: ['a@example.com', 'users/123'] });
    expect(details()).toEqual({ displayName: 'Launch', members: ['a@example.com', 'users/123'] });
    expect(callsTo('chat', 'spaces', 'create')[0]![0]).toEqual(
      ['chat', 'spaces', 'create', pos('Launch'), '--member=a@example.com', '--member=users/123']);
  });

  it('creates nothing when the user declines', async () => {
    const { harness } = await prompted(registerChatTools, { action: 'decline' });
    const r = json(await harness.callTool('gog_chat_spaces_create', { displayName: 'Launch', members: ['a@example.com'] }));
    expect(r).toMatchObject({ confirmed: false, cancelled: true, action: 'chat.space-create' });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('refuses a client that cannot be prompted, pointing at a member-less create', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const harness = await unprompted(registerChatTools);
    const r = json(await harness.callTool('gog_chat_spaces_create', { displayName: 'Launch', members: ['a@example.com'] }));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'chat.space-create' });
    expect(r.note).toMatch(/without members/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('token fallback: previews the members, creates on phase 2, refuses a changed list', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stubReads({});
    const harness = await unprompted(registerChatTools);
    const args = { displayName: 'Launch', members: ['a@example.com'] };
    const p1 = json(await harness.callTool('gog_chat_spaces_create', args));
    expect(p1).toMatchObject({ status: 'confirmation-required', preview: { displayName: 'Launch', members: ['a@example.com'] } });
    expect(json(await harness.callTool('gog_chat_spaces_create', { ...args, members: ['a@example.com', 'b@example.com'], confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    await harness.callTool('gog_chat_spaces_create', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('chat', 'spaces', 'create')).toHaveLength(1);
  });
});

describe('gog_appscript_run_function', () => {
  const PROJECT = JSON.stringify({ project: { scriptId: 'S1', title: 'Payroll sync' }, editor_url: 'https://script.google.com/d/S1/edit' });

  it('reads the project and asks, naming it, the function and its arguments', async () => {
    stubReads({ 'appscript get': PROJECT });
    const { harness, details } = await prompted(registerAppScriptTools);
    await harness.callTool('gog_appscript_run_function', { scriptId: 'S1', functionName: 'doWork', params: '["a", 1]' });
    expect(details()).toEqual({
      project: { scriptId: 'S1', title: 'Payroll sync' },
      functionName: 'doWork',
      params: ['a', 1],
      devMode: false,
      runsAs: 'me@example.com',
    });
    expect(callsTo('appscript', 'run')[0]![0]).toEqual(['appscript', 'run', pos('S1'), pos('doWork'), '--params=["a", 1]']);
  });

  it('still rejects malformed params before any gog call', async () => {
    const { harness, seen } = await prompted(registerAppScriptTools);
    const r = await harness.callTool('gog_appscript_run_function', { scriptId: 'S1', functionName: 'doWork', params: '{"a":1}' });
    expect(r.isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('returns a failed project read without running anything', async () => {
    stubReads({}, 'appscript get');
    const { harness, seen } = await prompted(registerAppScriptTools);
    expect((await harness.callTool('gog_appscript_run_function', { scriptId: 'S1', functionName: 'doWork' })).isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(callsTo('appscript', 'run')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stubReads({ 'appscript get': PROJECT });
    const harness = await unprompted(registerAppScriptTools);
    const r = json(await harness.callTool('gog_appscript_run_function', { scriptId: 'S1', functionName: 'doWork' }));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'appscript.run-function' });
    expect(r.note).toMatch(/Apps Script editor/);
    expect(callsTo('appscript', 'run')).toHaveLength(0);
  });

  it('token fallback: binds the arguments — different params are DRAFT_CHANGED', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stubReads({ 'appscript get': PROJECT });
    const harness = await unprompted(registerAppScriptTools);
    const args = { scriptId: 'S1', functionName: 'doWork', params: '[1]', devMode: true };
    const p1 = json(await harness.callTool('gog_appscript_run_function', args));
    expect(p1.preview).toEqual({ project: { scriptId: 'S1', title: 'Payroll sync' }, functionName: 'doWork', params: [1], devMode: true, runsAs: 'me@example.com' });
    expect(json(await harness.callTool('gog_appscript_run_function', { ...args, params: '[2]', confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    await harness.callTool('gog_appscript_run_function', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('appscript', 'run')).toHaveLength(1);
    expect(callsTo('appscript', 'run')[0]![0]).toContain('--dev-mode');
  });

  it('token fallback: code saved between the phases (updateTime rotated) is DRAFT_CHANGED', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    const at = (updateTime: string) => JSON.stringify({ project: { scriptId: 'S1', title: 'Payroll sync', updateTime } });
    stubReads({ 'appscript get': at('2026-09-24T10:00:00Z') });
    const harness = await unprompted(registerAppScriptTools);
    const args = { scriptId: 'S1', functionName: 'doWork' };
    const p1 = json(await harness.callTool('gog_appscript_run_function', args));
    expect(p1.preview.project).toEqual({ scriptId: 'S1', title: 'Payroll sync' });
    stubReads({ 'appscript get': at('2026-09-24T10:05:00Z') });
    expect(json(await harness.callTool('gog_appscript_run_function', { ...args, confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED', reason: 'revision-changed' });
    expect(callsTo('appscript', 'run')).toHaveLength(0);
  });

  it('projectSnapshot names nothing for unreadable output', () => {
    expect(projectSnapshot('nope', 'S9')).toEqual({ scriptId: 'S9' });
    expect(projectSnapshot('{"project":{"title":7}}', 'S9')).toEqual({ scriptId: 'S9' });
  });
});

describe('gog_classroom_submissions_return', () => {
  const COURSE = JSON.stringify({ course: { id: 'c1', name: 'Algebra II', section: 'Period 3' } });
  const WORK = JSON.stringify({ coursework: { id: 'w1', title: 'HW 3', state: 'PUBLISHED' } });
  const SUBMISSION = (updateTime = '2026-09-24T10:00:00Z') => JSON.stringify({
    submission: { id: 's1', userId: '1234', state: 'TURNED_IN', draftGrade: 95, assignedGrade: 90, updateTime },
  });
  const STUDENT = JSON.stringify({ student: { userId: '1234', profile: { name: { fullName: 'Pat Example' }, emailAddress: 'pat@example.com' } } });
  const READS = {
    'classroom courses get': COURSE,
    'classroom coursework get': WORK,
    'classroom submissions get': SUBMISSION(),
    'classroom students get': STUDENT,
  };
  const ARGS = { courseId: 'c1', courseworkId: 'w1', submissionId: 's1' };

  it('reads the course, the coursework, the submission and the student, and asks showing them by name', async () => {
    stubReads(READS);
    const { harness, details } = await prompted(registerClassroomTools);
    await harness.callTool('gog_classroom_submissions_return', ARGS);
    expect(details()).toEqual({
      course: { id: 'c1', name: 'Algebra II', section: 'Period 3' },
      coursework: { id: 'w1', title: 'HW 3' },
      submission: { id: 's1', student: 'Pat Example <pat@example.com>', state: 'TURNED_IN', draftGrade: 95, assignedGrade: 90 },
    });
    expect(callsTo('classroom', 'submissions', 'return')[0]![0]).toEqual(
      ['classroom', 'submissions', 'return', pos('c1'), pos('w1'), pos('s1')]);
  });

  it('returns nothing when the user declines', async () => {
    stubReads(READS);
    const { harness } = await prompted(registerClassroomTools, { action: 'decline' });
    const r = json(await harness.callTool('gog_classroom_submissions_return', ARGS));
    expect(r).toMatchObject({ confirmed: false, cancelled: true, action: 'classroom.submission-return' });
    expect(callsTo('classroom', 'submissions', 'return')).toHaveLength(0);
  });

  it.each(['classroom courses get', 'classroom coursework get', 'classroom submissions get'])(
    'returns a failed read (%s) without asking or returning', async (failing) => {
      stubReads(READS, failing);
      const { harness, seen } = await prompted(registerClassroomTools);
      expect((await harness.callTool('gog_classroom_submissions_return', ARGS)).isError).toBe(true);
      expect(seen).toHaveLength(0);
      expect(callsTo('classroom', 'submissions', 'return')).toHaveLength(0);
    });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stubReads(READS);
    const harness = await unprompted(registerClassroomTools);
    const r = json(await harness.callTool('gog_classroom_submissions_return', ARGS));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'classroom.submission-return' });
    expect(r.note).toMatch(/return it from Classroom/);
  });

  it('token fallback: a submission re-graded between the phases (updateTime rotated) is DRAFT_CHANGED', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stubReads(READS);
    const harness = await unprompted(registerClassroomTools);
    const p1 = json(await harness.callTool('gog_classroom_submissions_return', ARGS));
    expect(p1.preview).toMatchObject({ coursework: { title: 'HW 3' }, submission: { student: 'Pat Example <pat@example.com>', assignedGrade: 90 } });
    stubReads({ ...READS, 'classroom submissions get': SUBMISSION('2026-09-24T10:05:00Z') });
    expect(json(await harness.callTool('gog_classroom_submissions_return', { ...ARGS, confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED', reason: 'revision-changed' });
    stubReads(READS);
    await harness.callTool('gog_classroom_submissions_return', { ...ARGS, confirmToken: p1.confirmToken });
    expect(callsTo('classroom', 'submissions', 'return')).toHaveLength(1);
  });

  it('asks without a student line when the submission names no user', async () => {
    stubReads({ ...READS, 'classroom submissions get': JSON.stringify({ submission: { id: 's1', state: 'TURNED_IN' } }) });
    const { harness, details } = await prompted(registerClassroomTools, { action: 'decline' });
    await harness.callTool('gog_classroom_submissions_return', ARGS);
    expect(details().submission).toEqual({ id: 's1', state: 'TURNED_IN' });
    expect(callsTo('classroom', 'students', 'get')).toHaveLength(0);
  });

  it('studentLabel falls back from name+email to either, then to the id', async () => {
    const label = async (student: unknown) => {
      vi.mocked(runner.run).mockResolvedValue(JSON.stringify({ student }));
      return studentLabel('c1', 'u1', undefined);
    };
    expect(await label({ profile: { name: { fullName: 'Pat' } } })).toBe('Pat');
    expect(await label({ profile: { emailAddress: 'p@example.com' } })).toBe('p@example.com');
    expect(await label({})).toBe('u1');
    vi.mocked(runner.run).mockResolvedValue('not json');
    expect(await studentLabel('c1', 'u1', undefined)).toBe('u1');
    vi.mocked(runner.run).mockRejectedValue(new Error('not found'));
    expect(await studentLabel('c1', 'u1', undefined)).toBe('u1');
  });

  it('readCoursework and readSubmission name nothing for unreadable output', async () => {
    vi.mocked(runner.run).mockResolvedValue('not json');
    expect(await readCoursework('c9', 'w9', undefined)).toEqual({ coursework: { id: 'w9' } });
    expect(await readSubmission('c9', 'w9', 's9', undefined)).toEqual({ submission: { id: 's9' } });
    vi.mocked(runner.run).mockResolvedValue('{"coursework":{"title":7},"submission":{"userId":7,"state":null,"assignedGrade":"A"}}');
    expect(await readCoursework('c9', 'w9', undefined)).toEqual({ coursework: { id: 'w9' } });
    expect(await readSubmission('c9', 'w9', 's9', undefined)).toEqual({ submission: { id: 's9' } });
  });
});

describe('gog_calendar_delete', () => {
  const EVENT = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    event: {
      id: 'e1',
      etag: '"v1"',
      summary: 'Budget review',
      start: { dateTime: '2026-09-30T14:00:00-04:00' },
      end: { dateTime: '2026-09-30T15:00:00-04:00' },
      organizer: { email: 'me@example.com' },
      attendees: [{ email: 'me@example.com', self: true }, { email: 'boss@example.com' }],
      ...overrides,
    },
  });
  const ARGS = { calendarId: 'primary', eventId: 'e1' };

  it('deletes a guest-free, one-off event without asking', async () => {
    stubReads({ 'calendar event': EVENT({ attendees: [{ email: 'me@example.com', self: true }] }) });
    const { harness, seen } = await prompted(registerCalendarTools);
    await harness.callTool('gog_calendar_delete', ARGS);
    expect(seen).toHaveLength(0);
    expect(callsTo('calendar', 'delete')[0]![0]).toEqual(['calendar', 'delete', pos('primary'), pos('e1'), '--force']);
  });

  it('asks before deleting an event other people are on, showing it as it stands', async () => {
    stubReads({ 'calendar event': EVENT() });
    const { harness, details } = await prompted(registerCalendarTools);
    await harness.callTool('gog_calendar_delete', ARGS);
    expect(details()).toEqual({
      calendarId: 'primary',
      eventId: 'e1',
      event: {
        summary: 'Budget review',
        start: '2026-09-30T14:00:00-04:00',
        end: '2026-09-30T15:00:00-04:00',
        organizer: 'me@example.com',
        guests: ['boss@example.com'],
      },
      scope: 'this event',
    });
    expect(callsTo('calendar', 'delete')).toHaveLength(1);
  });

  it.each([
    ['a recurrence rule', { recurrence: ['RRULE:FREQ=WEEKLY'] }],
    ['a recurringEventId', { recurringEventId: 'series1' }],
  ])('asks before deleting a recurring series (%s), even guest-free, because --scope defaults to the whole series', async (_what, extra) => {
    stubReads({ 'calendar event': EVENT({ attendees: undefined, ...extra }) });
    const { harness, details } = await prompted(registerCalendarTools, { action: 'decline' });
    await harness.callTool('gog_calendar_delete', ARGS);
    expect(details()).toMatchObject({ event: { guests: [], recurring: true }, scope: 'the whole recurring series' });
    expect(callsTo('calendar', 'delete')).toHaveLength(0);
  });

  it('returns a failed event read without deleting', async () => {
    stubReads({}, 'calendar event');
    const { harness } = await prompted(registerCalendarTools);
    expect((await harness.callTool('gog_calendar_delete', ARGS)).isError).toBe(true);
    expect(callsTo('calendar', 'delete')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stubReads({ 'calendar event': EVENT() });
    const harness = await unprompted(registerCalendarTools);
    const r = json(await harness.callTool('gog_calendar_delete', ARGS));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'calendar.delete' });
    expect(r.note).toMatch(/delete it from Google Calendar/);
    expect(callsTo('calendar', 'delete')).toHaveLength(0);
  });

  it('token fallback: an event edited elsewhere between the phases (etag rotated) is DRAFT_CHANGED', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stubReads({ 'calendar event': EVENT() });
    const harness = await unprompted(registerCalendarTools);
    const p1 = json(await harness.callTool('gog_calendar_delete', ARGS));
    expect(p1.status).toBe('confirmation-required');
    stubReads({ 'calendar event': EVENT({ etag: '"v2"' }) });
    expect(json(await harness.callTool('gog_calendar_delete', { ...ARGS, confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED', reason: 'revision-changed' });
    stubReads({ 'calendar event': EVENT() });
    await harness.callTool('gog_calendar_delete', { ...ARGS, confirmToken: p1.confirmToken });
    expect(callsTo('calendar', 'delete')).toHaveLength(1);
  });

  it('eventSnapshot marks a series only when the event says so', () => {
    expect(eventSnapshot(EVENT()).recurring).toBeUndefined();
    expect(eventSnapshot(EVENT({ recurrence: [] })).recurring).toBeUndefined();
    expect(eventSnapshot(EVENT({ recurringEventId: 'x' })).recurring).toBe(true);
  });
});

describe('gog_drive_delete with permanent=true', () => {
  const FILE = JSON.stringify({ file: { id: 'f1', name: 'Payroll 2026.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' } });

  it('trashes without reading or asking', async () => {
    stubReads({ 'drive get': FILE });
    const { harness, seen } = await prompted(registerDriveTools);
    await harness.callTool('gog_drive_delete', { fileId: 'f1' });
    expect(seen).toHaveLength(0);
    expect(callsTo('drive', 'get')).toHaveLength(0);
    expect(callsTo('drive', 'delete')[0]![0]).toEqual(['drive', 'delete', pos('f1'), '--force']);
  });

  it('reads the file and asks by name before a permanent delete', async () => {
    stubReads({ 'drive get': FILE });
    const { harness, details, seen } = await prompted(registerDriveTools);
    await harness.callTool('gog_drive_delete', { fileId: 'f1', permanent: true });
    expect(seen[0]!.params.message).toMatch(/PERMANENTLY/);
    expect(details()).toEqual({
      file: { id: 'f1', name: 'Payroll 2026.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' },
      permanent: true,
    });
    expect(callsTo('drive', 'delete')[0]![0]).toEqual(['drive', 'delete', pos('f1'), '--permanent', '--force']);
  });

  it('returns a failed read without deleting', async () => {
    stubReads({}, 'drive get');
    const { harness } = await prompted(registerDriveTools);
    expect((await harness.callTool('gog_drive_delete', { fileId: 'f1', permanent: true })).isError).toBe(true);
    expect(callsTo('drive', 'delete')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted, pointing at the trash', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stubReads({ 'drive get': FILE });
    const harness = await unprompted(registerDriveTools);
    const r = json(await harness.callTool('gog_drive_delete', { fileId: 'f1', permanent: true }));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'drive.delete-permanent' });
    expect(r.note).toMatch(/trash/);
    expect(callsTo('drive', 'delete')).toHaveLength(0);
  });

  it('token fallback: binds the file as read — a renamed file is DRAFT_CHANGED', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stubReads({ 'drive get': FILE });
    const harness = await unprompted(registerDriveTools);
    const args = { fileId: 'f1', permanent: true };
    const p1 = json(await harness.callTool('gog_drive_delete', args));
    expect(p1.preview).toEqual({ file: { id: 'f1', name: 'Payroll 2026.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' }, permanent: true });
    stubReads({ 'drive get': JSON.stringify({ file: { id: 'f1', name: 'Renamed' } }) });
    expect(json(await harness.callTool('gog_drive_delete', { ...args, confirmToken: p1.confirmToken }))).toMatchObject({ error: 'DRAFT_CHANGED' });
    stubReads({ 'drive get': FILE });
    await harness.callTool('gog_drive_delete', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('drive', 'delete')).toHaveLength(1);
  });

  it('commentSnapshot reads a comment and tolerates unreadable output', () => {
    expect(commentSnapshot(JSON.stringify({ comment: { id: 'c1', content: 'Please fix', author: { displayName: 'Alice', emailAddress: 'alice@example.com' }, resolved: false } })))
      .toEqual({ author: 'Alice <alice@example.com>', content: 'Please fix', resolved: false });
    expect(commentSnapshot(JSON.stringify({ comment: { content: 'x', author: { displayName: 'Bob' } } }))).toEqual({ author: 'Bob', content: 'x' });
    expect(commentSnapshot(JSON.stringify({ comment: { author: { emailAddress: 'b@example.com' }, resolved: 'yes' } }))).toEqual({ author: 'b@example.com' });
    expect(commentSnapshot(JSON.stringify({ content: 'bare', author: { displayName: 'Cy' } }))).toEqual({ author: 'Cy', content: 'bare' });
    expect(commentSnapshot('null')).toEqual({});
    expect(commentSnapshot('nope')).toEqual({});
  });

  it('commentMentions finds +/@ mentions once each, ignoring bare addresses', () => {
    expect(commentMentions('+alice@example.com please check with @bob@example.co.uk and +alice@example.com'))
      .toEqual(['alice@example.com', 'bob@example.co.uk']);
    expect(commentMentions('mail carol@example.com about it')).toEqual([]);
  });
});
