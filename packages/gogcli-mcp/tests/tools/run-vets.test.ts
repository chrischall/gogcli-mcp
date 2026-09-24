import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import * as runner from '../../src/runner.js';
import { registerChatTools, vetChatRun } from '../../src/tools/chat.js';
import { registerDriveTools, vetDriveRun } from '../../src/tools/drive.js';
import { registerClassroomTools, vetClassroomRun } from '../../src/tools/classroom.js';
import { registerCalendarTools, vetCalendarRun } from '../../src/tools/calendar.js';
import { refusedApiCall } from '../../src/tools/api.js';

vi.mock('../../src/runner.js');

// ============================================================================
// The escape hatches must not be a way around the dispatch rail (#400): every
// action a dedicated tool asks the user about is refused by gog_<service>_run
// and gog_api_call, under every alias gog accepts for it.
// ============================================================================

beforeEach(() => vi.clearAllMocks());

describe('vetChatRun', () => {
  it.each([
    ['messages', ['send', 'spaces/A', '--text=hi']],
    ['messages', ['create', 'spaces/A']],
    ['messages', ['post', 'spaces/A']],
    ['dm', ['send', 'a@example.com']],
    ['DM', ['--color', 'never', 'POST', 'a@example.com']],
  ])('refuses %s %j', (sub, args) => {
    expect(vetChatRun(sub, args)).toMatch(/gog_chat_(messages|dm)_send.*asks the user/);
  });

  it.each([
    ['messages', ['list', 'spaces/A']],
    ['messages', ['react', 'spaces/A/messages/B', '--emoji=👍']],
    ['dm', ['space', 'a@example.com']],
    ['spaces', ['send']],
    ['messages', ['search', '--query=send']],
  ])('allows %s %j', (sub, args) => {
    expect(vetChatRun(sub, args)).toBeUndefined();
  });
});

describe('vetDriveRun', () => {
  it.each(['share', 'SHARE'])('refuses %s', (sub) => {
    expect(vetDriveRun(sub, ['f1', '--to=anyone'])).toMatch(/gog_drive_share.*asks the user/);
  });

  // SEC-1 (fleet-audit #930): `drive bulk update-role --from=reader --to=writer`
  // rewrites every matching permission across a tree with no positional path,
  // so neither the share vet nor the path guard saw it.
  it.each([
    ['bulk', ['update-role', '--from=reader', '--to=writer', '--depth=0', '--force']],
    ['BULK', ['remove-public', '--parent=folder1']],
    ['bulk', []],
  ])('refuses %s %j', (sub, args) => {
    const refusal = vetDriveRun(sub, args);
    expect(refusal).toMatch(/gog drive bulk/);
    expect(refusal).toMatch(/every matching file/);
    expect(refusal).toMatch(/gog_drive_share/);
  });

  // `unshare` removes a collaborator's access with no preview of who: route it
  // through the dedicated tool, whose call the host shows structured.
  it('refuses unshare in favour of gog_drive_unshare', () => {
    const refusal = vetDriveRun('Unshare', ['f1', 'p1']);
    expect(refusal).toMatch(/not available through gog_drive_run/);
    expect(refusal).toMatch(/gog_drive_unshare/);
  });

  // `permissions <fileId>` only lists (gog 0.41.0 has no mutating form).
  it.each(['permissions', 'copy'])('allows %s', (sub) => {
    expect(vetDriveRun(sub, ['f1'])).toBeUndefined();
  });
});

describe('vetClassroomRun', () => {
  it.each([
    ['announcements', ['create', 'c1', '--text=x']],
    ['announcement', ['add', 'c1']],
    ['ann', ['new', 'c1']],
    ['invitations', ['create', 'c1', 'u1']],
    ['invitation', ['add', 'c1', 'u1']],
    ['invites', ['NEW', 'c1', 'u1']],
  ])('refuses %s %j', (sub, args) => {
    expect(vetClassroomRun(sub, args)).toMatch(/gog_classroom_(announcements|invitations)_create.*asks the user/);
  });

  // SEC-3 (fleet-audit #932): create-as-DRAFT then update-to-PUBLISHED was the
  // same two-step around the create gate that closed for Gmail drafts.
  it.each([
    ['announcements', ['update', 'c1', 'a1', '--state=PUBLISHED']],
    ['announcement', ['edit', 'c1', 'a1', '--state', 'published']],
    ['ann', ['SET', 'c1', 'a1', '--scheduled=2026-10-01T12:00:00Z']],
    ['ann', ['set', 'c1', 'a1', '--state=DRAFT', '--scheduled=2026-10-01T12:00:00Z']],
  ])('refuses publishing an announcement via %s %j', (sub, args) => {
    expect(vetClassroomRun(sub, args)).toMatch(/gog_classroom_announcements_update.*asks the user/);
  });

  it.each([
    ['coursework', ['update', 'c1', 'w1', '--state=PUBLISHED']],
    ['work', ['edit', 'c1', 'w1', '--scheduled=2026-10-01T12:00:00Z']],
  ])('refuses publishing coursework via %s %j', (sub, args) => {
    expect(vetClassroomRun(sub, args)).toMatch(/gog_classroom_coursework_update.*asks the user/);
  });

  it.each([
    ['coursework', ['create', 'c1', '--title=HW'], /gog_classroom_coursework_create/],
    ['work', ['add', 'c1', '--title=HW', '--state=PUBLISHED'], /gog_classroom_coursework_create/],
    ['coursework', ['new', 'c1', '--title=HW', '--state=DRAFT', '--scheduled=2026-10-01T12:00:00Z'], /gog_classroom_coursework_create/],
    ['materials', ['create', 'c1', '--title=Notes'], /--state=DRAFT/],
    ['material', ['add', 'c1', '--title=Notes', '--state=DRAFT', '--scheduled=2026-10-01T12:00:00Z'], /--state=DRAFT/],
    ['students', ['add', 'c1', 'u1'], /gog_classroom_students_add/],
    ['student', ['create', 'c1', 'u1'], /gog_classroom_students_add/],
    ['teachers', ['new', 'c1', 'u1'], /gog_classroom_teachers_add/],
    ['teacher', ['add', 'c1', 'u1'], /gog_classroom_teachers_add/],
    ['submissions', ['return', 'c1', 'w1', 's1'], /gog_classroom_submissions_return/],
    ['submission', ['send', 'c1', 'w1', 's1'], /gog_classroom_submissions_return/],
    ['guardian-invitations', ['create', 'student1', '--email=parent@example.com'], /from Classroom/],
    ['guardian-invites', ['add', 'student1', '--email=parent@example.com'], /from Classroom/],
  ])('refuses %s %j', (sub, args, instead) => {
    const refusal = vetClassroomRun(sub, args);
    expect(refusal).toMatch(/not available through gog_classroom_run/);
    expect(refusal).toMatch(instead);
  });

  it.each([
    ['announcements', ['list', 'c1']],
    ['announcements', ['update', 'c1', 'a1', '--text=fixed typo']],
    ['announcements', ['update', 'c1', 'a1', '--state=DRAFT']],
    ['coursework', ['update', 'c1', 'w1', '--title=Renamed']],
    ['coursework', ['create', 'c1', '--title=HW', '--state=DRAFT']],
    ['materials', ['create', 'c1', '--title=Notes', '--state=draft']],
    ['materials', ['list', 'c1']],
    ['students', ['list', 'c1']],
    ['students', ['remove', 'c1', 'u1', '--force']],
    ['teachers', ['get', 'c1', 'u1']],
    ['submissions', ['grade', 'c1', 'w1', 's1', '--draft=90']],
    ['submissions', ['turn-in', 'c1', 'w1', 's1']],
    ['guardian-invitations', ['list', 'student1']],
    ['guardians', ['create', 'c1']],
    ['invitations', ['accept', 'i1']],
    ['courses', ['create']],
  ])('allows %s %j', (sub, args) => {
    expect(vetClassroomRun(sub, args)).toBeUndefined();
  });
});

describe('vetCalendarRun', () => {
  it.each(['create', 'add', 'new', 'update', 'edit', 'set', 'respond', 'rsvp', 'reply', 'Create'])('refuses %s', (sub) => {
    expect(vetCalendarRun(sub, ['primary'])).toMatch(/gog_calendar_(create|update|respond).*asks the user/);
  });

  // SEC-4 (fleet-audit #933): `propose-time --decline` (and --comment, which
  // implies it) declines the event and notifies the organizer, exactly what
  // gog_calendar_respond asks about.
  it.each([
    ['propose-time', ['primary', 'e1', '--decline']],
    ['PROPOSE-TIME', ['primary', 'e1', '--decline=true']],
    ['propose-time', ['primary', 'e1', '--comment=Can we do Tuesday?']],
    ['propose-time', ['primary', 'e1', '--comment', 'Tuesday?']],
  ])('refuses %s %j', (sub, args) => {
    expect(vetCalendarRun(sub, args)).toMatch(/gog_calendar_respond.*asks the user/);
  });

  it('allows propose-time when it only generates the URL', () => {
    expect(vetCalendarRun('propose-time', ['primary', 'e1'])).toBeUndefined();
  });

  // The run tool cannot see an event's guests, so the rest of the guest-visible
  // subcommands are refused outright in favour of their dedicated tools.
  it.each([
    ['move', ['primary', 'e1', 'other'], /gog_calendar_move/],
    ['transfer', ['primary', 'e1', 'other', '--send-updates=none'], /gog_calendar_move/],
    ['delete', ['primary', 'e1', '--force'], /gog_calendar_delete\b/],
    ['del', ['primary', 'e1'], /gog_calendar_delete\b/],
    ['rm', ['primary', 'e1'], /gog_calendar_delete\b/],
    ['remove', ['primary', 'e1'], /gog_calendar_delete\b/],
    ['delete-calendar', ['cal1'], /gog_calendar_delete_calendar/],
    ['out-of-office', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-02T09:00:00Z'], /gog_calendar_out_of_office/],
    ['ooo', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-02T09:00:00Z', '--auto-decline=none'], /gog_calendar_out_of_office/],
    ['focus-time', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-01T10:00:00Z'], /--auto-decline=none/],
    ['focus', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-01T10:00:00Z', '--auto-decline=all'], /--auto-decline=none/],
    ['Focus-Time', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-01T10:00:00Z', '--auto-decline', 'new'], /--auto-decline=none/],
  ])('refuses %s %j', (sub, args, instead) => {
    const refusal = vetCalendarRun(sub, args);
    expect(refusal).toMatch(/not available through gog_calendar_run/);
    expect(refusal).toMatch(instead);
  });

  it('allows a focus-time block that declines nobody', () => {
    expect(vetCalendarRun('focus-time', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-01T10:00:00Z', '--auto-decline=none'])).toBeUndefined();
    expect(vetCalendarRun('focus', ['--from=2026-10-01T09:00:00Z', '--to=2026-10-01T10:00:00Z', '--auto-decline', 'none'])).toBeUndefined();
  });

  it.each(['events', 'freebusy', 'calendars', 'create-calendar', 'working-location', 'unsubscribe'])('allows %s', (sub) => {
    expect(vetCalendarRun(sub, [])).toBeUndefined();
  });
});

describe('the vets are wired into the run tools', () => {
  it.each([
    [registerChatTools, 'gog_chat_run', { subcommand: 'messages', args: ['send', 'spaces/A', '--text=hi'] }],
    [registerDriveTools, 'gog_drive_run', { subcommand: 'share', args: ['f1', '--to=anyone'] }],
    [registerDriveTools, 'gog_drive_run', { subcommand: 'bulk', args: ['update-role', '--from=reader', '--to=writer', '--depth=0', '--force'] }],
    [registerClassroomTools, 'gog_classroom_run', { subcommand: 'ann', args: ['create', 'c1', '--text=x'] }],
    [registerClassroomTools, 'gog_classroom_run', { subcommand: 'announcements', args: ['update', 'c1', 'a1', '--state=PUBLISHED'] }],
    [registerCalendarTools, 'gog_calendar_run', { subcommand: 'rsvp', args: ['primary', 'e1', '--status=accepted'] }],
    [registerCalendarTools, 'gog_calendar_run', { subcommand: 'propose-time', args: ['primary', 'e1', '--decline'] }],
  ] as const)('%#: %s refuses without spawning gog', async (register, tool, args) => {
    const harness = await createTestHarness(register);
    const result = await harness.callTool(tool, args);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/asks the user to confirm/);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('refusedApiCall — the dispatch rail\'s other escape hatch', () => {
  it.each([
    ['chat', 'spaces.messages.create', 'gog_chat_messages_send'],
    ['chat', 'chat.spaces.messages.create', 'gog_chat_messages_send'],
    ['drive', 'permissions.create', 'gog_drive_share'],
    ['drive', 'permissions.update', 'gog_drive_share'],
    ['classroom', 'courses.announcements.create', 'gog_classroom_announcements_create'],
    ['classroom', 'invitations.create', 'gog_classroom_invitations_create'],
    ['calendar', 'events.insert', 'gog_calendar_create'],
    ['Calendar', ' events.patch ', 'gog_calendar_update'],
    ['calendar', 'events.update', 'gog_calendar_update'],
    ['calendar', 'events.import', 'gog_calendar_create'],
    ['calendar', 'events.quickAdd', 'gog_calendar_create'],
  ])('refuses %s %s', (api, method, tool) => {
    expect(refusedApiCall(api, method)).toContain(tool);
  });

  // Not refused OUTRIGHT — but not waved through either. Every write here goes
  // through gog_api_call's generic confirmation (SEC-2, fleet-audit #931; see
  // tests/tools/api.test.ts), which asks about the exact method and payload.
  // The hard refusals above are only for actions a dedicated tool already
  // gates with a better preview.
  it.each([
    ['chat', 'spaces.messages.list'],
    ['drive', 'permissions.list'],
    ['drive', 'permissions.delete'],
    ['classroom', 'courses.announcements.list'],
    ['calendar', 'events.list'],
    ['calendar', 'events.delete'],
    ['sheets', 'spreadsheets.values.update'],
  ])('leaves %s %s to the generic write gate', (api, method) => {
    expect(refusedApiCall(api, method)).toBeUndefined();
  });

  it('still refuses Gmail sends', () => {
    expect(refusedApiCall('gmail', 'users.messages.send')).toMatch(/gog_gmail_send/);
  });
});
