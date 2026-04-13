import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

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
    description: 'Create a calendar event.',
    annotations: { destructiveHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID (use "primary" for the default calendar)'),
      summary: z.string().describe('Event title'),
      from: z.string().describe('Start time (RFC3339 or date for all-day events)'),
      to: z.string().describe('End time (RFC3339 or date for all-day events)'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      attendees: z.string().optional().describe('Attendee emails, comma-separated'),
      allDay: z.boolean().optional().describe('All-day event (use date-only in from/to)'),
      account: accountParam,
    },
  }, async ({ calendarId, summary, from, to, description, location, attendees, allDay, account }) => {
    const args = ['calendar', 'create', calendarId, `--summary=${summary}`, `--from=${from}`, `--to=${to}`];
    if (description) args.push(`--description=${description}`);
    if (location) args.push(`--location=${location}`);
    if (attendees) args.push(`--attendees=${attendees}`);
    if (allDay) args.push('--all-day');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_update', {
    description: 'Update an existing calendar event.',
    annotations: { destructiveHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      summary: z.string().optional().describe('New event title'),
      from: z.string().optional().describe('New start time (RFC3339)'),
      to: z.string().optional().describe('New end time (RFC3339)'),
      description: z.string().optional().describe('New description'),
      location: z.string().optional().describe('New location'),
      attendees: z.string().optional().describe('New attendee emails, comma-separated (replaces existing)'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, summary, from, to, description, location, attendees, account }) => {
    const args = ['calendar', 'update', calendarId, eventId];
    if (summary !== undefined) args.push(`--summary=${summary}`);
    if (from !== undefined) args.push(`--from=${from}`);
    if (to !== undefined) args.push(`--to=${to}`);
    if (description !== undefined) args.push(`--description=${description}`);
    if (location !== undefined) args.push(`--location=${location}`);
    if (attendees !== undefined) args.push(`--attendees=${attendees}`);
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

  server.registerTool('gog_calendar_run', {
    description: 'Run any gog calendar subcommand not covered by the other tools. Run `gog calendar --help` for the full list of subcommands, or `gog calendar <subcommand> --help` for flags on a specific subcommand.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog calendar subcommand to run, e.g. "calendars", "freebusy"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['calendar', subcommand, ...args], { account });
  });
}
