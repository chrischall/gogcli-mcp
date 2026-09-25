import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerExtraClassroomTools } from '../../src/tools/classroom-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult } from '@chrischall/mcp-utils';
import { pos } from '../../../gogcli-mcp/src/argv.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

let harness: TestHarness;

// MCP_CONFIRM_MODE is read per call; a test that sets it must not leak it.
afterEach(() => { delete process.env.MCP_CONFIRM_MODE; });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(rawTextResult('{}'));
  harness = await createTestHarness(registerExtraClassroomTools, {
    elicitation: async () => ({ action: 'accept', content: { confirmed: true } }),
  });
});

describe('gog_classroom_courses_create', () => {
  it('calls runOrDiagnose with required name only', async () => {
    await harness.callTool('gog_classroom_courses_create', { name: 'Math 101' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'courses', 'create', '--name=Math 101'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    await harness.callTool('gog_classroom_courses_create', {
      name: 'Math 101',
      owner: 'me',
      section: 'Section A',
      descriptionHeading: 'Welcome',
      description: 'Algebra',
      room: 'R101',
      state: 'ACTIVE',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'courses', 'create', '--name=Math 101', '--owner=me', '--section=Section A', '--description-heading=Welcome', '--description=Algebra', '--room=R101', '--state=ACTIVE'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_courses_update', () => {
  it('calls runOrDiagnose with courseId only', async () => {
    await harness.callTool('gog_classroom_courses_update', { courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'update', pos('c1')], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await harness.callTool('gog_classroom_courses_update', {
      courseId: 'c1',
      name: 'New Name',
      owner: 'me',
      section: 'B',
      descriptionHeading: 'Heading',
      description: 'Desc',
      room: 'R2',
      state: 'ARCHIVED',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'courses', 'update', pos('c1'), '--name=New Name', '--owner=me', '--section=B', '--description-heading=Heading', '--description=Desc', '--room=R2', '--state=ARCHIVED'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_courses_delete', () => {
  it('calls runOrDiagnose with courseId', async () => {
    await harness.callTool('gog_classroom_courses_delete', { courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'delete', pos('c1'), '--force'], { account: undefined });
  });
});

describe('gog_classroom_courses_archive', () => {
  it('calls runOrDiagnose with courseId', async () => {
    await harness.callTool('gog_classroom_courses_archive', { courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'archive', pos('c1')], { account: undefined });
  });
});

describe('gog_classroom_courses_unarchive', () => {
  it('calls runOrDiagnose with courseId', async () => {
    await harness.callTool('gog_classroom_courses_unarchive', { courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'unarchive', pos('c1')], { account: undefined });
  });
});

describe('gog_classroom_students_add', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await harness.callTool('gog_classroom_students_add', { courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'students', 'add', pos('c1'), pos('u1')], { account: undefined });
  });

  it('passes --enrollment-code when provided', async () => {
    await harness.callTool('gog_classroom_students_add', { courseId: 'c1', userId: 'u1', enrollmentCode: 'abc123' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'students', 'add', pos('c1'), pos('u1'), '--enrollment-code=abc123'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_students_remove', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await harness.callTool('gog_classroom_students_remove', { courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'students', 'remove', pos('c1'), pos('u1'), '--force'], { account: undefined });
  });
});

describe('gog_classroom_teachers_add', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await harness.callTool('gog_classroom_teachers_add', { courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'teachers', 'add', pos('c1'), pos('u1')], { account: undefined });
  });
});

describe('gog_classroom_teachers_remove', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await harness.callTool('gog_classroom_teachers_remove', { courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'teachers', 'remove', pos('c1'), pos('u1'), '--force'], { account: undefined });
  });
});

describe('gog_classroom_coursework_create', () => {
  it('calls runOrDiagnose with required title only', async () => {
    await harness.callTool('gog_classroom_coursework_create', { courseId: 'c1', title: 'HW1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'create', pos('c1'), '--title=HW1'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    await harness.callTool('gog_classroom_coursework_create', {
      courseId: 'c1',
      title: 'HW1',
      description: 'Chapter 1',
      type: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 100,
      due: '2026-05-01T23:59',
      dueDate: '2026-05-01',
      dueTime: '23:59',
      scheduled: '2026-04-30T12:00',
      topic: 't1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'create', pos('c1'), '--title=HW1', '--description=Chapter 1', '--type=ASSIGNMENT', '--state=PUBLISHED', '--max-points=100', '--due=2026-05-01T23:59', '--due-date=2026-05-01', '--due-time=23:59', '--scheduled=2026-04-30T12:00', '--topic=t1'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_coursework_update', () => {
  it('calls runOrDiagnose with ids only', async () => {
    await harness.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'coursework', 'update', pos('c1'), pos('w1')], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await harness.callTool('gog_classroom_coursework_update', {
      courseId: 'c1',
      courseworkId: 'w1',
      title: 'New Title',
      description: 'Desc',
      type: 'SHORT_ANSWER_QUESTION',
      state: 'DRAFT',
      maxPoints: 50,
      due: '2026-05-01T23:59',
      dueDate: '2026-05-01',
      dueTime: '23:59',
      scheduled: '2026-04-30T12:00',
      topic: 't1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'update', pos('c1'), pos('w1'), '--title=New Title', '--description=Desc', '--type=SHORT_ANSWER_QUESTION', '--state=DRAFT', '--max-points=50', '--due=2026-05-01T23:59', '--due-date=2026-05-01', '--due-time=23:59', '--scheduled=2026-04-30T12:00', '--topic=t1'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_coursework_delete', () => {
  it('calls runOrDiagnose with ids', async () => {
    await harness.callTool('gog_classroom_coursework_delete', { courseId: 'c1', courseworkId: 'w1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'coursework', 'delete', pos('c1'), pos('w1'), '--force'], { account: undefined });
  });
});

describe('gog_classroom_announcements_update', () => {
  it('calls runOrDiagnose with ids only', async () => {
    await harness.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'announcements', 'update', pos('c1'), pos('a1')], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await harness.callTool('gog_classroom_announcements_update', {
      courseId: 'c1',
      announcementId: 'a1',
      text: 'edited',
      state: 'PUBLISHED',
      scheduled: '2026-05-01T12:00',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'update', pos('c1'), pos('a1'), '--text=edited', '--state=PUBLISHED', '--scheduled=2026-05-01T12:00'],
      { account: undefined },
    );
  });
});

// ============================================================================
// SEC-3 (fleet-audit #932): create-as-DRAFT then update-to-PUBLISHED was the
// same two-step around the create gate that closed for Gmail drafts. Publishing
// (state PUBLISHED, or a schedule) through update now reads the course and the
// item and asks, exactly as announcements_create does.
// ============================================================================

const COURSE_JSON = JSON.stringify({ course: { id: 'c1', name: 'Algebra II', section: 'Period 3' } });
const ANNOUNCEMENT_JSON = JSON.stringify({ announcement: { id: 'a1', text: 'Homework is due Friday', state: 'DRAFT', updateTime: '2026-09-20T10:00:00Z' } });
// gog 0.41.0 nests coursework under `coursework` (not the API's `courseWork`).
const COURSEWORK_JSON = JSON.stringify({ coursework: { id: 'w1', title: 'Chapter 4 problem set', description: 'Problems 1-20, show your work', state: 'DRAFT', updateTime: '2026-09-21T10:00:00Z' } });

/** Answer reads with `reads[<joined command words>]`, everything else with `{}`. */
function stubReads(reads: Record<string, string>) {
  vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
    const key = (args as unknown[]).map((a) => (typeof a === 'string' ? a : (a as { value: string }).value)).filter((a) => !a.startsWith('--')).join(' ');
    for (const [prefix, out] of Object.entries(reads)) if (key.startsWith(prefix)) return rawTextResult(out);
    return rawTextResult('{"ok":true}');
  });
}

const calls = (...words: string[]) => vi.mocked(lib.runOrDiagnose).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));
const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);

async function prompted(answer: { action: 'accept' | 'decline'; content?: { confirmed: boolean } } = { action: 'accept', content: { confirmed: true } }) {
  const messages: string[] = [];
  const h = await createTestHarness(registerExtraClassroomTools, {
    elicitation: async (r) => { messages.push(r.params.message); return answer; },
  });
  const details = () => JSON.parse(messages[0]!.split('\n').slice(1).join('\n')).details;
  return { h, messages, details };
}

describe('gog_classroom_announcements_update — publishing asks', () => {
  beforeEach(() => stubReads({ 'classroom courses get': COURSE_JSON, 'classroom announcements get': ANNOUNCEMENT_JSON }));

  it('reads the course and the announcement, prompts with the class and the CURRENT text, then publishes once accepted', async () => {
    const { h, details, messages } = await prompted();
    await h.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1', state: 'PUBLISHED' });
    expect(messages[0]).toMatch(/publish/i);
    expect(details()).toEqual({
      course: { id: 'c1', name: 'Algebra II', section: 'Period 3' },
      announcement: { id: 'a1', state: 'DRAFT' },
      publishes: 'immediately',
      textPreview: 'Homework is due Friday',
    });
    // Read before asking (the elicitation round-trip re-runs the handler, so
    // the reads repeat); the write happens exactly once, after acceptance.
    expect(calls('classroom', 'courses', 'get').length).toBeGreaterThanOrEqual(1);
    expect(calls('classroom', 'announcements', 'get').length).toBeGreaterThanOrEqual(1);
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(1);
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'update', pos('c1'), pos('a1'), '--state=PUBLISHED'], { account: undefined });
  });

  it('previews the NEW text when the same call replaces it, and a schedule as when it publishes', async () => {
    const { h, details } = await prompted({ action: 'decline' });
    await h.callTool('gog_classroom_announcements_update', {
      courseId: 'c1', announcementId: 'a1', text: 'Homework is due Monday', state: 'DRAFT', scheduled: '2026-10-01T12:00:00Z', account: 't@example.com',
    });
    expect(details()).toMatchObject({ publishes: 'at 2026-10-01T12:00:00Z', textPreview: 'Homework is due Monday' });
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(0);
  });

  it('previews the CURRENT text when text is empty (gog keeps it: an empty --text is never sent)', async () => {
    const { h, details } = await prompted({ action: 'decline' });
    await h.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1', text: '', state: 'PUBLISHED' });
    expect(details()).toMatchObject({ textPreview: 'Homework is due Friday' });
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(0);
  });

  it.each([
    ['a text edit', { text: 'fixed typo' }],
    ['unpublishing back to DRAFT', { state: 'DRAFT' as const }],
  ])('does not ask for %s (nobody new sees it)', async (_label, extra) => {
    const { h, messages } = await prompted();
    await h.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1', ...extra });
    expect(messages).toHaveLength(0);
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(1);
  });

  it('publishes nothing when the user declines', async () => {
    const { h } = await prompted({ action: 'decline' });
    const r = json(await h.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1', state: 'PUBLISHED' }));
    expect(r).toMatchObject({ confirmed: false, cancelled: true, action: 'classroom.announcement-publish' });
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted under MCP_CONFIRM_MODE=refuse, naming the way through', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const h = await createTestHarness(registerExtraClassroomTools);
    const r = json(await h.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1', state: 'PUBLISHED' }));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'classroom.announcement-publish' });
    expect(r.note).toMatch(/DRAFT/);
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(0);
  });

  it('token fallback: previews, binds the announcement revision, publishes on phase 2', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    const h = await createTestHarness(registerExtraClassroomTools);
    const args = { courseId: 'c1', announcementId: 'a1', state: 'PUBLISHED' as const };
    const p1 = json(await h.callTool('gog_classroom_announcements_update', args));
    expect(p1).toMatchObject({
      status: 'confirmation-required',
      preview: { course: { id: 'c1', name: 'Algebra II', section: 'Period 3' }, announcement: { id: 'a1', state: 'DRAFT' }, publishes: 'immediately', textPreview: 'Homework is due Friday' },
    });
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(0);
    // The teacher edits the draft between the phases: the approval no longer names this text.
    stubReads({ 'classroom courses get': COURSE_JSON, 'classroom announcements get': ANNOUNCEMENT_JSON.replace('2026-09-20T10:00:00Z', '2026-09-22T08:00:00Z') });
    expect(json(await h.callTool('gog_classroom_announcements_update', { ...args, confirmToken: p1.confirmToken }))).toMatchObject({ error: 'DRAFT_CHANGED' });
    stubReads({ 'classroom courses get': COURSE_JSON, 'classroom announcements get': ANNOUNCEMENT_JSON });
    await h.callTool('gog_classroom_announcements_update', { ...args, confirmToken: p1.confirmToken });
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(1);
  });

  it.each([
    ['course', 'classroom courses get'],
    ['announcement', 'classroom announcements get'],
  ])('returns a failed %s read without prompting or publishing', async (_what, failing) => {
    vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
      const key = (args as unknown[]).map((a) => (typeof a === 'string' ? a : (a as { value: string }).value)).join(' ');
      if (key.startsWith(failing)) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
      return rawTextResult(key.startsWith('classroom courses get') ? COURSE_JSON : ANNOUNCEMENT_JSON);
    });
    const { h, messages } = await prompted();
    const r = await h.callTool('gog_classroom_announcements_update', { courseId: 'c1', announcementId: 'a1', state: 'PUBLISHED' });
    expect(r.isError).toBe(true);
    expect(messages).toHaveLength(0);
    expect(calls('classroom', 'announcements', 'update')).toHaveLength(0);
  });
});

describe('gog_classroom_coursework_update — publishing asks', () => {
  beforeEach(() => stubReads({ 'classroom courses get': COURSE_JSON, 'classroom coursework get': COURSEWORK_JSON }));

  it('reads the course and the coursework, prompts with the class and the CURRENT title and description, then publishes once accepted', async () => {
    const { h, details, messages } = await prompted();
    await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', state: 'PUBLISHED', maxPoints: 100 });
    expect(messages[0]).toMatch(/publish/i);
    expect(details()).toEqual({
      course: { id: 'c1', name: 'Algebra II', section: 'Period 3' },
      coursework: { id: 'w1', title: 'Chapter 4 problem set', state: 'DRAFT' },
      publishes: 'immediately',
      descriptionPreview: 'Problems 1-20, show your work',
    });
    expect(calls('classroom', 'courses', 'get').length).toBeGreaterThanOrEqual(1);
    expect(calls('classroom', 'coursework', 'get').length).toBeGreaterThanOrEqual(1);
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(1);
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'update', pos('c1'), pos('w1'), '--state=PUBLISHED', '--max-points=100'], { account: undefined });
  });

  it('previews the NEW title and description when the same call replaces them, and a schedule as when it publishes', async () => {
    const { h, details } = await prompted({ action: 'decline' });
    await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', title: 'Chapter 5 problem set', description: 'Odd problems only', scheduled: '2026-10-01T12:00:00Z' });
    expect(details()).toMatchObject({ coursework: { id: 'w1', title: 'Chapter 5 problem set', state: 'DRAFT' }, publishes: 'at 2026-10-01T12:00:00Z', descriptionPreview: 'Odd problems only' });
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(0);
  });

  it('previews the CURRENT title and description when they are empty (gog keeps them: empty flags are never sent)', async () => {
    const { h, details } = await prompted({ action: 'decline' });
    await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', title: '', description: '', state: 'PUBLISHED' });
    expect(details()).toMatchObject({ coursework: { id: 'w1', title: 'Chapter 4 problem set', state: 'DRAFT' }, descriptionPreview: 'Problems 1-20, show your work' });
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(0);
  });

  it('token fallback binds the text students will see, not an ignored empty one', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    const h = await createTestHarness(registerExtraClassroomTools);
    const p1 = json(await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', title: '', description: '', state: 'PUBLISHED' }));
    const p2 = json(await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', state: 'PUBLISHED' }));
    expect(p1.preview).toEqual(p2.preview);
    expect(p1.confirmToken).toBeDefined();
  });

  it('does not ask for a due-date change', async () => {
    const { h, messages } = await prompted();
    await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', dueDate: '2026-10-03' });
    expect(messages).toHaveLength(0);
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
  });

  it('refuses a client that cannot be prompted under MCP_CONFIRM_MODE=refuse', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const h = await createTestHarness(registerExtraClassroomTools);
    const r = json(await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', state: 'PUBLISHED' }));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'classroom.coursework-publish' });
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(0);
  });

  it('token fallback: previews, then publishes on phase 2', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    const h = await createTestHarness(registerExtraClassroomTools);
    const args = { courseId: 'c1', courseworkId: 'w1', state: 'PUBLISHED' as const };
    const p1 = json(await h.callTool('gog_classroom_coursework_update', args));
    expect(p1).toMatchObject({ status: 'confirmation-required', preview: { coursework: { id: 'w1', title: 'Chapter 4 problem set', state: 'DRAFT' }, publishes: 'immediately', descriptionPreview: 'Problems 1-20, show your work' } });
    // The teacher edits the coursework between the phases (updateTime rotates): the approval no longer names it.
    stubReads({ 'classroom courses get': COURSE_JSON, 'classroom coursework get': COURSEWORK_JSON.replace('2026-09-21T10:00:00Z', '2026-09-22T08:00:00Z') });
    expect(json(await h.callTool('gog_classroom_coursework_update', { ...args, confirmToken: p1.confirmToken }))).toMatchObject({ error: 'DRAFT_CHANGED' });
    stubReads({ 'classroom courses get': COURSE_JSON, 'classroom coursework get': COURSEWORK_JSON });
    await h.callTool('gog_classroom_coursework_update', { ...args, confirmToken: p1.confirmToken });
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(1);
  });

  it('returns a failed course read without prompting or publishing', async () => {
    vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
      const key = (args as unknown[]).map((a) => (typeof a === 'string' ? a : (a as { value: string }).value)).join(' ');
      if (key.startsWith('classroom courses get')) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
      return rawTextResult(COURSEWORK_JSON);
    });
    const { h, messages } = await prompted();
    const r = await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', state: 'PUBLISHED' });
    expect(r.isError).toBe(true);
    expect(messages).toHaveLength(0);
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(0);
  });

  it('returns a failed coursework read without prompting or publishing', async () => {
    vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
      const key = (args as unknown[]).map((a) => (typeof a === 'string' ? a : (a as { value: string }).value)).join(' ');
      if (key.startsWith('classroom coursework get')) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
      return rawTextResult(COURSE_JSON);
    });
    const { h, messages } = await prompted();
    const r = await h.callTool('gog_classroom_coursework_update', { courseId: 'c1', courseworkId: 'w1', state: 'PUBLISHED' });
    expect(r.isError).toBe(true);
    expect(messages).toHaveLength(0);
    expect(calls('classroom', 'coursework', 'update')).toHaveLength(0);
  });
});

describe('gog_classroom_announcements_delete', () => {
  it('calls runOrDiagnose with ids', async () => {
    await harness.callTool('gog_classroom_announcements_delete', { courseId: 'c1', announcementId: 'a1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'announcements', 'delete', pos('c1'), pos('a1'), '--force'], { account: undefined });
  });
});

describe('gog_classroom_topics_create', () => {
  it('calls runOrDiagnose with courseId and name', async () => {
    await harness.callTool('gog_classroom_topics_create', { courseId: 'c1', name: 'Week 1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'topics', 'create', pos('c1'), '--name=Week 1'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_topics_update', () => {
  it('calls runOrDiagnose with ids and name', async () => {
    await harness.callTool('gog_classroom_topics_update', { courseId: 'c1', topicId: 't1', name: 'Week 2' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'topics', 'update', pos('c1'), pos('t1'), '--name=Week 2'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_topics_delete', () => {
  it('calls runOrDiagnose with ids', async () => {
    await harness.callTool('gog_classroom_topics_delete', { courseId: 'c1', topicId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'topics', 'delete', pos('c1'), pos('t1'), '--force'], { account: undefined });
  });
});

describe('gog_classroom_invitations_create', () => {
  const COURSE = rawTextResult(JSON.stringify({ course: { id: 'c1', name: 'Algebra II' } }));

  it('reads the course and prompts with the class, invitee and role', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(COURSE);
    let message = '';
    const h = await createTestHarness(registerExtraClassroomTools, {
      elicitation: async (r) => { message = r.params.message; return { action: 'decline' }; },
    });
    await h.callTool('gog_classroom_invitations_create', { courseId: 'c1', userId: 'kid@example.com', role: 'OWNER' });
    expect(message).toMatch(/OWNERSHIP/);
    expect(JSON.parse(message.split('\n').slice(1).join('\n')).details)
      .toEqual({ course: { id: 'c1', name: 'Algebra II' }, invitee: 'kid@example.com', role: 'OWNER' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'get', pos('c1')], { account: undefined });
    expect(lib.runOrDiagnose).not.toHaveBeenCalledWith(
      ['classroom', 'invitations', 'create', pos('c1'), pos('kid@example.com'), '--role=OWNER'], { account: undefined });
  });

  it('refuses a client that cannot be prompted', async () => {

    process.env.MCP_CONFIRM_MODE = 'refuse';
    vi.mocked(lib.runOrDiagnose).mockResolvedValue(COURSE);
    const h = await createTestHarness(registerExtraClassroomTools);
    const r = JSON.parse((await h.callTool('gog_classroom_invitations_create', { courseId: 'c1', userId: 'u1', role: 'STUDENT' })).content[0]!.text as string);
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'classroom.invitation-create' });
    expect(r.note).toMatch(/invite them from Classroom/);
  });

  it('token fallback: phase 1 previews, phase 2 invites', async () => {
    const ORIGINAL = { ...process.env };
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    try {
      vi.mocked(lib.runOrDiagnose).mockResolvedValue(COURSE);
      const h = await createTestHarness(registerExtraClassroomTools);
      const args = { courseId: 'c1', userId: 'u1', role: 'STUDENT' as const };
      const p1 = JSON.parse((await h.callTool('gog_classroom_invitations_create', args)).content[0]!.text as string);
      expect(p1.preview).toEqual({ course: { id: 'c1', name: 'Algebra II' }, invitee: 'u1', role: 'STUDENT' });
      await h.callTool('gog_classroom_invitations_create', { ...args, confirmToken: p1.confirmToken });
      expect(lib.runOrDiagnose).toHaveBeenCalledWith(
        ['classroom', 'invitations', 'create', pos('c1'), pos('u1'), '--role=STUDENT'], { account: undefined });
    } finally {
      process.env = ORIGINAL;
    }
  });

  it('returns a failed course read without inviting', async () => {
    vi.mocked(lib.runOrDiagnose).mockResolvedValue({ content: [{ type: 'text', text: 'Error: not found' }], isError: true });
    const r = await harness.callTool('gog_classroom_invitations_create', { courseId: 'c1', userId: 'u1', role: 'STUDENT' });
    expect(r.isError).toBe(true);
    expect(lib.runOrDiagnose).toHaveBeenCalledTimes(1);
  });

  it('calls runOrDiagnose with courseId, userId, role', async () => {
    await harness.callTool('gog_classroom_invitations_create', { courseId: 'c1', userId: 'u1', role: 'STUDENT' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'invitations', 'create', pos('c1'), pos('u1'), '--role=STUDENT'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_invitations_delete', () => {
  it('calls runOrDiagnose with invitationId', async () => {
    await harness.callTool('gog_classroom_invitations_delete', { invitationId: 'i1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'invitations', 'delete', pos('i1'), '--force'], { account: undefined });
  });
});
