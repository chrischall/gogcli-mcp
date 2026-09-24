import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerExtraClassroomTools } from '../../src/tools/classroom-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult } from '@chrischall/mcp-utils';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import { pos } from '../../../gogcli-mcp/src/argv.js';
import { resetConfirmTokenState } from '../../../gogcli-mcp/src/send-confirm-token.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return { ...actual, runOrDiagnose: vi.fn() };
});

// ============================================================================
// Fleet audit 2026-09-24 SEC-6: roster adds grant access to a class, coursework
// is announced to it, and the deletes destroy submissions for good — each asks
// first, naming the class (and coursework) rather than an opaque id.
// ============================================================================

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_CONFIRM_MODE;
  resetConfirmTokenState();
});
afterEach(() => { process.env = ORIGINAL_ENV; });

const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);
async function prompted(answer: ElicitResult = { action: 'accept', content: { confirmed: true } }) {
  const seen: ElicitRequest[] = [];
  const harness = await createTestHarness(registerExtraClassroomTools, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const unprompted = () => createTestHarness(registerExtraClassroomTools);

const COURSE = JSON.stringify({ course: { id: 'c1', name: 'Algebra II', section: 'Period 3' } });
const WORK = JSON.stringify({ coursework: { id: 'w1', title: 'HW 3' } });
const COURSE_VIEW = { id: 'c1', name: 'Algebra II', section: 'Period 3' };

function stub(failing?: string) {
  vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
    const key = args.filter((a): a is string => typeof a === 'string' && !a.startsWith('--')).join(' ');
    if (failing && key.startsWith(failing)) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
    if (key.startsWith('classroom courses get')) return rawTextResult(COURSE);
    if (key.startsWith('classroom coursework get')) return rawTextResult(WORK);
    return rawTextResult('{"ok":true}');
  });
}
const callsTo = (...words: string[]) => vi.mocked(lib.runOrDiagnose).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));

type Case = {
  tool: string;
  args: Record<string, unknown>;
  action: string;
  details: Record<string, unknown>;
  write: string[];
  argv: unknown[];
  note: RegExp;
  reads: string[];
  changed: Record<string, unknown>;
};

const CASES: Case[] = [
  {
    tool: 'gog_classroom_students_add',
    args: { courseId: 'c1', userId: 'kid@example.com' },
    action: 'classroom.student-add',
    details: { course: COURSE_VIEW, student: 'kid@example.com' },
    write: ['classroom', 'students', 'add'],
    argv: ['classroom', 'students', 'add', pos('c1'), pos('kid@example.com')],
    note: /gog_classroom_invitations_create/,
    reads: ['classroom courses get'],
    changed: { userId: 'other@example.com' },
  },
  {
    tool: 'gog_classroom_teachers_add',
    args: { courseId: 'c1', userId: 'co@example.com' },
    action: 'classroom.teacher-add',
    details: { course: COURSE_VIEW, teacher: 'co@example.com', grants: "teacher access: every student's work, grades and roster" },
    write: ['classroom', 'teachers', 'add'],
    argv: ['classroom', 'teachers', 'add', pos('c1'), pos('co@example.com')],
    note: /invitations_create/,
    reads: ['classroom courses get'],
    changed: { userId: 'other@example.com' },
  },
  {
    tool: 'gog_classroom_courses_delete',
    args: { courseId: 'c1' },
    action: 'classroom.course-delete',
    details: { course: COURSE_VIEW, deletes: 'the course with all of its coursework, submissions and grades, for good' },
    write: ['classroom', 'courses', 'delete'],
    argv: ['classroom', 'courses', 'delete', pos('c1'), '--force'],
    note: /gog_classroom_courses_archive/,
    reads: ['classroom courses get'],
    changed: { courseId: 'c2' },
  },
  {
    tool: 'gog_classroom_coursework_delete',
    args: { courseId: 'c1', courseworkId: 'w1' },
    action: 'classroom.coursework-delete',
    details: { course: COURSE_VIEW, coursework: { id: 'w1', title: 'HW 3' }, deletes: 'the coursework and every student submission to it, for good' },
    write: ['classroom', 'coursework', 'delete'],
    argv: ['classroom', 'coursework', 'delete', pos('c1'), pos('w1'), '--force'],
    note: /delete it from Classroom/,
    reads: ['classroom courses get', 'classroom coursework get'],
    changed: { courseworkId: 'w2' },
  },
  {
    tool: 'gog_classroom_coursework_create',
    args: { courseId: 'c1', title: 'HW 4', description: 'Chapter 5, all odd problems', dueDate: '2026-10-01', dueTime: '09:00', maxPoints: 10 },
    action: 'classroom.coursework-create',
    details: {
      course: COURSE_VIEW, title: 'HW 4', type: 'ASSIGNMENT', publishes: 'immediately', due: '2026-10-01 09:00',
      maxPoints: 10, descriptionPreview: 'Chapter 5, all odd problems',
    },
    write: ['classroom', 'coursework', 'create'],
    argv: ['classroom', 'coursework', 'create', pos('c1'), '--title=HW 4', '--description=Chapter 5, all odd problems',
      '--max-points=10', '--due-date=2026-10-01', '--due-time=09:00'],
    note: /state DRAFT/,
    reads: ['classroom courses get'],
    changed: { description: 'Chapter 6' },
  },
];

describe.each(CASES)('$tool', (c) => {
  it('reads what it acts on and asks, naming it; acts once accepted', async () => {
    stub();
    const { harness, details } = await prompted();
    await harness.callTool(c.tool, c.args);
    expect(details()).toEqual(c.details);
    expect(callsTo(...c.write).map(([args]) => args)).toEqual([c.argv]);
  });

  it('does nothing when the user declines', async () => {
    stub();
    const { harness } = await prompted({ action: 'decline' });
    expect(json(await harness.callTool(c.tool, c.args))).toMatchObject({ cancelled: true, action: c.action });
    expect(callsTo(...c.write)).toHaveLength(0);
  });

  it.each(c.reads)('returns a failed read (%s) without asking or acting', async (failing) => {
    stub(failing);
    const { harness, seen } = await prompted();
    expect((await harness.callTool(c.tool, c.args)).isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(callsTo(...c.write)).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted, with a way through', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stub();
    const r = json(await (await unprompted()).callTool(c.tool, c.args));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: c.action });
    expect(r.note).toMatch(c.note);
    expect(callsTo(...c.write)).toHaveLength(0);
  });

  it('token fallback: previews in full, refuses changed arguments, acts on phase 2', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub();
    const harness = await unprompted();
    const p1 = json(await harness.callTool(c.tool, c.args));
    expect(p1.status).toBe('confirmation-required');
    expect(p1.preview.course).toEqual(COURSE_VIEW);
    expect(json(await harness.callTool(c.tool, { ...c.args, ...c.changed, confirmToken: p1.confirmToken })))
      .toMatchObject({ error: expect.stringMatching(/DRAFT_CHANGED|TOKEN_INVALID/) });
    await harness.callTool(c.tool, { ...c.args, confirmToken: p1.confirmToken });
    expect(callsTo(...c.write)).toHaveLength(1);
  });
});

describe('the paths that reach nobody stay unprompted', () => {
  it('enrolling yourself with a code', async () => {
    stub();
    const { harness, seen } = await prompted();
    await harness.callTool('gog_classroom_students_add', { courseId: 'c1', userId: 'ME', enrollmentCode: 'abc123' });
    expect(seen).toHaveLength(0);
    expect(callsTo('classroom', 'courses', 'get')).toHaveLength(0);
    expect(callsTo('classroom', 'students', 'add')[0]![0]).toEqual(
      ['classroom', 'students', 'add', pos('c1'), pos('ME'), '--enrollment-code=abc123']);
  });

  it('a DRAFT coursework item', async () => {
    stub();
    const { harness, seen } = await prompted();
    await harness.callTool('gog_classroom_coursework_create', { courseId: 'c1', title: 'HW 4', state: 'DRAFT' });
    expect(seen).toHaveLength(0);
    expect(callsTo('classroom', 'coursework', 'create')).toHaveLength(1);
  });

  it('a scheduled coursework item says when it publishes, and a combined due passes through', async () => {
    stub();
    const { harness, details } = await prompted({ action: 'decline' });
    await harness.callTool('gog_classroom_coursework_create', { courseId: 'c1', title: 'Quiz', type: 'SHORT_ANSWER_QUESTION', due: '2026-10-02T09:00', scheduled: '2026-10-01T08:00' });
    expect(details()).toEqual({ course: COURSE_VIEW, title: 'Quiz', type: 'SHORT_ANSWER_QUESTION', publishes: 'at 2026-10-01T08:00', due: '2026-10-02T09:00' });
  });
});
