import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { viewParam, resolveView } from '@chrischall/mcp-utils';
import { accountParam, runOrDiagnose, registerRunTool, pageTokenParam, pageAliasParam, resolvePageToken } from './utils.js';
import { annotateTruncatedList } from '../pagination.js';

// Reminder params, shared by create and update (gog >= 0.38.0 for
// --no-reminders). An event's reminders are one of THREE states, and the two
// params below have to spell all three because gog does:
//
//   reminders: ['popup:30m']  →  --reminder=popup:30m   custom overrides
//   noReminders: true         →  --no-reminders         no reminder at all
//   reminders: []             →  --reminder=            back to the calendar's defaults
//
// That last one is the subtle one and it only means anything on update: gog
// reads an EMPTY --reminder as "clear the overrides and use the calendar
// default" (openclaw/gogcli#1016), which is a different outcome from omitting
// the flag (leave whatever the event already has) and from --no-reminders
// (override the calendar with silence). An empty array is how a JSON caller
// says it, since there is no way to send a bare flag with no value.
const reminderParams = {
  reminders: z.array(z.string()).max(5).optional().describe(
    'Reminders as method:duration, e.g. ["popup:30m", "email:1d"]. Method is popup or email; duration accepts m/h/d '
    + '(max 40320 minutes = 4 weeks). Google allows at most 5. These REPLACE the event\'s reminders — on update, pass an '
    + 'EMPTY array to drop custom reminders and go back to the calendar\'s defaults. Cannot be combined with noReminders.',
  ),
  noReminders: z.boolean().optional().describe(
    'Give the event no reminders at all, overriding the calendar\'s defaults. Different from an empty reminders array, '
    + 'which RESTORES those defaults. Cannot be combined with reminders.',
  ),
};

// The one place the three states become argv. Kept together so create and
// update cannot drift apart on the empty-array case.
function pushReminderFlags(
  args: string[],
  p: { reminders?: string[]; noReminders?: boolean },
): void {
  if (p.noReminders) {
    // gog's own flags are `xor:"reminders"`, so it would reject this too — but
    // only after a spawn, and with kong's wording rather than the tool's.
    if (p.reminders !== undefined) {
      throw new Error('reminders and noReminders are mutually exclusive: pass reminders to set custom ones, noReminders for none, or an empty reminders array to restore the calendar defaults.');
    }
    args.push('--no-reminders');
    return;
  }
  if (p.reminders === undefined) return;
  // Empty array → one empty --reminder, which is gog's "restore defaults".
  if (p.reminders.length === 0) {
    args.push('--reminder=');
    return;
  }
  for (const reminder of p.reminders) args.push(`--reminder=${reminder}`);
}


// The `compact` rung for gog_calendar_events, as a Google Calendar field mask.
//
// nextPageToken FIRST and always. This tool's own description tells a caller
// that a wide range is usually incomplete and to page until the cursor is gone;
// a mask of `items(...)` alone drops that cursor from the envelope, which would
// turn that instruction into a guarantee of the wrong answer. Verified live
// against gog 0.39.0.
//
// Chosen from the DATA over a 25-event window: description costs 5,951 bytes
// and attendees 3,145 — the two fat blobs `full` exists to return — while etag,
// kind, iCalUID, eventType, timezone, guestsCanInviteOthers and privateCopy are
// internal or single-valued across every row. Net: 21,260 -> 7,292 bytes, 66%
// smaller. status is kept despite being single-valued in that sample precisely
// because its whole value is flagging the rare cancelled event.
//
// gog's derived fields (startLocal, endDayOfWeek, ...) survive the mask, since
// gog computes them from start/end, which the mask keeps.
export const CALENDAR_EVENTS_COMPACT_FIELDS =
  'nextPageToken,items(id,summary,start,end,location,status,htmlLink)';

export function registerCalendarTools(server: McpServer): void {
  server.registerTool('gog_calendar_events', {
    description: 'List calendar events. Describe the window ONE way and one way only (gog >= 0.36.0 rejects the rest as ambiguous rather than silently discarding a flag): '
      + 'today on its own; or from + to; or from + days; or days on its own (a window of that many days starting today). today cannot be combined with from, to or days, and days cannot be combined with to. '
      + 'gog returns only 10 events by default, so a wide date range is USUALLY INCOMPLETE: raise max, or page with pageToken until the response carries no nextPageToken. '
      + 'A response carrying "truncated": true is an incomplete view — never conclude an event does not exist from one.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      calendarId: z.string().optional().describe('Calendar ID (default: primary calendar)'),
      from: z.string().optional().describe('Start time filter (RFC3339, date, or natural language)'),
      to: z.string().optional().describe('End time filter (RFC3339, date, or natural language). Mutually exclusive with today and with days.'),
      // gog >= 0.36.0 (openclaw/gogcli#981). Before that release --days sat in
      // a switch arm evaluated ahead of --from, so `--from 2026-09-25 --days 5`
      // silently threw --from away and answered for today instead — at exit 0,
      // in a well-formed table. It is only exposed here now that it means what
      // it says.
      days: z.number().int().positive().optional().describe('Window LENGTH in days (calendar days, DST-aware), measured from `from` when one is given and from today otherwise. Use from + days for "the week of the 25th"; days alone for "the next N days". Mutually exclusive with to and with today.'),
      today: z.boolean().optional().describe('Only show today\'s events. A complete window on its own — mutually exclusive with from, to and days.'),
      query: z.string().optional().describe('Free text search within events'),
      max: z.number().int().optional().describe('Max events to return. gog defaults to 10, which silently hides the rest — raise it, or page with pageToken.'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      all: z.boolean().optional().describe('Fetch events from ALL CALENDARS. NOTE: unlike the gmail search tools, this does NOT mean "all pages" — it widens the calendar set, not the page window. Use pageToken to reach later pages.'),
      eventTypes: z.array(z.enum(['default', 'birthday', 'focus-time', 'from-gmail', 'out-of-office', 'working-location'])).optional().describe('Filter to specific event types (repeatable)'),
      timezone: z.string().optional().describe('Display timezone for event times (IANA name, e.g. America/New_York, or "local" for the system timezone). Default: each event\'s timezone, then its calendar\'s timezone.'),
      view: viewParam(['compact', 'full'], {
        note: 'compact (the default) drops description and attendees — together two thirds of a '
          + 'listing\'s bytes — plus etag/iCalUID/kind. Ask for full when you need a body or a guest list.',
      }),
      account: accountParam,
    },
  }, async ({ calendarId, from, to, days, today, query, max, pageToken, page, all, eventTypes, timezone, view, account }) => {
    const args = ['calendar', 'events'];
    if (calendarId) args.push(calendarId);
    if (from) args.push(`--from=${from}`);
    if (to) args.push(`--to=${to}`);
    if (days !== undefined) args.push(`--days=${days}`);
    if (today) args.push('--today');
    if (query) args.push(`--query=${query}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (all) args.push('--all');
    if (eventTypes) for (const t of eventTypes) args.push(`--event-types=${t}`);
    if (timezone) args.push(`--timezone=${timezone}`);
    const rung = resolveView(view, ['compact', 'full']);
    const result = await runOrDiagnose(args, {
      account,
      fieldsMask: rung === 'compact' ? CALENDAR_EVENTS_COMPACT_FIELDS : undefined,
    });
    // No count probe here: unlike Gmail's list endpoints, the Calendar API has
    // no cheap way to count a range exactly, so the warning carries the fact of
    // truncation without inventing a total.
    return annotateTruncatedList(result, 'events');
  });

  server.registerTool('gog_calendar_get', {
    description: 'Get a specific calendar event by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      timezone: z.string().optional().describe('Display timezone for event times (IANA name, e.g. America/New_York, or "local" for the system timezone). Default: the event\'s timezone, then its calendar\'s timezone.'),
      account: accountParam,
    },
  }, async ({ calendarId, eventId, timezone, account }) => {
    const args = ['calendar', 'event', calendarId, eventId];
    if (timezone) args.push(`--timezone=${timezone}`);
    return runOrDiagnose(args, { account });
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
      attendees: z.string().optional().describe('Attendee emails, comma-separated. Per-attendee modifiers (gog >= 0.31.1 for ;resource): ;optional, ;resource (e.g. meeting rooms), ;comment=TEXT'),
      allDay: z.boolean().optional().describe('All-day event (use date-only in from/to)'),
      timezone: z.string().optional().describe('IANA timezone metadata applied to from/to (e.g. America/New_York). Sets both start and end timezone unless start/end timezone are overridden.'),
      withZoom: z.boolean().optional().describe('Create a Zoom video conference for this event (requires Zoom S2S OAuth setup)'),
      ...reminderParams,
      account: accountParam,
    },
  }, async ({ calendarId, summary, from, to, description, location, attendees, allDay, timezone, withZoom, reminders, noReminders, account }) => {
    const args = ['calendar', 'create', calendarId, `--summary=${summary}`, `--from=${from}`, `--to=${to}`];
    if (description) args.push(`--description=${description}`);
    if (location) args.push(`--location=${location}`);
    if (attendees) args.push(`--attendees=${attendees}`);
    if (allDay) args.push('--all-day');
    if (timezone) args.push(`--timezone=${timezone}`);
    if (withZoom) args.push('--with-zoom');
    pushReminderFlags(args, { reminders, noReminders });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_calendar_update', {
    description: 'Update an existing calendar event. Zoom: withZoom adds a Zoom meeting, regenerateZoom replaces the existing one, removeZoom strips it. removeMeet clears the event\'s Google Meet conference data (e.g. before attaching another provider). Conference flags are independent — use one per call.',
    annotations: { destructiveHint: false },
    inputSchema: {
      calendarId: z.string().describe('Calendar ID'),
      eventId: z.string().describe('Event ID'),
      summary: z.string().optional().describe('New event title'),
      from: z.string().optional().describe('New start time (RFC3339)'),
      to: z.string().optional().describe('New end time (RFC3339)'),
      description: z.string().optional().describe('New description'),
      location: z.string().optional().describe('New location'),
      attendees: z.string().optional().describe('New attendee emails, comma-separated (replaces ALL existing; set empty to clear). Per-attendee modifiers: ;optional, ;resource, ;comment=TEXT'),
      addAttendees: z.string().optional().describe('Attendee emails to add, comma-separated (preserves existing attendees). Per-attendee modifiers: ;optional, ;resource, ;comment=TEXT'),
      attachments: z.array(z.string()).optional().describe('File attachment URLs (e.g. Drive links). Replaces ALL existing attachments; pass a single empty string to clear them.'),
      withZoom: z.boolean().optional().describe('Create a Zoom video conference for this event'),
      regenerateZoom: z.boolean().optional().describe('Replace the event\'s existing Zoom video conference'),
      removeZoom: z.boolean().optional().describe('Remove the event\'s Zoom video conference'),
      removeMeet: z.boolean().optional().describe('Remove the event\'s Google Meet video conference (clears conference data only)'),
      ...reminderParams,
      account: accountParam,
    },
  }, async ({ calendarId, eventId, summary, from, to, description, location, attendees, addAttendees, attachments, withZoom, regenerateZoom, removeZoom, removeMeet, reminders, noReminders, account }) => {
    const args = ['calendar', 'update', calendarId, eventId];
    if (summary !== undefined) args.push(`--summary=${summary}`);
    if (from !== undefined) args.push(`--from=${from}`);
    if (to !== undefined) args.push(`--to=${to}`);
    if (description !== undefined) args.push(`--description=${description}`);
    if (location !== undefined) args.push(`--location=${location}`);
    if (attendees !== undefined) args.push(`--attendees=${attendees}`);
    if (addAttendees) args.push(`--add-attendee=${addAttendees}`);
    if (attachments) for (const a of attachments) args.push(`--attachment=${a}`);
    if (withZoom) args.push('--with-zoom');
    if (regenerateZoom) args.push('--regenerate-zoom');
    if (removeZoom) args.push('--remove-zoom');
    if (removeMeet) args.push('--remove-meet');
    pushReminderFlags(args, { reminders, noReminders });
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
    // gog gates this delete behind a confirmation; the runner injects
    // --no-input, so without --force it refuses at runtime.
    return runOrDiagnose(['calendar', 'delete', calendarId, eventId, '--force'], { account });
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
