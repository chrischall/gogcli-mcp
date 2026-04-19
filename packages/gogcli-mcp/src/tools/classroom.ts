import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

export function registerClassroomTools(server: McpServer): void {
  server.registerTool('gog_classroom_courses_list', {
    description: 'List Google Classroom courses.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      state: z.string().optional().describe('Comma-separated course states (ACTIVE, ARCHIVED, PROVISIONED, DECLINED, SUSPENDED)'),
      teacher: z.string().optional().describe('Filter by teacher user ID'),
      student: z.string().optional().describe('Filter by student user ID'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token for pagination'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ state, teacher, student, max, page, all, account }) => {
    const args = ['classroom', 'courses', 'list'];
    if (state) args.push(`--state=${state}`);
    if (teacher) args.push(`--teacher=${teacher}`);
    if (student) args.push(`--student=${student}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_courses_get', {
    description: 'Get a single Google Classroom course by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    },
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'get', courseId], { account });
  });

  server.registerTool('gog_classroom_courses_create', {
    description: 'Create a new Google Classroom course.',
    inputSchema: {
      name: z.string().describe('Course name'),
      owner: z.string().optional().describe('Owner user ID (default: "me")'),
      section: z.string().optional().describe('Section'),
      descriptionHeading: z.string().optional().describe('Description heading'),
      description: z.string().optional().describe('Description'),
      room: z.string().optional().describe('Room'),
      state: z.string().optional().describe('Course state: ACTIVE, ARCHIVED, PROVISIONED, DECLINED, SUSPENDED'),
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
      owner: z.string().optional().describe('Owner user ID'),
      section: z.string().optional().describe('Section'),
      descriptionHeading: z.string().optional().describe('Description heading'),
      description: z.string().optional().describe('Description'),
      room: z.string().optional().describe('Room'),
      state: z.string().optional().describe('Course state: ACTIVE, ARCHIVED, PROVISIONED, DECLINED, SUSPENDED'),
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
    return runOrDiagnose(['classroom', 'courses', 'delete', courseId], { account });
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
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      account: accountParam,
    },
  }, async ({ courseId, account }) => {
    return runOrDiagnose(['classroom', 'courses', 'unarchive', courseId], { account });
  });

  server.registerTool('gog_classroom_students_list', {
    description: 'List students enrolled in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ courseId, max, page, all, account }) => {
    const args = ['classroom', 'students', 'list', courseId];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_students_get', {
    description: 'Get a specific student enrolled in a course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Student user ID'),
      account: accountParam,
    },
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'students', 'get', courseId, userId], { account });
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
    return runOrDiagnose(['classroom', 'students', 'remove', courseId, userId], { account });
  });

  server.registerTool('gog_classroom_teachers_list', {
    description: 'List teachers in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ courseId, max, page, all, account }) => {
    const args = ['classroom', 'teachers', 'list', courseId];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_teachers_get', {
    description: 'Get a specific teacher in a course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      userId: z.string().describe('Teacher user ID'),
      account: accountParam,
    },
  }, async ({ courseId, userId, account }) => {
    return runOrDiagnose(['classroom', 'teachers', 'get', courseId, userId], { account });
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
    return runOrDiagnose(['classroom', 'teachers', 'remove', courseId, userId], { account });
  });

  server.registerTool('gog_classroom_roster', {
    description: 'List the full roster (students and/or teachers) of a Google Classroom course. Omit both flags to return both groups.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      students: z.boolean().optional().describe('Include students only'),
      teachers: z.boolean().optional().describe('Include teachers only'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ courseId, students, teachers, max, page, all, account }) => {
    const args = ['classroom', 'roster', courseId];
    if (students) args.push('--students');
    if (teachers) args.push('--teachers');
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_list', {
    description: 'List coursework (assignments, questions, materials) for a course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      state: z.string().optional().describe('Filter by coursework state (PUBLISHED, DRAFT, DELETED)'),
      topic: z.string().optional().describe('Filter by topic ID'),
      orderBy: z.string().optional().describe('Sort order (e.g. "updateTime desc")'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      scanPages: z.number().optional().describe('Max pages to scan when filtering'),
      account: accountParam,
    },
  }, async ({ courseId, state, topic, orderBy, max, page, all, scanPages, account }) => {
    const args = ['classroom', 'coursework', 'list', courseId];
    if (state) args.push(`--state=${state}`);
    if (topic) args.push(`--topic=${topic}`);
    if (orderBy) args.push(`--order-by=${orderBy}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    if (scanPages !== undefined) args.push(`--scan-pages=${scanPages}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_coursework_get', {
    description: 'Get a single coursework item by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, account }) => {
    return runOrDiagnose(['classroom', 'coursework', 'get', courseId, courseworkId], { account });
  });

  server.registerTool('gog_classroom_coursework_create', {
    description: 'Create a new coursework item (assignment, question, etc.) in a course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      title: z.string().describe('Coursework title'),
      description: z.string().optional().describe('Description'),
      type: z.string().optional().describe('Work type (ASSIGNMENT, SHORT_ANSWER_QUESTION, MULTIPLE_CHOICE_QUESTION). Default: ASSIGNMENT'),
      state: z.string().optional().describe('State: PUBLISHED or DRAFT'),
      maxPoints: z.number().optional().describe('Max points'),
      due: z.string().optional().describe('Due datetime (combined date+time)'),
      dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      dueTime: z.string().optional().describe('Due time (HH:MM)'),
      scheduled: z.string().optional().describe('Scheduled publish time'),
      topic: z.string().optional().describe('Topic ID'),
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
      description: z.string().optional().describe('New description'),
      type: z.string().optional().describe('Work type'),
      state: z.string().optional().describe('State: PUBLISHED or DRAFT'),
      maxPoints: z.number().optional().describe('Max points'),
      due: z.string().optional().describe('Due datetime'),
      dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      dueTime: z.string().optional().describe('Due time (HH:MM)'),
      scheduled: z.string().optional().describe('Scheduled publish time'),
      topic: z.string().optional().describe('Topic ID'),
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
    return runOrDiagnose(['classroom', 'coursework', 'delete', courseId, courseworkId], { account });
  });

  server.registerTool('gog_classroom_submissions_list', {
    description: 'List student submissions for a coursework item.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      state: z.string().optional().describe('Filter by submission state'),
      late: z.enum(['late', 'not-late']).optional().describe('Filter by late status'),
      user: z.string().optional().describe('Filter by student user ID'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, state, late, user, max, page, all, account }) => {
    const args = ['classroom', 'submissions', 'list', courseId, courseworkId];
    if (state) args.push(`--state=${state}`);
    if (late) args.push(`--late=${late}`);
    if (user) args.push(`--user=${user}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_submissions_get', {
    description: 'Get a single submission by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'get', courseId, courseworkId, submissionId], { account });
  });

  server.registerTool('gog_classroom_submissions_grade', {
    description: 'Grade a student submission. Set draft and/or assigned grade values.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      draft: z.string().optional().describe('Draft grade value'),
      assigned: z.string().optional().describe('Assigned (final) grade value'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, submissionId, draft, assigned, account }) => {
    const args = ['classroom', 'submissions', 'grade', courseId, courseworkId, submissionId];
    if (draft) args.push(`--draft=${draft}`);
    if (assigned) args.push(`--assigned=${assigned}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_submissions_return', {
    description: 'Return a graded submission to the student.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'return', courseId, courseworkId, submissionId], { account });
  });

  server.registerTool('gog_classroom_submissions_turn_in', {
    description: 'Turn in a student submission (student action).',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'turn-in', courseId, courseworkId, submissionId], { account });
  });

  server.registerTool('gog_classroom_submissions_reclaim', {
    description: 'Reclaim a turned-in submission (student action to edit a submission).',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      courseworkId: z.string().describe('Coursework ID'),
      submissionId: z.string().describe('Submission ID'),
      account: accountParam,
    },
  }, async ({ courseId, courseworkId, submissionId, account }) => {
    return runOrDiagnose(['classroom', 'submissions', 'reclaim', courseId, courseworkId, submissionId], { account });
  });

  server.registerTool('gog_classroom_announcements_list', {
    description: 'List announcements in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      state: z.string().optional().describe('Filter by announcement state'),
      orderBy: z.string().optional().describe('Sort order'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ courseId, state, orderBy, max, page, all, account }) => {
    const args = ['classroom', 'announcements', 'list', courseId];
    if (state) args.push(`--state=${state}`);
    if (orderBy) args.push(`--order-by=${orderBy}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_announcements_get', {
    description: 'Get a single announcement by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      account: accountParam,
    },
  }, async ({ courseId, announcementId, account }) => {
    return runOrDiagnose(['classroom', 'announcements', 'get', courseId, announcementId], { account });
  });

  server.registerTool('gog_classroom_announcements_create', {
    description: 'Create an announcement in a Google Classroom course.',
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      text: z.string().describe('Announcement text'),
      state: z.string().optional().describe('State: PUBLISHED or DRAFT'),
      scheduled: z.string().optional().describe('Scheduled publish time'),
      account: accountParam,
    },
  }, async ({ courseId, text, state, scheduled, account }) => {
    const args = ['classroom', 'announcements', 'create', courseId, `--text=${text}`];
    if (state) args.push(`--state=${state}`);
    if (scheduled) args.push(`--scheduled=${scheduled}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_announcements_update', {
    description: 'Update an existing announcement.',
    annotations: { destructiveHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      announcementId: z.string().describe('Announcement ID'),
      text: z.string().optional().describe('New text'),
      state: z.string().optional().describe('State: PUBLISHED or DRAFT'),
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
    return runOrDiagnose(['classroom', 'announcements', 'delete', courseId, announcementId], { account });
  });

  server.registerTool('gog_classroom_topics_list', {
    description: 'List topics in a Google Classroom course.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ courseId, max, page, all, account }) => {
    const args = ['classroom', 'topics', 'list', courseId];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_topics_get', {
    description: 'Get a single topic by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      courseId: z.string().describe('Course ID'),
      topicId: z.string().describe('Topic ID'),
      account: accountParam,
    },
  }, async ({ courseId, topicId, account }) => {
    return runOrDiagnose(['classroom', 'topics', 'get', courseId, topicId], { account });
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
    return runOrDiagnose(['classroom', 'topics', 'delete', courseId, topicId], { account });
  });

  server.registerTool('gog_classroom_invitations_list', {
    description: 'List Google Classroom invitations.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      course: z.string().optional().describe('Filter by course ID'),
      user: z.string().optional().describe('Filter by user ID'),
      max: z.number().optional().describe('Max results per page'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ course, user, max, page, all, account }) => {
    const args = ['classroom', 'invitations', 'list'];
    if (course) args.push(`--course=${course}`);
    if (user) args.push(`--user=${user}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_invitations_get', {
    description: 'Get a single invitation by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    },
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'get', invitationId], { account });
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

  server.registerTool('gog_classroom_invitations_accept', {
    description: 'Accept a Google Classroom invitation.',
    inputSchema: {
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    },
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'accept', invitationId], { account });
  });

  server.registerTool('gog_classroom_invitations_delete', {
    description: 'Delete (revoke) a Google Classroom invitation.',
    annotations: { destructiveHint: true },
    inputSchema: {
      invitationId: z.string().describe('Invitation ID'),
      account: accountParam,
    },
  }, async ({ invitationId, account }) => {
    return runOrDiagnose(['classroom', 'invitations', 'delete', invitationId], { account });
  });

  server.registerTool('gog_classroom_profile_get', {
    description: 'Get a Google Classroom user profile. Omit userId to fetch the authenticated user.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().optional().describe('User ID (omit for self)'),
      account: accountParam,
    },
  }, async ({ userId, account }) => {
    const args = ['classroom', 'profile', 'get'];
    if (userId) args.push(userId);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_classroom_run', {
    description: 'Run any gog classroom subcommand not covered by the other tools (guardians, guardian-invitations, materials, coursework assignees, announcement assignees, etc.). Run `gog classroom --help` for the full list, or `gog classroom <subcommand> --help` for flags.',
    inputSchema: {
      subcommand: z.string().describe('The gog classroom subcommand to run, e.g. "guardians", "materials", "guardian-invitations"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['classroom', subcommand, ...args], { account });
  });
}
