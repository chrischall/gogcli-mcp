import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

const courseState = z.enum(['ACTIVE', 'ARCHIVED', 'PROVISIONED', 'DECLINED', 'SUSPENDED']);
const workState = z.enum(['PUBLISHED', 'DRAFT']);
const workType = z.enum(['ASSIGNMENT', 'SHORT_ANSWER_QUESTION', 'MULTIPLE_CHOICE_QUESTION']);

// Fields shared by courses_create and courses_update. `name` is required on
// create, optional on update — keep it out of this fragment so each tool can
// declare its own rule.
const courseSharedFields = {
  owner: z.string().optional().describe('Owner user ID (default "me" on create)'),
  section: z.string().optional().describe('Section'),
  descriptionHeading: z.string().optional().describe('Description heading'),
  description: z.string().optional().describe('Description'),
  room: z.string().optional().describe('Room'),
  state: courseState.optional().describe('Course state'),
};

// Fields shared by coursework_create and coursework_update.
const courseworkSharedFields = {
  description: z.string().optional().describe('Description'),
  type: workType.optional().describe('Work type (default: ASSIGNMENT)'),
  state: workState.optional().describe('State'),
  maxPoints: z.number().optional().describe('Max points'),
  due: z.string().optional().describe('Due datetime (combined date+time)'),
  dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
  dueTime: z.string().optional().describe('Due time (HH:MM)'),
  scheduled: z.string().optional().describe('Scheduled publish time'),
  topic: z.string().optional().describe('Topic ID'),
};

export function registerExtraClassroomTools(server: McpServer): void {
  server.registerTool('gog_classroom_courses_create', {
    description: 'Create a new Google Classroom course.',
    inputSchema: {
      name: z.string().describe('Course name'),
      ...courseSharedFields,
      account: accountParam,
    },
  }, async ({ name, owner, section, descriptionHeading, description, room, state, account }) => {
    const args = ['classroom', 'courses', 'create', `--name=${name}`];
    if (owner) args.push(`--owner=${owner}`);
    if (section) args.push(`--section=${section}`);
    if (descriptionHeading) args.push(`--description-heading=${descriptionHeading}`);
    if (description) args.push(`--description=${description}`);
    if (room) args.push(`--room=${room}`);
    if (state) args.push(`--state=${state}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_courses_update', {
    description: 'Update an existing Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      name: z.string().optional().describe('Course name'),
      ...courseSharedFields,
      account: accountParam,
    },
  }, async ({ courseId, name, owner, section, descriptionHeading, description, room, state, account }) => {
    const args = ['classroom', 'courses', 'update', courseId];
    if (name) args.push(`--name=${name}`);
    if (owner) args.push(`--owner=${owner}`);
    if (section) args.push(`--section=${section}`);
    if (descriptionHeading) args.push(`--description-heading=${descriptionHeading}`);
    if (description) args.push(`--description=${description}`);
    if (room) args.push(`--room=${room}`);
    if (state) args.push(`--state=${state}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_courses_delete', {
    description: 'Delete a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    },
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'delete', courseId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_courses_archive', {
    description: 'Archive a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    },
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'archive', courseId], { account });
  });

  server.registerTool('gog_classroom_courses_unarchive', {
    description: 'Unarchive a Google Classroom course (restore to ACTIVE).',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    },
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'unarchive', courseId], { account });
  });

  server.registerTool('gog_classroom_students_add', {
    description: 'Add a student to a Google Classroom course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID (or "me")'),
      enrollmentCode: z.string().optional().describe('Enrollment code (required if adding self via code)'),
      account: accountParam,
    },
  }, async ({ courseId, userId, enrollmentCode, account }) => {
    const args = ['classroom', 'students', 'add', courseId, userId];
    if (enrollmentCode) args.push(`--enrollment-code=${enrollmentCode}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_students_remove', {
    description: 'Remove a student from a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID'),
      account: accountParam,
    },
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'students', 'remove', courseId, userId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_teachers_add', {
    description: 'Add a teacher to a Google Classroom course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID'),
      account: accountParam,
    },
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'teachers', 'add', courseId, userId], { account });
  });

  server.registerTool('gog_classroom_teachers_remove', {
    description: 'Remove a teacher from a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID'),
      account: accountParam,
    },
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'teachers', 'remove', courseId, userId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_coursework_create', {
    description: 'Create a new coursework item (assignment, question, etc.) in a course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      title: z.string().describe('Coursework title'),
      ...courseworkSharedFields,
      account: accountParam,
    },
  }, async ({ courseId, title, description, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic, account }) => {
    const args = ['classroom', 'coursework', 'create', courseId, `--title=${title}`];
    if (description) args.push(`--description=${description}`);
    if (type) args.push(`--type=${type}`);
    if (state) args.push(`--state=${state}`);
    if (maxPoints !== undefined) args.push(`--max-points=${maxPoints}`);
    if (due) args.push(`--due=${due}`);
    if (dueDate) args.push(`--due-date=${dueDate}`);
    if (dueTime) args.push(`--due-time=${dueTime}`);
    if (scheduled) args.push(`--scheduled=${scheduled}`);
    if (topic) args.push(`--topic=${topic}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_update', {
    description: 'Update an existing coursework item.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      title: z.string().optional().describe('New title'),
      ...courseworkSharedFields,
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, title, description, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic, account }) => {
    const args = ['classroom', 'coursework', 'update', courseId, courseworkId];
    if (title) args.push(`--title=${title}`);
    if (description) args.push(`--description=${description}`);
    if (type) args.push(`--type=${type}`);
    if (state) args.push(`--state=${state}`);
    if (maxPoints !== undefined) args.push(`--max-points=${maxPoints}`);
    if (due) args.push(`--due=${due}`);
    if (dueDate) args.push(`--due-date=${dueDate}`);
    if (dueTime) args.push(`--due-time=${dueTime}`);
    if (scheduled) args.push(`--scheduled=${scheduled}`);
    if (topic) args.push(`--topic=${topic}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_delete', {
    description: 'Delete a coursework item.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, account }) => {
    return runOrDiagnose(['classroom', 'coursework', 'delete', courseId, courseworkId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_announcements_update', {
    description: 'Update an existing announcement.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      text: z.string().optional().describe('New text'),
      state: workState.optional().describe('State'),
      scheduled: z.string().optional().describe('Scheduled publish time'),
      account: accountParam,
    },
  }, async ({ courseId, announcementId, text, state, scheduled, account }) => {
    const args = ['classroom', 'announcements', 'update', courseId, announcementId];
    if (text) args.push(`--text=${text}`);
    if (state) args.push(`--state=${state}`);
    if (scheduled) args.push(`--scheduled=${scheduled}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_announcements_delete', {
    description: 'Delete an announcement.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      account: accountParam,
    },
  }, async ({ courseId, announcementId, account }) => {
    return runOrDiagnose(['classroom', 'announcements', 'delete', courseId, announcementId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_topics_create', {
    description: 'Create a topic in a Google Classroom course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      name: z.string().describe('Topic name'),
      account: accountParam,
    },
  }, async ({ courseId, name, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'create', courseId, `--name=${name}`], { account });
  });

  server.registerTool('gog_classroom_topics_update', {
    description: 'Rename an existing topic.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      topicId: z.string().describe('Topic ID'),
      name: z.string().describe('New topic name'),
      account: accountParam,
    },
  }, async ({ courseId, topicId, name, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'update', courseId, topicId, `--name=${name}`], { account });
  });

  server.registerTool('gog_classroom_topics_delete', {
    description: 'Delete a topic.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      topicId: z.string().describe('Topic ID'),
      account: accountParam,
    },
  }, async ({ courseId, topicId, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'delete', courseId, topicId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_invitations_create', {
    description: 'Create an invitation to a Google Classroom course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('User ID to invite'),
      role: z.enum(['STUDENT', 'TEACHER', 'OWNER']).describe('Role for the invited user'),
      account: accountParam,
    },
  }, async ({ courseId, userId, role, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'create', courseId, userId, `--role=${role}`], { account });
  });

  server.registerTool('gog_classroom_invitations_delete', {
    description: 'Delete (revoke) a Google Classroom invitation.',
    annotations: { destructiveHint: true },
    inputSchema: {
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    },
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'delete', invitationId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });
}
