import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraClassroomTools } from '../../src/tools/classroom-extra.js';
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
  handlers = setupHandlers(registerExtraClassroomTools);
});

describe('gog_classroom_courses_create', () => {
  it('calls runOrDiagnose with required name only', async () => {
    await handlers.get('gog_classroom_courses_create')!({ name: 'Math 101' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'courses', 'create', '--name=Math 101'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_courses_create')!({
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
    await handlers.get('gog_classroom_courses_update')!({ courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'update', 'c1'], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_courses_update')!({
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
      ['classroom', 'courses', 'update', 'c1', '--name=New Name', '--owner=me', '--section=B', '--description-heading=Heading', '--description=Desc', '--room=R2', '--state=ARCHIVED'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_courses_delete', () => {
  it('calls runOrDiagnose with courseId', async () => {
    await handlers.get('gog_classroom_courses_delete')!({ courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'delete', 'c1'], { account: undefined });
  });
});

describe('gog_classroom_courses_archive', () => {
  it('calls runOrDiagnose with courseId', async () => {
    await handlers.get('gog_classroom_courses_archive')!({ courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'archive', 'c1'], { account: undefined });
  });
});

describe('gog_classroom_courses_unarchive', () => {
  it('calls runOrDiagnose with courseId', async () => {
    await handlers.get('gog_classroom_courses_unarchive')!({ courseId: 'c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'courses', 'unarchive', 'c1'], { account: undefined });
  });
});

describe('gog_classroom_students_add', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await handlers.get('gog_classroom_students_add')!({ courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'students', 'add', 'c1', 'u1'], { account: undefined });
  });

  it('passes --enrollment-code when provided', async () => {
    await handlers.get('gog_classroom_students_add')!({ courseId: 'c1', userId: 'u1', enrollmentCode: 'abc123' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'students', 'add', 'c1', 'u1', '--enrollment-code=abc123'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_students_remove', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await handlers.get('gog_classroom_students_remove')!({ courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'students', 'remove', 'c1', 'u1'], { account: undefined });
  });
});

describe('gog_classroom_teachers_add', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await handlers.get('gog_classroom_teachers_add')!({ courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'teachers', 'add', 'c1', 'u1'], { account: undefined });
  });
});

describe('gog_classroom_teachers_remove', () => {
  it('calls runOrDiagnose with courseId and userId', async () => {
    await handlers.get('gog_classroom_teachers_remove')!({ courseId: 'c1', userId: 'u1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'teachers', 'remove', 'c1', 'u1'], { account: undefined });
  });
});

describe('gog_classroom_coursework_create', () => {
  it('calls runOrDiagnose with required title only', async () => {
    await handlers.get('gog_classroom_coursework_create')!({ courseId: 'c1', title: 'HW1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'create', 'c1', '--title=HW1'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_coursework_create')!({
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
      ['classroom', 'coursework', 'create', 'c1', '--title=HW1', '--description=Chapter 1', '--type=ASSIGNMENT', '--state=PUBLISHED', '--max-points=100', '--due=2026-05-01T23:59', '--due-date=2026-05-01', '--due-time=23:59', '--scheduled=2026-04-30T12:00', '--topic=t1'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_coursework_update', () => {
  it('calls runOrDiagnose with ids only', async () => {
    await handlers.get('gog_classroom_coursework_update')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'coursework', 'update', 'c1', 'w1'], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_coursework_update')!({
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
      ['classroom', 'coursework', 'update', 'c1', 'w1', '--title=New Title', '--description=Desc', '--type=SHORT_ANSWER_QUESTION', '--state=DRAFT', '--max-points=50', '--due=2026-05-01T23:59', '--due-date=2026-05-01', '--due-time=23:59', '--scheduled=2026-04-30T12:00', '--topic=t1'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_coursework_delete', () => {
  it('calls runOrDiagnose with ids', async () => {
    await handlers.get('gog_classroom_coursework_delete')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'coursework', 'delete', 'c1', 'w1'], { account: undefined });
  });
});

describe('gog_classroom_announcements_update', () => {
  it('calls runOrDiagnose with ids only', async () => {
    await handlers.get('gog_classroom_announcements_update')!({ courseId: 'c1', announcementId: 'a1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'announcements', 'update', 'c1', 'a1'], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_announcements_update')!({
      courseId: 'c1',
      announcementId: 'a1',
      text: 'edited',
      state: 'PUBLISHED',
      scheduled: '2026-05-01T12:00',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'update', 'c1', 'a1', '--text=edited', '--state=PUBLISHED', '--scheduled=2026-05-01T12:00'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_announcements_delete', () => {
  it('calls runOrDiagnose with ids', async () => {
    await handlers.get('gog_classroom_announcements_delete')!({ courseId: 'c1', announcementId: 'a1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'announcements', 'delete', 'c1', 'a1'], { account: undefined });
  });
});

describe('gog_classroom_topics_create', () => {
  it('calls runOrDiagnose with courseId and name', async () => {
    await handlers.get('gog_classroom_topics_create')!({ courseId: 'c1', name: 'Week 1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'topics', 'create', 'c1', '--name=Week 1'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_topics_update', () => {
  it('calls runOrDiagnose with ids and name', async () => {
    await handlers.get('gog_classroom_topics_update')!({ courseId: 'c1', topicId: 't1', name: 'Week 2' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'topics', 'update', 'c1', 't1', '--name=Week 2'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_topics_delete', () => {
  it('calls runOrDiagnose with ids', async () => {
    await handlers.get('gog_classroom_topics_delete')!({ courseId: 'c1', topicId: 't1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'topics', 'delete', 'c1', 't1'], { account: undefined });
  });
});

describe('gog_classroom_invitations_create', () => {
  it('calls runOrDiagnose with courseId, userId, role', async () => {
    await handlers.get('gog_classroom_invitations_create')!({ courseId: 'c1', userId: 'u1', role: 'STUDENT' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['classroom', 'invitations', 'create', 'c1', 'u1', '--role=STUDENT'],
      { account: undefined },
    );
  });
});

describe('gog_classroom_invitations_delete', () => {
  it('calls runOrDiagnose with invitationId', async () => {
    await handlers.get('gog_classroom_invitations_delete')!({ invitationId: 'i1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['classroom', 'invitations', 'delete', 'i1'], { account: undefined });
  });
});
