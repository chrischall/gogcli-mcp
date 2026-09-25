import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  accountParam,
  runOrDiagnose,
  pos,
  readCourse,
  readCoursework,
  readClassroomWork,
  requireDispatchConfirmation,
  bodyPreview,
  CONFIRM_FALLBACK_DESCRIPTION,
  confirmTokenParam,
} from '../../../gogcli-mcp/src/lib.js';
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
    description: 'Delete a Google Classroom course — its coursework, submissions and grades go with it, for good. Reads '
      + 'the course and asks the MCP host to show the user a confirmation prompt naming it first; nothing is deleted '
      + 'unless they accept. gog_classroom_courses_archive is the reversible alternative.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, account, confirmToken }, ctx) => {
    const read = await readCourse(courseId, account, runOrDiagnose);
    if (read.error) return read.error;
    const view = { course: read.course, deletes: 'the course with all of its coursework, submissions and grades, for good' };
    const confirmation = await requireDispatchConfirmation(ctx, {
      action: 'classroom.course-delete',
      message: 'Review and confirm PERMANENTLY deleting this course:',
      confirmationLabel: 'Confirm that this course should be deleted now.',
      details: view,
      unsupportedNote: 'Archive it with gog_classroom_courses_archive instead, or ask the user to delete it from Classroom.',
      fallback: {
        tool: 'gog_classroom_courses_delete',
        account,
        confirmToken,
        subject: () => ({ target: courseId, payload: view, preview: view }),
      },
    });
    if (confirmation) return confirmation;
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
    description: 'Add a student to a Google Classroom course. Adding someone else gives them the class stream and '
      + 'materials, so this reads the course and asks the MCP host to show the user a confirmation prompt with the class '
      + 'and the student first; enrolling yourself ("me") does not ask.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID or email (or "me")'),
      enrollmentCode: z.string().optional().describe('Enrollment code (required if adding self via code)'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, userId, enrollmentCode, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['classroom', 'students', 'add', pos(courseId), pos(userId)];
    if (enrollmentCode) args.push(`--enrollment-code=${enrollmentCode}`);
    if (userId.toLowerCase() !== 'me') {
      const read = await readCourse(courseId, account, runOrDiagnose);
      if (read.error) return read.error;
      const view = { course: read.course, student: userId };
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'classroom.student-add',
        message: 'Review and confirm adding this student to the class:',
        confirmationLabel: 'Confirm that this person should be added to the class now.',
        details: view,
        unsupportedNote: 'Ask the user to add them from Classroom, or invite them with gog_classroom_invitations_create.',
        fallback: {
          tool: 'gog_classroom_students_add',
          account,
          confirmToken,
          subject: () => ({ target: `${courseId}/${userId}`, payload: view, preview: view }),
        },
      });
      if (confirmation) return confirmation;
    }
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
    description: 'Add a teacher to a Google Classroom course. A co-teacher sees every student\'s work and grades, so '
      + 'this reads the course and asks the MCP host to show the user a confirmation prompt with the class and the '
      + 'teacher first; nothing changes unless they accept.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID or email'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, userId, account, confirmToken }, ctx) => {
    const read = await readCourse(courseId, account, runOrDiagnose);
    if (read.error) return read.error;
    const view = { course: read.course, teacher: userId, grants: 'teacher access: every student\'s work, grades and roster' };
    const confirmation = await requireDispatchConfirmation(ctx, {
      action: 'classroom.teacher-add',
      message: 'Review and confirm giving this person teacher access to the class:',
      confirmationLabel: 'Confirm that this person should become a teacher of the class now.',
      details: view,
      unsupportedNote: 'Ask the user to add them from Classroom, or invite them with gog_classroom_invitations_create.',
      fallback: {
        tool: 'gog_classroom_teachers_add',
        account,
        confirmToken,
        subject: () => ({ target: `${courseId}/${userId}`, payload: view, preview: view }),
      },
    });
    if (confirmation) return confirmation;
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
    description: 'Create a new coursework item (assignment, question, etc.) in a course. Unless state is DRAFT with no '
      + 'scheduled time (which students cannot see; a scheduled draft publishes itself), the class is notified, so this '
      + 'reads the course and asks the MCP host to show the user a confirmation prompt with the class, the title, the '
      + 'text, the due date and when it publishes; nothing is posted unless they accept. To stage one without asking, '
      + 'pass state DRAFT and no scheduled time.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      title: z.string().describe('Coursework title'),
      ...courseworkSharedFields,
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, title, description, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic, account, confirmToken }, ctx) => {
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
    // An unscheduled draft reaches nobody until a teacher publishes it; a
    // scheduled one publishes itself.
    if (state !== 'DRAFT' || scheduled) {
      const read = await readCourse(courseId, account, runOrDiagnose);
      if (read.error) return read.error;
      const work = {
        course: read.course,
        title,
        type: type ?? 'ASSIGNMENT',
        publishes: scheduled ? `at ${scheduled}` : 'immediately',
        due: due ?? ([dueDate, dueTime].filter(Boolean).join(' ') || undefined),
        maxPoints,
      };
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'classroom.coursework-create',
        message: 'Review and confirm posting this coursework to the class:',
        confirmationLabel: 'Confirm that this coursework should be posted to the class.',
        details: { ...work, descriptionPreview: bodyPreview(description) },
        unsupportedNote: 'Create it with state DRAFT instead; the user can review and post it from Classroom.',
        fallback: {
          tool: 'gog_classroom_coursework_create',
          account,
          confirmToken,
          subject: () => {
            const view = { ...work, description };
            return { target: courseId, payload: view, preview: view };
          },
        },
      });
      if (confirmation) return confirmation;
    }
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
      // What the class will see: the new title/description when this call
      // replaces them, else what the draft says now. `||`, not `??`: an empty
      // string is never sent (the argv guards above are truthy checks), so gog
      // keeps the current value and the prompt must show that one.
      const published = description || current.work.description;
      const publishedTitle = title || current.work.title;
      const view = {
        course: read.course,
        coursework: { id: courseworkId, title: publishedTitle, state: current.work.state },
        publishes,
        descriptionPreview: bodyPreview(published),
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
            payload: { course: read.course, courseworkId, title: publishedTitle, description: published, type, state, maxPoints, due, dueDate, dueTime, scheduled, topic },
            preview: view,
          }),
        },
      });
      if (confirmation) return confirmation;
    }
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_delete', {
    description: 'Delete a coursework item — every student submission to it goes too, for good. Reads the course and '
      + 'the coursework and asks the MCP host to show the user a confirmation prompt naming both first; nothing is '
      + 'deleted unless they accept.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ courseId, courseworkId, account, confirmToken }, ctx) => {
    const course = await readCourse(courseId, account, runOrDiagnose);
    if (course.error) return course.error;
    const work = await readCoursework(courseId, courseworkId, account, runOrDiagnose);
    if (work.error) return work.error;
    const view = { course: course.course, coursework: work.coursework, deletes: 'the coursework and every student submission to it, for good' };
    const confirmation = await requireDispatchConfirmation(ctx, {
      action: 'classroom.coursework-delete',
      message: 'Review and confirm PERMANENTLY deleting this coursework and its submissions:',
      confirmationLabel: 'Confirm that this coursework should be deleted now.',
      details: view,
      unsupportedNote: 'Ask the user to delete it from Classroom.',
      fallback: {
        tool: 'gog_classroom_coursework_delete',
        account,
        confirmToken,
        subject: () => ({ target: `${courseId}/${courseworkId}`, payload: view, preview: view }),
      },
    });
    if (confirmation) return confirmation;
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
      // else what the draft says now. `||`, not `??`: an empty --text is never
      // sent, so gog keeps the current text.
      const published = text || current.work.text;
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
