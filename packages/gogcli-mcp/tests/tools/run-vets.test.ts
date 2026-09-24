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

  it.each(['permissions', 'unshare', 'copy'])('allows %s', (sub) => {
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

  it.each([
    ['announcements', ['list', 'c1']],
    ['invitations', ['accept', 'i1']],
    ['guardians', ['create', 'c1']],
    ['courses', ['create']],
  ])('allows %s %j', (sub, args) => {
    expect(vetClassroomRun(sub, args)).toBeUndefined();
  });
});

describe('vetCalendarRun', () => {
  it.each(['create', 'add', 'new', 'update', 'edit', 'set', 'respond', 'rsvp', 'reply', 'Create'])('refuses %s', (sub) => {
    expect(vetCalendarRun(sub, ['primary'])).toMatch(/gog_calendar_(create|update|respond).*asks the user/);
  });

  it.each(['events', 'freebusy', 'calendars', 'create-calendar', 'focus-time'])('allows %s', (sub) => {
    expect(vetCalendarRun(sub, [])).toBeUndefined();
  });
});

describe('the vets are wired into the run tools', () => {
  it.each([
    [registerChatTools, 'gog_chat_run', { subcommand: 'messages', args: ['send', 'spaces/A', '--text=hi'] }],
    [registerDriveTools, 'gog_drive_run', { subcommand: 'share', args: ['f1', '--to=anyone'] }],
    [registerClassroomTools, 'gog_classroom_run', { subcommand: 'ann', args: ['create', 'c1', '--text=x'] }],
    [registerCalendarTools, 'gog_calendar_run', { subcommand: 'rsvp', args: ['primary', 'e1', '--status=accepted'] }],
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

  it.each([
    ['chat', 'spaces.messages.list'],
    ['drive', 'permissions.list'],
    ['drive', 'permissions.delete'],
    ['classroom', 'courses.announcements.list'],
    ['calendar', 'events.list'],
    ['calendar', 'events.delete'],
    ['sheets', 'spreadsheets.values.update'],
  ])('allows %s %s', (api, method) => {
    expect(refusedApiCall(api, method)).toBeUndefined();
  });

  it('still refuses Gmail sends', () => {
    expect(refusedApiCall('gmail', 'users.messages.send')).toMatch(/gog_gmail_send/);
  });
});
