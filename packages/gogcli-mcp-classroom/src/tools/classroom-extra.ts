import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { accountParam, runOrDiagnose, pos, readCourse, readClassroomWork, requireDispatchConfirmation, bodyPreview, CONFIRM_FALLBACK_DESCRIPTION, confirmTokenParam } from '../../../gogcli-mcp/src/lib.js';
import type { GogArg } from '../../../gogcli-mcp/src/lib.js';

const courseState = z.enum(['ACTIVE', 'ARCHIVED', 'PROVISIONED', 'DECLINED', 'SUSPENDED']);
const workState = z.enum(['PUBLISHED', 'DRAFT']);
const workType = z.enum(['ASSIGNMENT', 'SHORT_ANSWER_QUESTION', 'MULTIPLE_CHOICE_QUESTION']);

// ============================================================================
// PUBLISHING THROUGH UPDATE is on the dispatch rail (SEC-3, fleet-audit #932).
// gog_classroom_announcements_create asks unless the state is DRAFT — the
// draft path is documented as the way through on a client that cannot be
// prompted — so create-as-DRAFT then update-to-PUBLISHED was the same two-step
// around a gate that closed for Gmail drafts. An update that publishes (state
// PUBLISHED, or a schedule: a scheduled item is a draft that publishes itself)
// reads the course and the item and asks, with the text or title the class
// will actually see; a text edit, a due date or a return to DRAFT does not.
// ============================================================================

/** When an update makes work visible to students, in the words the prompt uses; undefined when it does not. */
function publishesWhen(state: string | undefined, scheduled: string | undefined): string | undefined {
  if (scheduled) return `at ${scheduled}`;
  return state === 'PUBLISHED' ? 'immediately' : undefined;
}

const PUBLISH_DESCRIPTION = ' Publishing it (state PUBLISHED, or a scheduled time) reads the course and the item and asks the MCP host to '
  + 'show the user a confirmation prompt with the class and what students will see; nothing is published unless they '
  + 'accept. Other edits, and a return to DRAFT, need no confirmation.' + CONFIRM_FALLBACK_DESCRIPTION;

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
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      name: z.string().describe('Course name'),
      ...courseSharedFields,
      account: accountParam,
    }),
  }, async ({ name, owner, section, descriptionHeading, description, room, state, account }) => {
    const args: GogArg[] = ['classroom', 'courses', 'create', `--name=${name}`];
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
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      name: z.string().optional().describe('Course name'),
      ...courseSharedFields,
      account: accountParam,
    }),
  }, async ({ courseId, name, owner, section, descriptionHeading, description, room, state, account }) => {
    const args: GogArg[] = ['classroom', 'courses', 'update', pos(courseId)];
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
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    }),
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'delete', pos(courseId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_courses_archive', {
    description: 'Archive a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    }),
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'archive', pos(courseId)], { account });
  });

  server.registerTool('gog_classroom_courses_unarchive', {
    description: 'Unarchive a Google Classroom course (restore to ACTIVE).',
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    }),
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'unarchive', pos(courseId)], { account });
  });

  server.registerTool('gog_classroom_students_add', {
    description: 'Add a student to a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID (or "me")'),
      enrollmentCode: z.string().optional().describe('Enrollment code (required if adding self via code)'),
      account: accountParam,
    }),
  }, async ({ courseId, userId, enrollmentCode, account }) => {
    const args: GogArg[] = ['classroom', 'students', 'add', pos(courseId), pos(userId)];
    if (enrollmentCode) args.push(`--enrollment-code=${enrollmentCode}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_students_remove', {
    description: 'Remove a student from a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID'),
      account: accountParam,
    }),
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'students', 'remove', pos(courseId), pos(userId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_teachers_add', {
    description: 'Add a teacher to a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID'),
      account: accountParam,
    }),
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'teachers', 'add', pos(courseId), pos(userId)], { account });
  });

  server.registerTool('gog_classroom_teachers_remove', {
    description: 'Remove a teacher from a Google Classroom course.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID'),
      account: accountParam,
    }),
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'teachers', 'remove', pos(courseId), pos(userId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_coursework_create', {
    description: 'Create a new coursework item (assignment, question, etc.) in a course.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      title: z.string().describe('Coursework title'),
      ...courseworkSharedFields,
      account: accountParam,
    }),
  }, async ({ courseId, title, description, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic, account }) => {
    const args: GogArg[] = ['classroom', 'coursework', 'create', pos(courseId), `--title=${title}`];
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
    description: 'Update an existing coursework item.' + PUBLISH_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      title: z.string().optional().describe('New title'),
      ...courseworkSharedFields,
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, courseworkId, title, description, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['classroom', 'coursework', 'update', pos(courseId), pos(courseworkId)];
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
    const publishes = publishesWhen(state, scheduled);
    if (publishes) {
      const read = await readCourse(courseId, account, runOrDiagnose);
      if (read.error) return read.error;
      const current = await readClassroomWork('coursework', courseId, courseworkId, account, runOrDiagnose);
      if (current.error) return current.error;
      const view = {
        course: read.course,
        coursework: { id: courseworkId, title: title ?? current.work.title, state: current.work.state },
        publishes,
      };
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'classroom.coursework-publish',
        message: 'Review and confirm publishing this Classroom coursework to students:',
        confirmationLabel: 'Confirm that this coursework should be published to the class.',
        details: view,
        unsupportedNote: 'Leave it as a DRAFT; the user can review and publish it from Classroom.',
        fallback: {
          tool: 'gog_classroom_coursework_update',
          account,
          confirmToken,
          subject: () => ({
            target: `${courseId}/${courseworkId}`,
            revision: current.work.updateTime,
            payload: { course: read.course, courseworkId, title, description, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic },
            preview: view,
          }),
        },
      });
      if (confirmation) return confirmation;
    }
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_delete', {
    description: 'Delete a coursework item.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      account: accountParam,
    }),
  }, async ({ courseId, courseworkId, account }) => {
    return runOrDiagnose(['classroom', 'coursework', 'delete', pos(courseId), pos(courseworkId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_announcements_update', {
    description: 'Update an existing announcement.' + PUBLISH_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      text: z.string().optional().describe('New text'),
      state: workState.optional().describe('State (PUBLISHED asks the user to confirm; DRAFT does not)'),
      scheduled: z.string().optional().describe('Scheduled publish time (asks the user to confirm)'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, announcementId, text, state, scheduled, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['classroom', 'announcements', 'update', pos(courseId), pos(announcementId)];
    if (text) args.push(`--text=${text}`);
    if (state) args.push(`--state=${state}`);
    if (scheduled) args.push(`--scheduled=${scheduled}`);
    const publishes = publishesWhen(state, scheduled);
    if (publishes) {
      const read = await readCourse(courseId, account, runOrDiagnose);
      if (read.error) return read.error;
      const current = await readClassroomWork('announcements', courseId, announcementId, account, runOrDiagnose);
      if (current.error) return current.error;
      // The text the class will see: the new one when this call replaces it,
      // else what the draft says now.
      const published = text ?? current.work.text;
      const view = {
        course: read.course,
        announcement: { id: announcementId, state: current.work.state },
        publishes,
        textPreview: bodyPreview(published),
      };
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'classroom.announcement-publish',
        message: 'Review and confirm publishing this Classroom announcement to the class:',
        confirmationLabel: 'Confirm that this announcement should be published to the class.',
        details: view,
        unsupportedNote: 'Leave it as a DRAFT; the user can review and publish it from Classroom.',
        fallback: {
          tool: 'gog_classroom_announcements_update',
          account,
          confirmToken,
          subject: () => ({
            target: `${courseId}/${announcementId}`,
            revision: current.work.updateTime,
            payload: { course: read.course, announcementId, text: published, state, scheduled },
            preview: view,
          }),
        },
      });
      if (confirmation) return confirmation;
    }
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_announcements_delete', {
    description: 'Delete an announcement.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      account: accountParam,
    }),
  }, async ({ courseId, announcementId, account }) => {
    return runOrDiagnose(['classroom', 'announcements', 'delete', pos(courseId), pos(announcementId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_topics_create', {
    description: 'Create a topic in a Google Classroom course.',
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      name: z.string().describe('Topic name'),
      account: accountParam,
    }),
  }, async ({ courseId, name, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'create', pos(courseId), `--name=${name}`], { account });
  });

  server.registerTool('gog_classroom_topics_update', {
    description: 'Rename an existing topic.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      topicId: z.string().describe('Topic ID'),
      name: z.string().describe('New topic name'),
      account: accountParam,
    }),
  }, async ({ courseId, topicId, name, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'update', pos(courseId), pos(topicId), `--name=${name}`], { account });
  });

  server.registerTool('gog_classroom_topics_delete', {
    description: 'Delete a topic.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      topicId: z.string().describe('Topic ID'),
      account: accountParam,
    }),
  }, async ({ courseId, topicId, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'delete', pos(courseId), pos(topicId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_classroom_invitations_create', {
    description: 'Create an invitation to a Google Classroom course — Classroom emails the invitee. Reads the course '
      + 'and asks the MCP host to show the user a confirmation prompt with the class, the invitee and the role; '
      + 'nothing is sent unless they accept.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('User ID to invite'),
      role: z.enum(['STUDENT', 'TEACHER', 'OWNER']).describe('Role for the invited user'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, userId, role, account, confirmToken }, ctx) => {
    const read = await readCourse(courseId, account, runOrDiagnose);
    if (read.error) return read.error;
    const invitation = { course: read.course, invitee: userId, role };
    const confirmation = await requireDispatchConfirmation(ctx, {
      action: 'classroom.invitation-create',
      message: role === 'OWNER'
        ? 'Review and confirm this Classroom invitation — it offers OWNERSHIP of the course:'
        : 'Review and confirm this Classroom invitation:',
      confirmationLabel: 'Confirm that this invitation should be sent now.',
      details: invitation,
      unsupportedNote: 'Ask the user to invite them from Classroom.',
      fallback: {
        tool: 'gog_classroom_invitations_create',
        account,
        confirmToken,
        subject: () => ({ target: `${courseId}/${userId}`, payload: invitation, preview: invitation }),
      },
    });
    if (confirmation) return confirmation;
    return runOrDiagnose(['classroom', 'invitations', 'create', pos(courseId), pos(userId), `--role=${role}`], { account });
  });

  server.registerTool('gog_classroom_invitations_delete', {
    description: 'Delete (revoke) a Google Classroom invitation.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    }),
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'delete', pos(invitationId), '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });
}
