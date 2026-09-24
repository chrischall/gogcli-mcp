import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { errorResult } from '@chrischall/mcp-utils';
import { accountParam, errorText, runOrDiagnose } from './utils.js';
import { assertSafeForwardedArgs } from '../arg-guard.js';
import { confineAtFile } from '../file-roots.js';
import { pos } from '../argv.js';
import type { GogArg } from '../runner.js';
import { gatedElsewhere } from '../dispatch-confirmation.js';

// Gmail methods gog_api_call refuses outright (audit SEC-2). `allowWrite` is a
// boolean the MODEL sets, so it cannot stand in for the user's confirmation of
// a send: `*.send` must go through gog_gmail_send / gog_gmail_drafts_send, which
// ask the user. Forwarding addresses, auto-forwarding, filters (which can
// forward) and delegates route FUTURE mail to someone else and are refused for
// the same reason. --gmail-no-send is pinned on as a runtime backstop too.
const GMAIL_API_BLOCKED = /(?:\.send$|forwarding|filters\.create|filters\.update|delegates\.create)/i;

// The same reasoning for every other action the dispatch rail gates (#400):
// the dedicated tool asks the user, so the raw API method must not be a way
// around it. Anchored on a `.` or the start so a Discovery id with the API
// prefix (`chat.spaces.messages.create`) matches too.
// Fleet audit 2026-09-24 SEC-6 added the methods that notify someone, grant
// access or run code under the account's authority (moving an event with
// sendUpdates, roster adds, returning work, posting coursework, comments,
// send-as aliases, the vacation responder, member-seeded spaces, script runs).
const DISPATCH_API_BLOCKED: Record<string, Array<{ method: RegExp; does: string; tool: string }>> = {
  chat: [
    { method: /(?:^|\.)spaces\.messages\.create$/i, does: 'posts a Chat message', tool: 'gog_chat_messages_send / gog_chat_dm_send' },
    { method: /(?:^|\.)spaces\.(?:setup|members\.create)$/i, does: 'adds people to a space', tool: 'gog_chat_spaces_create' },
  ],
  drive: [
    { method: /(?:^|\.)permissions\.(?:create|update)$/i, does: 'grants access to a file', tool: 'gog_drive_share' },
    { method: /(?:^|\.)comments\.create$/i, does: 'notifies the file\'s owner and anyone it mentions', tool: 'gog_drive_comments_add / gog_docs_comments_add' },
    { method: /(?:^|\.)replies\.create$/i, does: 'notifies the comment thread', tool: 'gog_drive_comments_reply / gog_docs_comments_reply' },
  ],
  classroom: [
    { method: /(?:^|\.)courses\.announcements\.create$/i, does: 'posts to a class', tool: 'gog_classroom_announcements_create' },
    { method: /(?:^|\.)invitations\.create$/i, does: 'invites someone to a class', tool: 'gog_classroom_invitations_create' },
    { method: /(?:^|\.)courses\.students\.create$/i, does: 'adds someone to a class', tool: 'gog_classroom_students_add' },
    { method: /(?:^|\.)courses\.teachers\.create$/i, does: 'gives someone teacher access to a class', tool: 'gog_classroom_teachers_add' },
    { method: /(?:^|\.)courses\.coursework\.create$/i, does: 'posts coursework to a class', tool: 'gog_classroom_coursework_create' },
    { method: /(?:^|\.)studentsubmissions\.return$/i, does: 'returns work to a student', tool: 'gog_classroom_submissions_return' },
  ],
  calendar: [
    { method: /(?:^|\.)events\.(?:insert|import|quickadd)$/i, does: 'can put an event on guests\' calendars', tool: 'gog_calendar_create' },
    { method: /(?:^|\.)events\.(?:update|patch)$/i, does: 'can change what guests see', tool: 'gog_calendar_update / gog_calendar_respond' },
    { method: /(?:^|\.)events\.move$/i, does: 'can email every guest', tool: 'gog_calendar_move' },
  ],
  gmail: [
    { method: /(?:^|\.)settings\.sendas\.create$/i, does: 'makes Google email the address and adds a sending identity', tool: 'gog_gmail_sendas_create' },
    { method: /(?:^|\.)settings\.updatevacation$/i, does: 'can turn on an auto-reply to every sender', tool: 'gog_gmail_vacation_update' },
  ],
  script: [{ method: /(?:^|\.)scripts\.run$/i, does: 'executes code with this account\'s authority', tool: 'gog_appscript_run_function' }],
};

export function refusedApiCall(api: string, method: string): string | undefined {
  const name = api.trim().toLowerCase();
  const m = method.trim();
  if (name === 'gmail' && GMAIL_API_BLOCKED.test(m)) {
    return `gmail ${method} is not available through gog_api_call: it sends or forwards mail. `
      + 'Use gog_gmail_send / gog_gmail_drafts_send (which ask the user to confirm) or the dedicated gog_gmail_* tool.';
  }
  const hit = (Object.hasOwn(DISPATCH_API_BLOCKED, name) ? DISPATCH_API_BLOCKED[name] : [])!.find((b) => b.method.test(m));
  return hit ? gatedElsewhere(`${name} ${m}`, 'gog_api_call', hit.does, hit.tool) : undefined;
}

// Generic Google Discovery API access (gog 0.31). gog_api_list / gog_api_describe
// are read-only Discovery lookups; gog_api_call is a Discovery-backed escape
// hatch for any method gog has no dedicated subcommand for — guarded by an
// explicit write opt-in and a dry-run preview.
export function registerApiTools(server: McpServer): void {
  server.registerTool('gog_api_list', {
    description: 'List the Google Discovery APIs available for gog_api_call / gog_api_describe (name + version + title).',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      all: z.boolean().optional().describe('Include every Discovery API (including preview/less-common ones) instead of the curated default set'),
      account: accountParam,
    }),
  }, async ({ all, account }) => {
    const args: GogArg[] = ['api', 'list'];
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_api_describe', {
    description: 'Describe a Google Discovery API, or a single method within it — its parameters, request/response schema, and required OAuth scopes. Use this to discover the exact api/version/method and params before calling gog_api_call.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      api: z.string().describe('Discovery API name (e.g. drive, gmail, calendar)'),
      version: z.string().describe('API version (e.g. v3, v1)'),
      method: z.string().optional().describe('Optional method id to describe a single method (e.g. files.list); omit to describe the whole API'),
      account: accountParam,
    }),
  }, async ({ api, version, method, account }) => {
    const args: GogArg[] = ['api', 'describe', pos(api), pos(version)];
    if (method) args.push(pos(method));
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_api_call', {
    description: 'Call any Discovery-described Google API method directly — an escape hatch for endpoints gog has no dedicated tool for. Find the exact api/version/method/params with gog_api_describe first. Read methods (GET/LIST) run as-is. Mutating methods (POST/PUT/PATCH/DELETE) are refused unless you set allowWrite=true — keep it false to preview, or set dryRun=true to print the intended request without sending it. Gmail send and forwarding methods (users.messages.send, users.drafts.send, forwarding/auto-forwarding, filters, delegates) are refused — use the dedicated gog_gmail_* tools, which ask the user to confirm. So are the other methods a dedicated tool asks about: Chat spaces.messages.create, Drive permissions.create/update, Classroom courses.announcements.create and invitations.create, and Calendar events.insert/import/quickAdd/update/patch.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      api: z.string().describe('Discovery API name (e.g. drive, gmail, calendar)'),
      version: z.string().describe('API version (e.g. v3, v1)'),
      method: z.string().describe('Method id to call (e.g. files.list, files.create)'),
      params: z.string().optional().describe('Query/path parameters as a JSON object string (e.g. {"fileId":"abc","fields":"name"})'),
      body: z.string().optional().describe('Request body as a JSON string (for write methods)'),
      scope: z.string().optional().describe('Override the OAuth scope used for the call'),
      allowWrite: z.boolean().optional().describe('Required to invoke a mutating method (POST/PUT/PATCH/DELETE). Without it, gog refuses write methods. Leave unset for read-only calls.'),
      dryRun: z.boolean().optional().describe('Print the intended request and exit without sending it (no changes made)'),
      account: accountParam,
    }),
  }, async ({ api, version, method, params, body, scope, allowWrite, dryRun, account }) => {
    try {
      assertSafeForwardedArgs([api, version, method]);
      const refusal = refusedApiCall(api, method);
      if (refusal) throw new Error(refusal);
      // gog reads `@path` from the host for --body (and --params): confine it
      // like every other server-side path (SEC-3/SEC-4).
      if (body) confineAtFile(body, 'body');
      if (params) confineAtFile(params, 'params');
    } catch (err) {
      return errorResult(errorText(err));
    }
    const args: GogArg[] = ['api', 'call', pos(api), pos(version), pos(method)];
    if (params) args.push(`--params=${params}`);
    if (body) args.push(`--body=${body}`);
    if (scope) args.push(`--scope=${scope}`);
    // gog additionally gates mutating Discovery calls behind a confirmation;
    // the runner injects --no-input, so --allow-write alone still refuses.
    if (allowWrite) args.push('--allow-write');
    if (dryRun) args.push('--dry-run');
    // Fleet convention: --force is appended LAST (after --dry-run when both are set).
    if (allowWrite) args.push('--force');
    return runOrDiagnose(args, { account, gmailNoSend: true });
  });
}
