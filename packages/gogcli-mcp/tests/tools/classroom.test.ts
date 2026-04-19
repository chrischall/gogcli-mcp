import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerClassroomTools } from '../../src/tools/classroom.js';
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
  registerClassroomTools(server);
  return handlers;
}

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runner.run).mockResolvedValue('{}');
  handlers = setupHandlers();
});

describe('gog_classroom_courses_list', () => {
  it('calls run with no flags', async () => {
    await handlers.get('gog_classroom_courses_list')!({});
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'list'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_courses_list')!({
      state: 'ACTIVE,ARCHIVED',
      teacher: 'teacher1',
      student: 'student1',
      max: 50,
      page: 'tok',
      all: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'courses', 'list', '--state=ACTIVE,ARCHIVED', '--teacher=teacher1', '--student=student1', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_courses_list')!({ all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'list'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_courses_list')!({});
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_courses_get', () => {
  it('calls run with courseId', async () => {
    await handlers.get('gog_classroom_courses_get')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'get', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_courses_get')!({ courseId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_courses_create', () => {
  it('calls run with required name only', async () => {
    await handlers.get('gog_classroom_courses_create')!({ name: 'Math 101' });
    expect(runner.run).toHaveBeenCalledWith(
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
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'courses', 'create', '--name=Math 101', '--owner=me', '--section=Section A', '--description-heading=Welcome', '--description=Algebra', '--room=R101', '--state=ACTIVE'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const result = await handlers.get('gog_classroom_courses_create')!({ name: 'X' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_classroom_courses_update', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_courses_update')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'update', 'c1'], { account: undefined });
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
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'courses', 'update', 'c1', '--name=New Name', '--owner=me', '--section=B', '--description-heading=Heading', '--description=Desc', '--room=R2', '--state=ARCHIVED'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const result = await handlers.get('gog_classroom_courses_update')!({ courseId: 'bad' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

describe('gog_classroom_courses_delete', () => {
  it('calls run with courseId', async () => {
    await handlers.get('gog_classroom_courses_delete')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'delete', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const result = await handlers.get('gog_classroom_courses_delete')!({ courseId: 'bad' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_classroom_courses_archive', () => {
  it('calls run with courseId', async () => {
    await handlers.get('gog_classroom_courses_archive')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'archive', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Archive failed'));
    const result = await handlers.get('gog_classroom_courses_archive')!({ courseId: 'x' });
    expect(result.content[0].text).toBe('Error: Archive failed');
  });
});

describe('gog_classroom_courses_unarchive', () => {
  it('calls run with courseId', async () => {
    await handlers.get('gog_classroom_courses_unarchive')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'courses', 'unarchive', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Unarchive failed'));
    const result = await handlers.get('gog_classroom_courses_unarchive')!({ courseId: 'x' });
    expect(result.content[0].text).toBe('Error: Unarchive failed');
  });
});

describe('gog_classroom_students_list', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_students_list')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'students', 'list', 'c1'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_students_list')!({ courseId: 'c1', max: 20, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'students', 'list', 'c1', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_students_list')!({ courseId: 'c1', all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'students', 'list', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_students_list')!({ courseId: 'c1' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_students_get', () => {
  it('calls run with courseId and userId', async () => {
    await handlers.get('gog_classroom_students_get')!({ courseId: 'c1', userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'students', 'get', 'c1', 'u1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_students_get')!({ courseId: 'c1', userId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_students_add', () => {
  it('calls run with courseId and userId', async () => {
    await handlers.get('gog_classroom_students_add')!({ courseId: 'c1', userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'students', 'add', 'c1', 'u1'], { account: undefined });
  });

  it('passes --enrollment-code when provided', async () => {
    await handlers.get('gog_classroom_students_add')!({ courseId: 'c1', userId: 'u1', enrollmentCode: 'abc123' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'students', 'add', 'c1', 'u1', '--enrollment-code=abc123'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Add failed'));
    const result = await handlers.get('gog_classroom_students_add')!({ courseId: 'c1', userId: 'u1' });
    expect(result.content[0].text).toBe('Error: Add failed');
  });
});

describe('gog_classroom_students_remove', () => {
  it('calls run with courseId and userId', async () => {
    await handlers.get('gog_classroom_students_remove')!({ courseId: 'c1', userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'students', 'remove', 'c1', 'u1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Remove failed'));
    const result = await handlers.get('gog_classroom_students_remove')!({ courseId: 'c1', userId: 'u1' });
    expect(result.content[0].text).toBe('Error: Remove failed');
  });
});

describe('gog_classroom_teachers_list', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_teachers_list')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'teachers', 'list', 'c1'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_teachers_list')!({ courseId: 'c1', max: 20, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'teachers', 'list', 'c1', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_teachers_list')!({ courseId: 'c1', all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'teachers', 'list', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_teachers_list')!({ courseId: 'c1' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_teachers_get', () => {
  it('calls run with courseId and userId', async () => {
    await handlers.get('gog_classroom_teachers_get')!({ courseId: 'c1', userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'teachers', 'get', 'c1', 'u1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_teachers_get')!({ courseId: 'c1', userId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_teachers_add', () => {
  it('calls run with courseId and userId', async () => {
    await handlers.get('gog_classroom_teachers_add')!({ courseId: 'c1', userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'teachers', 'add', 'c1', 'u1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Add failed'));
    const result = await handlers.get('gog_classroom_teachers_add')!({ courseId: 'c1', userId: 'u1' });
    expect(result.content[0].text).toBe('Error: Add failed');
  });
});

describe('gog_classroom_teachers_remove', () => {
  it('calls run with courseId and userId', async () => {
    await handlers.get('gog_classroom_teachers_remove')!({ courseId: 'c1', userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'teachers', 'remove', 'c1', 'u1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Remove failed'));
    const result = await handlers.get('gog_classroom_teachers_remove')!({ courseId: 'c1', userId: 'u1' });
    expect(result.content[0].text).toBe('Error: Remove failed');
  });
});

describe('gog_classroom_roster', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_roster')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'roster', 'c1'], { account: undefined });
  });

  it('passes all flags', async () => {
    await handlers.get('gog_classroom_roster')!({ courseId: 'c1', students: true, teachers: true, max: 50, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'roster', 'c1', '--students', '--teachers', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits boolean flags when false', async () => {
    await handlers.get('gog_classroom_roster')!({ courseId: 'c1', students: false, teachers: false, all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'roster', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Roster failed'));
    const result = await handlers.get('gog_classroom_roster')!({ courseId: 'c1' });
    expect(result.content[0].text).toBe('Error: Roster failed');
  });
});

describe('gog_classroom_coursework_list', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_coursework_list')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'coursework', 'list', 'c1'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_coursework_list')!({
      courseId: 'c1',
      state: 'PUBLISHED',
      topic: 't1',
      orderBy: 'updateTime desc',
      max: 50,
      page: 'tok',
      all: true,
      scanPages: 5,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'list', 'c1', '--state=PUBLISHED', '--topic=t1', '--order-by=updateTime desc', '--max=50', '--page=tok', '--all', '--scan-pages=5'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_coursework_list')!({ courseId: 'c1', all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'coursework', 'list', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_coursework_list')!({ courseId: 'c1' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_coursework_get', () => {
  it('calls run with courseId and courseworkId', async () => {
    await handlers.get('gog_classroom_coursework_get')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'coursework', 'get', 'c1', 'w1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_coursework_get')!({ courseId: 'c1', courseworkId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_coursework_create', () => {
  it('calls run with required title only', async () => {
    await handlers.get('gog_classroom_coursework_create')!({ courseId: 'c1', title: 'HW1' });
    expect(runner.run).toHaveBeenCalledWith(
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
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'create', 'c1', '--title=HW1', '--description=Chapter 1', '--type=ASSIGNMENT', '--state=PUBLISHED', '--max-points=100', '--due=2026-05-01T23:59', '--due-date=2026-05-01', '--due-time=23:59', '--scheduled=2026-04-30T12:00', '--topic=t1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const result = await handlers.get('gog_classroom_coursework_create')!({ courseId: 'c1', title: 'HW1' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_classroom_coursework_update', () => {
  it('calls run with ids only', async () => {
    await handlers.get('gog_classroom_coursework_update')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'coursework', 'update', 'c1', 'w1'], { account: undefined });
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
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'coursework', 'update', 'c1', 'w1', '--title=New Title', '--description=Desc', '--type=SHORT_ANSWER_QUESTION', '--state=DRAFT', '--max-points=50', '--due=2026-05-01T23:59', '--due-date=2026-05-01', '--due-time=23:59', '--scheduled=2026-04-30T12:00', '--topic=t1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const result = await handlers.get('gog_classroom_coursework_update')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

describe('gog_classroom_coursework_delete', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_coursework_delete')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'coursework', 'delete', 'c1', 'w1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const result = await handlers.get('gog_classroom_coursework_delete')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_classroom_submissions_list', () => {
  it('calls run with ids only', async () => {
    await handlers.get('gog_classroom_submissions_list')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'list', 'c1', 'w1'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_submissions_list')!({
      courseId: 'c1',
      courseworkId: 'w1',
      state: 'TURNED_IN',
      late: 'late',
      user: 'u1',
      max: 20,
      page: 'tok',
      all: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'submissions', 'list', 'c1', 'w1', '--state=TURNED_IN', '--late=late', '--user=u1', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_submissions_list')!({ courseId: 'c1', courseworkId: 'w1', all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'list', 'c1', 'w1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_submissions_list')!({ courseId: 'c1', courseworkId: 'w1' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_submissions_get', () => {
  it('calls run with all three ids', async () => {
    await handlers.get('gog_classroom_submissions_get')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'get', 'c1', 'w1', 's1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_submissions_get')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_submissions_grade', () => {
  it('calls run with ids only', async () => {
    await handlers.get('gog_classroom_submissions_grade')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'grade', 'c1', 'w1', 's1'], { account: undefined });
  });

  it('passes --draft and --assigned when provided', async () => {
    await handlers.get('gog_classroom_submissions_grade')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1', draft: '90', assigned: '95' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'submissions', 'grade', 'c1', 'w1', 's1', '--draft=90', '--assigned=95'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Grade failed'));
    const result = await handlers.get('gog_classroom_submissions_grade')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(result.content[0].text).toBe('Error: Grade failed');
  });
});

describe('gog_classroom_submissions_return', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_submissions_return')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'return', 'c1', 'w1', 's1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Return failed'));
    const result = await handlers.get('gog_classroom_submissions_return')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(result.content[0].text).toBe('Error: Return failed');
  });
});

describe('gog_classroom_submissions_turn_in', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_submissions_turn_in')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'turn-in', 'c1', 'w1', 's1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Turn-in failed'));
    const result = await handlers.get('gog_classroom_submissions_turn_in')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(result.content[0].text).toBe('Error: Turn-in failed');
  });
});

describe('gog_classroom_submissions_reclaim', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_submissions_reclaim')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'submissions', 'reclaim', 'c1', 'w1', 's1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Reclaim failed'));
    const result = await handlers.get('gog_classroom_submissions_reclaim')!({ courseId: 'c1', courseworkId: 'w1', submissionId: 's1' });
    expect(result.content[0].text).toBe('Error: Reclaim failed');
  });
});

describe('gog_classroom_announcements_list', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_announcements_list')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'announcements', 'list', 'c1'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_announcements_list')!({ courseId: 'c1', state: 'PUBLISHED', orderBy: 'updateTime desc', max: 20, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'list', 'c1', '--state=PUBLISHED', '--order-by=updateTime desc', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_announcements_list')!({ courseId: 'c1', all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'announcements', 'list', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_announcements_list')!({ courseId: 'c1' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_announcements_get', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_announcements_get')!({ courseId: 'c1', announcementId: 'a1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'announcements', 'get', 'c1', 'a1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_announcements_get')!({ courseId: 'c1', announcementId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_announcements_create', () => {
  it('calls run with required text only', async () => {
    await handlers.get('gog_classroom_announcements_create')!({ courseId: 'c1', text: 'Hi' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'create', 'c1', '--text=Hi'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_announcements_create')!({ courseId: 'c1', text: 'Hi', state: 'DRAFT', scheduled: '2026-05-01T12:00' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'create', 'c1', '--text=Hi', '--state=DRAFT', '--scheduled=2026-05-01T12:00'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const result = await handlers.get('gog_classroom_announcements_create')!({ courseId: 'c1', text: 'x' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_classroom_announcements_update', () => {
  it('calls run with ids only', async () => {
    await handlers.get('gog_classroom_announcements_update')!({ courseId: 'c1', announcementId: 'a1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'announcements', 'update', 'c1', 'a1'], { account: undefined });
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_classroom_announcements_update')!({ courseId: 'c1', announcementId: 'a1', text: 'edited', state: 'PUBLISHED', scheduled: '2026-05-01T12:00' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'announcements', 'update', 'c1', 'a1', '--text=edited', '--state=PUBLISHED', '--scheduled=2026-05-01T12:00'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const result = await handlers.get('gog_classroom_announcements_update')!({ courseId: 'c1', announcementId: 'a1' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

describe('gog_classroom_announcements_delete', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_announcements_delete')!({ courseId: 'c1', announcementId: 'a1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'announcements', 'delete', 'c1', 'a1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const result = await handlers.get('gog_classroom_announcements_delete')!({ courseId: 'c1', announcementId: 'a1' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_classroom_topics_list', () => {
  it('calls run with courseId only', async () => {
    await handlers.get('gog_classroom_topics_list')!({ courseId: 'c1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'topics', 'list', 'c1'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_topics_list')!({ courseId: 'c1', max: 20, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'topics', 'list', 'c1', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_topics_list')!({ courseId: 'c1', all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'topics', 'list', 'c1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_topics_list')!({ courseId: 'c1' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_topics_get', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_topics_get')!({ courseId: 'c1', topicId: 't1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'topics', 'get', 'c1', 't1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_topics_get')!({ courseId: 'c1', topicId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_topics_create', () => {
  it('calls run with courseId and name', async () => {
    await handlers.get('gog_classroom_topics_create')!({ courseId: 'c1', name: 'Week 1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'topics', 'create', 'c1', '--name=Week 1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const result = await handlers.get('gog_classroom_topics_create')!({ courseId: 'c1', name: 'x' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_classroom_topics_update', () => {
  it('calls run with ids and name', async () => {
    await handlers.get('gog_classroom_topics_update')!({ courseId: 'c1', topicId: 't1', name: 'Week 2' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'topics', 'update', 'c1', 't1', '--name=Week 2'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Update failed'));
    const result = await handlers.get('gog_classroom_topics_update')!({ courseId: 'c1', topicId: 't1', name: 'x' });
    expect(result.content[0].text).toBe('Error: Update failed');
  });
});

describe('gog_classroom_topics_delete', () => {
  it('calls run with ids', async () => {
    await handlers.get('gog_classroom_topics_delete')!({ courseId: 'c1', topicId: 't1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'topics', 'delete', 'c1', 't1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const result = await handlers.get('gog_classroom_topics_delete')!({ courseId: 'c1', topicId: 't1' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_classroom_invitations_list', () => {
  it('calls run with no flags', async () => {
    await handlers.get('gog_classroom_invitations_list')!({});
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'invitations', 'list'], { account: undefined });
  });

  it('passes all listing flags', async () => {
    await handlers.get('gog_classroom_invitations_list')!({ course: 'c1', user: 'u1', max: 20, page: 'tok', all: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'invitations', 'list', '--course=c1', '--user=u1', '--max=20', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_classroom_invitations_list')!({ all: false });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'invitations', 'list'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const result = await handlers.get('gog_classroom_invitations_list')!({});
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_classroom_invitations_get', () => {
  it('calls run with invitationId', async () => {
    await handlers.get('gog_classroom_invitations_get')!({ invitationId: 'i1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'invitations', 'get', 'i1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const result = await handlers.get('gog_classroom_invitations_get')!({ invitationId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_classroom_invitations_create', () => {
  it('calls run with courseId, userId, role', async () => {
    await handlers.get('gog_classroom_invitations_create')!({ courseId: 'c1', userId: 'u1', role: 'STUDENT' });
    expect(runner.run).toHaveBeenCalledWith(
      ['classroom', 'invitations', 'create', 'c1', 'u1', '--role=STUDENT'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const result = await handlers.get('gog_classroom_invitations_create')!({ courseId: 'c1', userId: 'u1', role: 'TEACHER' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_classroom_invitations_accept', () => {
  it('calls run with invitationId', async () => {
    await handlers.get('gog_classroom_invitations_accept')!({ invitationId: 'i1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'invitations', 'accept', 'i1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Accept failed'));
    const result = await handlers.get('gog_classroom_invitations_accept')!({ invitationId: 'bad' });
    expect(result.content[0].text).toBe('Error: Accept failed');
  });
});

describe('gog_classroom_invitations_delete', () => {
  it('calls run with invitationId', async () => {
    await handlers.get('gog_classroom_invitations_delete')!({ invitationId: 'i1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'invitations', 'delete', 'i1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const result = await handlers.get('gog_classroom_invitations_delete')!({ invitationId: 'bad' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_classroom_profile_get', () => {
  it('calls run with no userId (self)', async () => {
    await handlers.get('gog_classroom_profile_get')!({});
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'profile', 'get'], { account: undefined });
  });

  it('passes userId when provided', async () => {
    await handlers.get('gog_classroom_profile_get')!({ userId: 'u1' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'profile', 'get', 'u1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Profile failed'));
    const result = await handlers.get('gog_classroom_profile_get')!({});
    expect(result.content[0].text).toBe('Error: Profile failed');
  });
});

describe('gog_classroom_run', () => {
  it('passes subcommand and args to runner', async () => {
    await handlers.get('gog_classroom_run')!({ subcommand: 'guardians', args: ['list', 'u1'] });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'guardians', 'list', 'u1'], { account: undefined });
  });

  it('passes account through', async () => {
    await handlers.get('gog_classroom_run')!({ subcommand: 'materials', args: [], account: 'a@b.com' });
    expect(runner.run).toHaveBeenCalledWith(['classroom', 'materials'], { account: 'a@b.com' });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const result = await handlers.get('gog_classroom_run')!({ subcommand: 'guardians', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
