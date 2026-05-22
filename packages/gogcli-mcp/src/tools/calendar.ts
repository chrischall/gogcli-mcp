import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool } from './utils.js';

export function registerCalendarTools(server: McpServer): void {
  server.registerTool('gog_calendar_events', {
    description: 'List calendar events. Filters can be combined (e.g. --from + --to for a range, or --today for just today).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      calendarId: z.string().optional().describe('Calendar ID (default: primary calendar)'),
      from: z.string().optional().describe('Start time filter (RFC3339, date, or natural language)'),
      to: z.string().optional().describe('End time filter (RFC3339, date, or natural language)'),
      today: z.boolean().optional().describe('Only show today\'s events'),
      query: z.string().optional().describe('Free text search within events'),
      all: z.boolean().optional().describe('Fetch events from all calendars'),
      account: accountParam,
    },
  }, async ({ calendarId, from, to, today, query, all, account }) => {
    const args = ['calendar', 'events'];
    if (calendarId) args.push(calendarId);
    if (from) args.push(`--from=${from}`);
    if (to) args.push(`--to=${to}`);
    if (today) args.push('--today');
    if (query) args.push(`--query=${query}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_get', {
    description: 'Get a specific calendar event by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, account }) => {
    return runOrDiagnose(['calendar', 'event', calendarId, eventId], { account });
  });

  server.registerTool('gog_calendar_create', {
    description: 'Create a calendar event. Set withZoom=true to attach a Zoom meeting (requires Zoom S2S OAuth setup via gog_zoom_auth_setup; the join URL + meeting ID + passcode are appended to the event description — Google rejects native conference card writes from non-Workspace-Marketplace OAuth clients).',
    annotations: { destructiveHint: false },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID (use "primary" for the default calendar)'),
      summary: z.string().describe('Event title'),
      from: z.string().describe('Start time (RFC3339 or date for all-day events)'),
      to: z.string().describe('End time (RFC3339 or date for all-day events)'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      attendees: z.string().optional().describe('Attendee emails, comma-separated'),
      allDay: z.boolean().optional().describe('All-day event (use date-only in from/to)'),
      withZoom: z.boolean().optional().describe('Create a Zoom video conference for this event (requires Zoom S2S OAuth setup)'),
      account: accountParam,
    },
  }, async ({ calendarId, summary, from, to, description, location, attendees, allDay, withZoom, account }) => {
    const args = ['calendar', 'create', calendarId, `--summary=${summary}`, `--from=${from}`, `--to=${to}`];
    if (description) args.push(`--description=${description}`);
    if (location) args.push(`--location=${location}`);
    if (attendees) args.push(`--attendees=${attendees}`);
    if (allDay) args.push('--all-day');
    if (withZoom) args.push('--with-zoom');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_update', {
    description: 'Update an existing calendar event. Zoom: withZoom adds a Zoom meeting, regenerateZoom replaces the existing one, removeZoom strips it (each are independent — use one per call).',
    annotations: { destructiveHint: false },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      summary: z.string().optional().describe('New event title'),
      from: z.string().optional().describe('New start time (RFC3339)'),
      to: z.string().optional().describe('New end time (RFC3339)'),
      description: z.string().optional().describe('New description'),
      location: z.string().optional().describe('New location'),
      attendees: z.string().optional().describe('New attendee emails, comma-separated (replaces existing)'),
      withZoom: z.boolean().optional().describe('Create a Zoom video conference for this event'),
      regenerateZoom: z.boolean().optional().describe('Replace the event\'s existing Zoom video conference'),
      removeZoom: z.boolean().optional().describe('Remove the event\'s Zoom video conference'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, summary, from, to, description, location, attendees, withZoom, regenerateZoom, removeZoom, account }) => {
    const args = ['calendar', 'update', calendarId, eventId];
    if (summary !== undefined) args.push(`--summary=${summary}`);
    if (from !== undefined) args.push(`--from=${from}`);
    if (to !== undefined) args.push(`--to=${to}`);
    if (description !== undefined) args.push(`--description=${description}`);
    if (location !== undefined) args.push(`--location=${location}`);
    if (attendees !== undefined) args.push(`--attendees=${attendees}`);
    if (withZoom) args.push('--with-zoom');
    if (regenerateZoom) args.push('--regenerate-zoom');
    if (removeZoom) args.push('--remove-zoom');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_delete', {
    description: 'Delete a calendar event.',
    annotations: { destructiveHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, account }) => {
    return runOrDiagnose(['calendar', 'delete', calendarId, eventId], { account });
  });

  server.registerTool('gog_calendar_respond', {
    description: 'Respond to a calendar event invitation.',
    annotations: { destructiveHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      status: z.enum(['accepted', 'declined', 'tentative']).describe('Response status'),
      comment: z.string().optional().describe('Optional comment to include with response'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, status, comment, account }) => {
    const args = ['calendar', 'respond', calendarId, eventId, `--status=${status}`];
    if (comment) args.push(`--comment=${comment}`);
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, { service: 'calendar', examples: '"calendars", "freebusy"' });
}
