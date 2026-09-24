import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool, pageTokenParam, pageAliasParam, resolvePageToken} from './utils.js';
import { pos } from '../argv.js';
import type { GogArg } from '../runner.js';
import { bodyPreview, CONFIRM_FALLBACK_DESCRIPTION, confirmTokenParam, gatedElsewhere, hasCommandWord, requireDispatchConfirmation, resultText } from '../dispatch-confirmation.js';

// gog's spellings (internal/cmd/classroom.go, classroom_announcements.go, classroom_invitations.go).
const CLASSROOM_CREATE_WORDS = new Set(['create', 'add', 'new']);
const CLASSROOM_GATED: Record<string, { does: string; tool: string }> = {
  announcements: { does: 'posts to a class', tool: 'gog_classroom_announcements_create' },
  announcement: { does: 'posts to a class', tool: 'gog_classroom_announcements_create' },
  ann: { does: 'posts to a class', tool: 'gog_classroom_announcements_create' },
  invitations: { does: 'invites someone to a class', tool: 'gog_classroom_invitations_create' },
  invitation: { does: 'invites someone to a class', tool: 'gog_classroom_invitations_create' },
  invites: { does: 'invites someone to a class', tool: 'gog_classroom_invitations_create' },
};

/** gog_classroom_run must not post or invite what the dedicated tools would ask about. */
export function vetClassroomRun(subcommand: string, args: readonly string[]): string | undefined {
  const sub = subcommand.toLowerCase();
  const gated = Object.hasOwn(CLASSROOM_GATED, sub) ? CLASSROOM_GATED[sub] : undefined;
  if (!gated) return undefined;
  const word = hasCommandWord(args, CLASSROOM_CREATE_WORDS);
  return word ? gatedElsewhere(`gog classroom ${sub} ${word.toLowerCase()}`, 'gog_classroom_run', gated.does, gated.tool) : undefined;
}

/**
 * The course a Classroom dispatch reaches, for its confirmation prompt: a user
 * approving "post to 123456789" cannot tell which class that is. Read on every
 * call, so it is also the token fallback's phase-2 re-read. Unreadable output
 * names nothing rather than throwing.
 */
export async function readCourse(
  courseId: string,
  account: string | undefined,
  // A sub-package passes the runOrDiagnose it imported from lib.js, so its own
  // tests' mock of that seam covers this read too.
  runner: typeof runOrDiagnose = runOrDiagnose,
) {
  const got = await runner(['classroom', 'courses', 'get', pos(courseId)], { account });
  if (got.isError) return { error: got };
  let course: { name?: unknown; section?: unknown } | undefined;
  try {
    course = (JSON.parse(resultText(got)) as { course?: typeof course } | null)?.course;
  } catch {
    course = undefined;
  }
  return {
    course: {
      id: courseId,
      ...(typeof course?.name === 'string' ? { name: course.name } : {}),
      ...(typeof course?.section === 'string' ? { section: course.section } : {}),
    },
  };
}

export function registerClassroomTools(server: McpServer): void {
  server.registerTool('gog_classroom_courses_list', {
    description: 'List Google Classroom courses.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      state: z.string().optional().describe('Comma-separated course states (ACTIVE, ARCHIVED, PROVISIONED, DECLINED, SUSPENDED)'),
      teacher: z.string().optional().describe('Filter by teacher user ID'),
      student: z.string().optional().describe('Filter by student user ID'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ state, teacher, student, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'courses', 'list'];
    if (state) args.push(`--state=${state}`);
    if (teacher) args.push(`--teacher=${teacher}`);
    if (student) args.push(`--student=${student}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_courses_get', {
    description: 'Get a single Google Classroom course by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    }),
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'get', pos(courseId)], { account });
  });

  server.registerTool('gog_classroom_students_list', {
    description: 'List students enrolled in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ courseId, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'students', 'list', pos(courseId)];
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_students_get', {
    description: 'Get a specific student enrolled in a course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID'),
      account: accountParam,
    }),
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'students', 'get', pos(courseId), pos(userId)], { account });
  });

  server.registerTool('gog_classroom_teachers_list', {
    description: 'List teachers in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ courseId, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'teachers', 'list', pos(courseId)];
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_teachers_get', {
    description: 'Get a specific teacher in a course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID'),
      account: accountParam,
    }),
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'teachers', 'get', pos(courseId), pos(userId)], { account });
  });

  server.registerTool('gog_classroom_roster', {
    description: 'List the full roster (students and/or teachers) of a Google Classroom course. Omit both flags to return both groups.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      students: z.boolean().optional().describe('Include students only'),
      teachers: z.boolean().optional().describe('Include teachers only'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ courseId, students, teachers, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'roster', pos(courseId)];
    if (students) args.push('--students');
    if (teachers) args.push('--teachers');
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_list', {
    description: 'List coursework (assignments, questions, materials) for a course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      state: z.string().optional().describe('Filter by coursework state (PUBLISHED, DRAFT, DELETED)'),
      topic: z.string().optional().describe('Filter by topic ID'),
      orderBy: z.string().optional().describe('Sort order (e.g. "updateTime desc")'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      scanPages: z.number().optional().describe('Max pages to scan when filtering'),
      account: accountParam,
    }),
  }, async ({ courseId, state, topic, orderBy, max, pageToken, page, all, scanPages, account }) => {
    const args: GogArg[] = ['classroom', 'coursework', 'list', pos(courseId)];
    if (state) args.push(`--state=${state}`);
    if (topic) args.push(`--topic=${topic}`);
    if (orderBy) args.push(`--order-by=${orderBy}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    if (scanPages !== undefined) args.push(`--scan-pages=${scanPages}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_get', {
    description: 'Get a single coursework item by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, account }) => {
    return runOrDiagnose(['classroom', 'coursework', 'get', pos(courseId), pos(courseworkId)], { account });
  });

  server.registerTool('gog_classroom_submissions_list', {
    description: 'List student submissions for a coursework item.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      state: z.string().optional().describe('Filter by submission state'),
      late: z.enum(['late', 'not-late']).optional().describe('Filter by late status'),
      user: z.string().optional().describe('Filter by student user ID'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, state, late, user, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'submissions', 'list', pos(courseId), pos(courseworkId)];
    if (state) args.push(`--state=${state}`);
    if (late) args.push(`--late=${late}`);
    if (user) args.push(`--user=${user}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_submissions_get', {
    description: 'Get a single submission by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'get', pos(courseId), pos(courseworkId), pos(submissionId)], { account });
  });

  server.registerTool('gog_classroom_submissions_grade', {
    description: 'Grade a student submission. Set draft and/or assigned grade values.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      draft: z.string().optional().describe('Draft grade value'),
      assigned: z.string().optional().describe('Assigned (final) grade value'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, submissionId, draft, assigned, account }) => {
    const args: GogArg[] = ['classroom', 'submissions', 'grade', pos(courseId), pos(courseworkId), pos(submissionId)];
    if (draft) args.push(`--draft=${draft}`);
    if (assigned) args.push(`--assigned=${assigned}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_submissions_return', {
    description: 'Return a graded submission to the student.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'return', pos(courseId), pos(courseworkId), pos(submissionId)], { account });
  });

  server.registerTool('gog_classroom_submissions_turn_in', {
    description: 'Turn in a student submission (student action).',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'turn-in', pos(courseId), pos(courseworkId), pos(submissionId)], { account });
  });

  server.registerTool('gog_classroom_submissions_reclaim', {
    description: 'Reclaim a turned-in submission (student action to edit a submission).',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'reclaim', pos(courseId), pos(courseworkId), pos(submissionId)], { account });
  });

  server.registerTool('gog_classroom_announcements_list', {
    description: 'List announcements in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      state: z.string().optional().describe('Filter by announcement state'),
      orderBy: z.string().optional().describe('Sort order'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ courseId, state, orderBy, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'announcements', 'list', pos(courseId)];
    if (state) args.push(`--state=${state}`);
    if (orderBy) args.push(`--order-by=${orderBy}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_announcements_get', {
    description: 'Get a single announcement by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      account: accountParam,
    }),
  }, async ({ courseId, announcementId, account }) => {
    return runOrDiagnose(['classroom', 'announcements', 'get', pos(courseId), pos(announcementId)], { account });
  });

  server.registerTool('gog_classroom_announcements_create', {
    description: 'Create an announcement in a Google Classroom course. Unless state is DRAFT (which students cannot '
      + 'see), this reads the course and asks the MCP host to show the user a confirmation prompt with the class, the '
      + 'full text and when it publishes; nothing is posted unless they accept. To stage one without asking, pass '
      + 'state DRAFT.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      text: z.string().describe('Announcement text'),
      state: z.enum(['PUBLISHED', 'DRAFT']).optional().describe('State (DRAFT is visible only to teachers and needs no confirmation)'),
      scheduled: z.string().optional().describe('Scheduled publish time'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, text, state, scheduled, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['classroom', 'announcements', 'create', pos(courseId), `--text=${text}`];
    if (state) args.push(`--state=${state}`);
    if (scheduled) args.push(`--scheduled=${scheduled}`);
    // A draft reaches nobody until a teacher publishes it: it is this tool's
    // own staging twin, so it needs no confirmation.
    if (state !== 'DRAFT') {
      const read = await readCourse(courseId, account);
      if (read.error) return read.error;
      const publishes = scheduled ? `at ${scheduled}` : 'immediately';
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'classroom.announcement-create',
        message: 'Review and confirm this Classroom announcement:',
        confirmationLabel: 'Confirm that this announcement should be posted to the class.',
        details: { course: read.course, publishes, textPreview: bodyPreview(text) },
        unsupportedNote: 'Create it with state DRAFT instead; the user can review and post it from Classroom.',
        fallback: {
          tool: 'gog_classroom_announcements_create',
          account,
          confirmToken,
          subject: () => {
            const view = { course: read.course, publishes, text };
            return { target: courseId, payload: view, preview: view };
          },
        },
      });
      if (confirmation) return confirmation;
    }
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_topics_list', {
    description: 'List topics in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ courseId, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'topics', 'list', pos(courseId)];
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_topics_get', {
    description: 'Get a single topic by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      topicId: z.string().describe('Topic ID'),
      account: accountParam,
    }),
  }, async ({ courseId, topicId, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'get', pos(courseId), pos(topicId)], { account });
  });

  server.registerTool('gog_classroom_invitations_list', {
    description: 'List Google Classroom invitations.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      course: z.string().optional().describe('Filter by course ID'),
      user: z.string().optional().describe('Filter by user ID'),
      max: z.number().optional().describe('Max results per page'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    }),
  }, async ({ course, user, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['classroom', 'invitations', 'list'];
    if (course) args.push(`--course=${course}`);
    if (user) args.push(`--user=${user}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_invitations_get', {
    description: 'Get a single invitation by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    }),
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'get', pos(invitationId)], { account });
  });

  server.registerTool('gog_classroom_invitations_accept', {
    description: 'Accept a Google Classroom invitation.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    }),
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'accept', pos(invitationId)], { account });
  });

  server.registerTool('gog_classroom_profile_get', {
    description: 'Get a Google Classroom user profile. Omit userId to fetch the authenticated user.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      userId: z.string().optional().describe('User ID (omit for self)'),
      account: accountParam,
    }),
  }, async ({ userId, account }) => {
    const args: GogArg[] = ['classroom', 'profile', 'get'];
    if (userId) args.push(pos(userId));
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, {
    service: 'classroom',
    examples: '"guardians", "materials", "guardian-invitations"',
    vet: vetClassroomRun,
    note: 'Covers anything not wrapped by the dedicated tools (guardians, guardian-invitations, materials, coursework assignees, announcement assignees, etc.).',
  });
}
