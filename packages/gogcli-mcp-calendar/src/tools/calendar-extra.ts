import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

const meetAccess = z.enum(['open', 'trusted', 'restricted']);

export function registerExtraCalendarTools(server: McpServer): void {
  // ─── Meet API tools ────────────────────────────────────────────
  // Meet spaces are the conferencing surface attached to calendar events,
  // so they live in the calendar sub-package.

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
