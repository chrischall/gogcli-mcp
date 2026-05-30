import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

const meetAccess = z.enum(['open', 'trusted', 'restricted']);

// Meet spaces are the conferencing surface attached to calendar events,
// so they live in the calendar sub-package.
export function registerExtraCalendarTools(server: McpServer): void {
  server.registerTool('gog_meet_create', {
    description: 'Create a Google Meet space and return its meeting code.',
    inputSchema: {
      access: meetAccess.optional().describe('Access type (default: trusted)'),
      open: z.boolean().optional().describe('Open the meeting in a browser after creation'),
      account: accountParam,
    },
  }, async ({ access, open, account }) => {
    const args = ['meet', 'create'];
    if (access) args.push(`--access=${access}`);
    if (open) args.push('--open');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_meet_get', {
    description: 'Get a Google Meet space by its meeting code.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      meetingCode: z.string().describe('Meeting code (e.g. abc-defg-hij)'),
      account: accountParam,
    },
  }, async ({ meetingCode, account }) => {
    return runOrDiagnose(['meet', 'get', meetingCode], { account });
  });

  server.registerTool('gog_meet_update', {
    description: 'Update a Google Meet space configuration.',
    annotations: { destructiveHint: true },
    inputSchema: {
      meetingCode: z.string().describe('Meeting code'),
      access: meetAccess.optional().describe('Access type'),
      account: accountParam,
    },
  }, async ({ meetingCode, access, account }) => {
    const args = ['meet', 'update', meetingCode];
    if (access) args.push(`--access=${access}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_meet_end', {
    description: 'End the active conference in a Google Meet space.',
    annotations: { destructiveHint: true },
    inputSchema: {
      meetingCode: z.string().describe('Meeting code'),
      account: accountParam,
    },
  }, async ({ meetingCode, account }) => {
    return runOrDiagnose(['meet', 'end', meetingCode], { account });
  });

  server.registerTool('gog_meet_history', {
    description: 'List past calls (conferences) in a Google Meet space.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      meetingCode: z.string().describe('Meeting code'),
      max: z.number().optional().describe('Max results (default: 20)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ meetingCode, max, page, all, account }) => {
    const args = ['meet', 'history', meetingCode];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  // Zoom S2S OAuth credentials are scoped to Zoom-as-calendar-conferencing
  // today (the `--with-zoom` flag on calendar create/update), so the auth
  // helpers live in the calendar extras alongside meet space management.
  server.registerTool('gog_zoom_auth_setup', {
    description: 'Store Zoom Server-to-Server (S2S) OAuth credentials so calendar events can be attached to Zoom meetings via the --with-zoom flag on gog_calendar_create / gog_calendar_update. Credentials are saved in gogcli\'s keyring under the given alias.',
    annotations: { destructiveHint: true },
    inputSchema: {
      accountId: z.string().describe('Zoom S2S OAuth account ID'),
      clientId: z.string().describe('Zoom S2S OAuth client ID'),
      clientSecret: z.string().describe('Zoom S2S OAuth client secret'),
      alias: z.string().optional().describe('Zoom credential alias (default: "default")'),
      skipValidate: z.boolean().optional().describe('Store credentials without calling Zoom /users/me to validate'),
    },
  }, async ({ accountId, clientId, clientSecret, alias, skipValidate }) => {
    const args = ['zoom', 'auth', 'setup'];
    if (alias) args.push(`--alias=${alias}`);
    args.push(`--account-id=${accountId}`);
    args.push(`--client-id=${clientId}`);
    args.push(`--client-secret=${clientSecret}`);
    if (skipValidate) args.push('--skip-validate');
    return runOrDiagnose(args, {});
  });

  server.registerTool('gog_zoom_auth_doctor', {
    description: 'Validate stored Zoom S2S OAuth credentials by calling Zoom /users/me.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      alias: z.string().optional().describe('Zoom credential alias to check (default: "default")'),
    },
  }, async ({ alias }) => {
    const args = ['zoom', 'auth', 'doctor'];
    if (alias) args.push(`--alias=${alias}`);
    return runOrDiagnose(args, {});
  });

  // --- gog 0.19.0 calendar reads & CRUD ---

  server.registerTool('gog_calendar_calendars', {
    description: 'List the calendars in your calendar list (id, summary, access role, primary flag).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ max, page, all, account }) => {
    const args = ['calendar', 'calendars'];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_search', {
    description: 'Full-text search for events matching a query string, with optional time filters.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Search query'),
      from: z.string().optional().describe('Start time (RFC3339, date, or relative: now, today, tomorrow, monday)'),
      to: z.string().optional().describe('End time (RFC3339, date, or relative: now, today, tomorrow, monday)'),
      today: z.boolean().optional().describe('Today only'),
      tomorrow: z.boolean().optional().describe('Tomorrow only'),
      week: z.boolean().optional().describe('This week (uses weekStart, default Mon)'),
      days: z.number().optional().describe('Next N days'),
      weekStart: z.string().optional().describe('Week start day for week (sun, mon, ...)'),
      calendar: z.string().optional().describe('Calendar ID (default: primary)'),
      max: z.number().optional().describe('Max results (default: 25)'),
      account: accountParam,
    },
  }, async ({ query, from, to, today, tomorrow, week, days, weekStart, calendar, max, account }) => {
    const args = ['calendar', 'search', query];
    if (from) args.push(`--from=${from}`);
    if (to) args.push(`--to=${to}`);
    if (today) args.push('--today');
    if (tomorrow) args.push('--tomorrow');
    if (week) args.push('--week');
    if (days !== undefined) args.push(`--days=${days}`);
    if (weekStart) args.push(`--week-start=${weekStart}`);
    if (calendar) args.push(`--calendar=${calendar}`);
    if (max !== undefined) args.push(`--max=${max}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_freebusy', {
    description: 'Query free/busy intervals for one or more calendars over a time window.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      from: z.string().describe('Start time (RFC3339, required)'),
      to: z.string().describe('End time (RFC3339, required)'),
      calendarIds: z.string().optional().describe('Comma-separated calendar IDs, names, or indices'),
      all: z.boolean().optional().describe('Query all calendars'),
      account: accountParam,
    },
  }, async ({ from, to, calendarIds, all, account }) => {
    const args = ['calendar', 'freebusy'];
    if (calendarIds) args.push(calendarIds);
    args.push(`--from=${from}`);
    args.push(`--to=${to}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_colors', {
    description: 'Show the available calendar and event color palette (color IDs to hex values).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['calendar', 'colors'], { account });
  });

  server.registerTool('gog_calendar_acl', {
    description: 'List the access control list (sharing rules) for a calendar.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ calendarId, max, page, all, account }) => {
    const args = ['calendar', 'acl', calendarId];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_move', {
    description: 'Move an event from one calendar to another; the destination calendar becomes the organizer.',
    inputSchema: {
      calendarId: z.string().describe('Source calendar ID'),
      eventId: z.string().describe('Event ID'),
      destinationCalendarId: z.string().describe('Destination calendar ID that becomes the event organizer'),
      sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().describe('Notification mode (default: none)'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, destinationCalendarId, sendUpdates, account }) => {
    const args = ['calendar', 'move', calendarId, eventId, destinationCalendarId];
    if (sendUpdates) args.push(`--send-updates=${sendUpdates}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_out_of_office', {
    description: 'Create an Out of Office event that auto-declines invitations during the block.',
    inputSchema: {
      from: z.string().describe('Start date or datetime (RFC3339 or YYYY-MM-DD)'),
      to: z.string().describe('End date or datetime (RFC3339 or YYYY-MM-DD)'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      summary: z.string().optional().describe('Out of office title (default: "Out of office")'),
      autoDecline: z.enum(['none', 'all', 'new']).optional().describe('Auto-decline mode (default: all)'),
      declineMessage: z.string().optional().describe('Message for declined invitations'),
      allDay: z.boolean().optional().describe('Create as an all-day event'),
      account: accountParam,
    },
  }, async ({ from, to, calendarId, summary, autoDecline, declineMessage, allDay, account }) => {
    const args = ['calendar', 'out-of-office'];
    if (calendarId) args.push(calendarId);
    args.push(`--from=${from}`);
    args.push(`--to=${to}`);
    if (summary) args.push(`--summary=${summary}`);
    if (autoDecline) args.push(`--auto-decline=${autoDecline}`);
    if (declineMessage) args.push(`--decline-message=${declineMessage}`);
    if (allDay) args.push('--all-day');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_meet_participants', {
    description: 'List participants from the latest (or a specific) Meet call.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      meetingCode: z.string().describe('Meeting code'),
      conference: z.string().optional().describe('Specific conference ID (default: most recent)'),
      max: z.number().optional().describe('Max results (default: 50)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ meetingCode, conference, max, page, all, account }) => {
    const args = ['meet', 'participants', meetingCode];
    if (conference) args.push(`--conference=${conference}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });
}
