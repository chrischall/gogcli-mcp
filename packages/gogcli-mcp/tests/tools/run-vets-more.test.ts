import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import * as runner from '../../src/runner.js';
import { registerChatTools, vetChatRun } from '../../src/tools/chat.js';
import { registerDriveTools, vetDriveRun } from '../../src/tools/drive.js';
import { registerClassroomTools, vetClassroomRun } from '../../src/tools/classroom.js';
import { registerCalendarTools, vetCalendarRun } from '../../src/tools/calendar.js';
import { registerGmailTools, vetGmailRun } from '../../src/tools/gmail.js';
import { registerDocsTools, vetDocsRun } from '../../src/tools/docs.js';
import { registerSheetsTools, vetSheetsRun } from '../../src/tools/sheets.js';
import { registerAppScriptTools, vetAppScriptRun } from '../../src/tools/appscript.js';
import { refusedApiCall } from '../../src/tools/api.js';

vi.mock('../../src/runner.js');

// ============================================================================
// The second wave of gates (fleet audit 2026-09-24 SEC-6) is refused by the
// escape hatches under every alias gog 0.41.0 accepts for it, so
// gog_<service>_run is not a way around a prompt the dedicated tool shows.
// ============================================================================

beforeEach(() => vi.clearAllMocks());

describe('vetCalendarRun — move, out-of-office, delete, delete-calendar', () => {
  it.each([
    ['move', 'gog_calendar_move'],
    ['transfer', 'gog_calendar_move'],
    ['out-of-office', 'gog_calendar_out_of_office'],
    ['OOO', 'gog_calendar_out_of_office'],
    ['delete', 'gog_calendar_delete'],
    ['del', 'gog_calendar_delete'],
    ['remove', 'gog_calendar_delete'],
    ['rm', 'gog_calendar_delete'],
    ['delete-calendar', 'gog_calendar_delete_calendar'],
  ])('refuses %s in favour of %s', (sub, tool) => {
    expect(vetCalendarRun(sub, ['primary', 'e1'])).toMatch(new RegExp(`${tool}.*asks the user`));
  });

  it.each(['events', 'freebusy', 'calendars', 'unsubscribe', 'event'])('still allows %s', (sub) => {
    expect(vetCalendarRun(sub, ['primary'])).toBeUndefined();
  });
});

describe('vetClassroomRun — roster, coursework, submissions and course deletes', () => {
  it.each([
    ['students', ['add', 'c1', 'u1'], 'gog_classroom_students_add'],
    ['student', ['create', 'c1', 'u1'], 'gog_classroom_students_add'],
    ['students', ['NEW', 'c1', 'u1'], 'gog_classroom_students_add'],
    ['teachers', ['add', 'c1', 'u1'], 'gog_classroom_teachers_add'],
    ['teacher', ['new', 'c1', 'u1'], 'gog_classroom_teachers_add'],
    ['submissions', ['return', 'c1', 'w1', 's1'], 'gog_classroom_submissions_return'],
    ['submission', ['send', 'c1', 'w1', 's1'], 'gog_classroom_submissions_return'],
    ['coursework', ['create', 'c1', '--title=HW'], 'gog_classroom_coursework_create'],
    ['work', ['add', 'c1'], 'gog_classroom_coursework_create'],
    ['coursework', ['delete', 'c1', 'w1'], 'gog_classroom_coursework_delete'],
    ['work', ['rm', 'c1', 'w1'], 'gog_classroom_coursework_delete'],
    ['courses', ['delete', 'c1'], 'gog_classroom_courses_delete'],
    ['course', ['remove', 'c1'], 'gog_classroom_courses_delete'],
    ['courses', ['--color', 'never', 'del', 'c1'], 'gog_classroom_courses_delete'],
  ])('refuses %s %j in favour of %s', (sub, args, tool) => {
    expect(vetClassroomRun(sub, args)).toMatch(new RegExp(`${tool}.*asks the user`));
  });

  it.each([
    ['students', ['list', 'c1']],
    ['students', ['remove', 'c1', 'u1']],
    ['students', ['delete', 'c1', 'u1']],
    ['teachers', ['remove', 'c1', 'u1']],
    ['submissions', ['grade', 'c1', 'w1', 's1', '--assigned=90']],
    ['submissions', ['list', 'c1', 'w1']],
    ['coursework', ['update', 'c1', 'w1', '--title=x']],
    ['coursework', ['list', 'c1']],
    ['courses', ['create', '--name=x']],
    ['courses', ['archive', 'c1']],
    ['announcements', ['create', 'c1']],
  ])('allows %s %j (or leaves it to the existing vet)', (sub, args) => {
    const refusal = vetClassroomRun(sub, args);
    if (sub === 'announcements') expect(refusal).toMatch(/gog_classroom_announcements_create/);
    else expect(refusal).toBeUndefined();
  });
});

describe('vetDriveRun — comments and permanent deletes', () => {
  it.each([
    ['comments', ['create', 'f1', 'text'], 'gog_drive_comments_add'],
    ['comments', ['add', 'f1', 'text'], 'gog_drive_comments_add'],
    ['comments', ['new', 'f1', 'text'], 'gog_drive_comments_add'],
    ['comments', ['reply', 'f1', 'c1', 'text'], 'gog_drive_comments_reply'],
    ['comments', ['respond', 'f1', 'c1', 'text'], 'gog_drive_comments_reply'],
    ['delete', ['f1', '--permanent'], 'gog_drive_delete'],
    ['del', ['f1', '--permanent=true', '--force'], 'gog_drive_delete'],
    ['rm', ['--PERMANENT', 'f1'], 'gog_drive_delete'],
    ['share', ['f1', '--to=anyone'], 'gog_drive_share'],
  ])('refuses %s %j in favour of %s', (sub, args, tool) => {
    expect(vetDriveRun(sub, args)).toMatch(new RegExp(`${tool}.*asks the user`));
  });

  it.each([
    ['comments', ['list', 'f1']],
    ['comments', ['resolve', 'f1', 'c1']],
    ['comments', ['update', 'f1', 'c1', 'text']],
    ['delete', ['f1']],
    ['delete', ['f1', '--force']],
    ['copy', ['f1']],
  ])('allows %s %j', (sub, args) => {
    expect(vetDriveRun(sub, args)).toBeUndefined();
  });
});

describe('vetChatRun — spaces created with members', () => {
  it.each([
    ['spaces', ['create', 'Launch', '--member=a@example.com']],
    ['spaces', ['add', 'Launch', '--member', 'a@example.com']],
    ['SPACES', ['new', 'Launch', '--members=a@example.com,b@example.com']],
  ])('refuses %s %j', (sub, args) => {
    expect(vetChatRun(sub, args)).toMatch(/gog_chat_spaces_create.*asks the user/);
  });

  it.each([
    ['spaces', ['create', 'Launch']],
    ['spaces', ['list']],
    ['spaces', ['find', 'launch']],
    ['messages', ['list', 'spaces/A']],
    ['threads', ['list', 'spaces/A']],
  ])('allows %s %j', (sub, args) => {
    expect(vetChatRun(sub, args)).toBeUndefined();
  });
});

describe('vetGmailRun — batch delete, send-as aliases, vacation responder', () => {
  it.each([
    ['batch', ['delete', 'm1', 'm2'], 'gog_gmail_batch_delete'],
    ['batch', ['del', 'm1', '--force'], 'gog_gmail_batch_delete'],
    ['batch', ['remove', 'm1'], 'gog_gmail_batch_delete'],
    ['batch', ['rm', 'm1'], 'gog_gmail_batch_delete'],
    ['settings', ['sendas', 'create', 'x@example.com'], 'gog_gmail_sendas_create'],
    ['settings', ['sendas', 'add', 'x@example.com'], 'gog_gmail_sendas_create'],
    ['sendas', ['new', 'x@example.com'], 'gog_gmail_sendas_create'],
    ['settings', ['vacation', 'update', '--enable', '--subject=Away'], 'gog_gmail_vacation_update'],
    ['settings', ['vacation', 'edit', '--enable=true'], 'gog_gmail_vacation_update'],
    ['vacation', ['set', '--enable'], 'gog_gmail_vacation_update'],
  ])('refuses %s %j in favour of %s', (sub, args, tool) => {
    expect(vetGmailRun(sub, args)).toMatch(new RegExp(`${tool}.*asks the user`));
  });

  it.each([
    ['batch', ['modify', 'm1', '--add=Label']],
    ['batch', ['trash', 'm1']],
    ['settings', ['sendas', 'list']],
    ['sendas', ['get', 'x@example.com']],
    ['settings', ['vacation', 'get']],
    ['settings', ['vacation', 'update', '--disable']],
    ['vacation', ['update', '--subject=Away']],
    ['archive', ['m1']],
  ])('allows %s %j', (sub, args) => {
    expect(vetGmailRun(sub, args)).toBeUndefined();
  });

  it('still refuses the settings that route mail elsewhere', () => {
    expect(vetGmailRun('filters', ['create'])).toMatch(/gog_gmail_\*/);
    expect(vetGmailRun('settings', ['forwarding', 'add'])).toMatch(/gog_gmail_\*/);
    expect(vetGmailRun('autoreply', [])).toMatch(/gog_gmail_autoreply/);
  });
});

describe('vetDocsRun — comments', () => {
  it.each([
    ['comments', ['add', 'd1', 'text'], 'gog_docs_comments_add'],
    ['comments', ['create', 'd1', 'text'], 'gog_docs_comments_add'],
    ['comments', ['new', 'd1', 'text'], 'gog_docs_comments_add'],
    ['comments', ['reply', 'd1', 'c1', 'text'], 'gog_docs_comments_reply'],
    ['COMMENTS', ['respond', 'd1', 'c1', 'text'], 'gog_docs_comments_reply'],
  ])('refuses %s %j in favour of %s', (sub, args, tool) => {
    expect(vetDocsRun(sub, args)).toMatch(new RegExp(`${tool}.*asks the user`));
  });

  it.each([
    ['comments', ['list', 'd1']],
    ['comments', ['resolve', 'd1', 'c1']],
    ['copy', ['d1']],
    ['sed', ['d1', 's/a/b/']],
  ])('allows %s %j', (sub, args) => {
    expect(vetDocsRun(sub, args)).toBeUndefined();
  });
});

describe('vetSheetsRun — billed Connected Sheets executions', () => {
  it.each([
    ['datasource', ['add', 'sid', '--billing-project=p'], 'gog_sheets_datasource_add'],
    ['data-source', ['add', 'sid'], 'gog_sheets_datasource_add'],
    ['datasource', ['update', 'sid', 'ds1', '--query=SELECT 1'], 'gog_sheets_datasource_update'],
    ['data-sources', ['update', 'sid', 'ds1'], 'gog_sheets_datasource_update'],
    ['datasource', ['refresh', 'sid', 'ds1'], 'gog_sheets_datasource_refresh'],
    ['connected-sheets', ['REFRESH', 'sid', 'ds1'], 'gog_sheets_datasource_refresh'],
  ])('refuses %s %j in favour of %s', (sub, args, tool) => {
    expect(vetSheetsRun(sub, args)).toMatch(new RegExp(`${tool}.*asks the user`));
  });

  it.each([
    ['datasource', ['list', 'sid']],
    ['datasource', ['describe', 'sid', 'ds1']],
    ['datasource', ['delete', 'sid', 'ds1']],
    ['datasource', ['table', 'read', 'sid', 'A1']],
    ['freeze', ['sid', '--rows=1']],
    ['add-tab', ['sid', 'Data']],
  ])('allows %s %j', (sub, args) => {
    expect(vetSheetsRun(sub, args)).toBeUndefined();
  });
});

describe('vetAppScriptRun — running code', () => {
  it.each(['run', 'RUN'])('refuses %s', (sub) => {
    expect(vetAppScriptRun(sub, ['S1', 'doWork'])).toMatch(/gog_appscript_run_function.*asks the user/);
  });

  it.each(['get', 'content', 'deployments', 'versions', 'create'])('allows %s', (sub) => {
    expect(vetAppScriptRun(sub, ['S1'])).toBeUndefined();
  });
});

describe('the vets are wired into the run tools', () => {
  it.each([
    [registerCalendarTools, 'gog_calendar_run', { subcommand: 'move', args: ['primary', 'e1', 'other', '--send-updates=all'] }],
    [registerClassroomTools, 'gog_classroom_run', { subcommand: 'students', args: ['add', 'c1', 'u1'] }],
    [registerDriveTools, 'gog_drive_run', { subcommand: 'comments', args: ['create', 'f1', 'hi'] }],
    [registerChatTools, 'gog_chat_run', { subcommand: 'spaces', args: ['create', 'Launch', '--member=a@example.com'] }],
    [registerGmailTools, 'gog_gmail_run', { subcommand: 'batch', args: ['delete', 'm1'] }],
    [registerDocsTools, 'gog_docs_run', { subcommand: 'comments', args: ['add', 'd1', 'hi'] }],
    [registerSheetsTools, 'gog_sheets_run', { subcommand: 'datasource', args: ['refresh', 'sid', 'ds1'] }],
    [registerAppScriptTools, 'gog_appscript_run', { subcommand: 'run', args: ['S1', 'doWork'] }],
  ] as const)('%#: %s refuses without spawning gog', async (register, tool, args) => {
    const harness = await createTestHarness(register);
    const result = await harness.callTool(tool, args);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/asks the user to confirm/);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('refusedApiCall — the second wave', () => {
  it.each([
    ['chat', 'spaces.setup', 'gog_chat_spaces_create'],
    ['chat', 'chat.spaces.members.create', 'gog_chat_spaces_create'],
    ['drive', 'comments.create', 'gog_drive_comments_add'],
    ['drive', 'replies.create', 'gog_drive_comments_reply'],
    ['classroom', 'courses.students.create', 'gog_classroom_students_add'],
    ['classroom', 'courses.teachers.create', 'gog_classroom_teachers_add'],
    ['classroom', 'courses.courseWork.create', 'gog_classroom_coursework_create'],
    ['classroom', 'courses.courseWork.studentSubmissions.return', 'gog_classroom_submissions_return'],
    ['calendar', 'events.move', 'gog_calendar_move'],
    ['gmail', 'users.settings.sendAs.create', 'gog_gmail_sendas_create'],
    ['gmail', 'users.settings.updateVacation', 'gog_gmail_vacation_update'],
    ['script', 'scripts.run', 'gog_appscript_run_function'],
  ])('refuses %s %s', (api, method, tool) => {
    expect(refusedApiCall(api, method)).toContain(tool);
  });

  it.each([
    ['chat', 'spaces.members.list'],
    ['drive', 'comments.list'],
    ['classroom', 'courses.students.list'],
    ['classroom', 'courses.courseWork.studentSubmissions.patch'],
    ['gmail', 'users.settings.getVacation'],
    ['gmail', 'users.settings.sendAs.list'],
    ['script', 'projects.get'],
  ])('allows %s %s', (api, method) => {
    expect(refusedApiCall(api, method)).toBeUndefined();
  });
});
