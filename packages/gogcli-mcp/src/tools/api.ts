import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { errorResult } from '@chrischall/mcp-utils';
import { accountParam, errorText, runOrDiagnose } from './utils.js';
import { assertSafeForwardedArgs } from '../arg-guard.js';
import { confineAtFile } from '../file-roots.js';
import { pos } from '../argv.js';
import type { GogArg } from '../runner.js';
import { BODY_PREVIEW_MAX, bodyPreview, CONFIRM_FALLBACK_DESCRIPTION, confirmTokenParam, gatedElsewhere, requireDispatchConfirmation } from '../dispatch-confirmation.js';

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
const DISPATCH_API_BLOCKED: Record<string, Array<{ method: RegExp; does: string; tool: string }>> = {
  chat: [{ method: /(?:^|\.)spaces\.messages\.create$/i, does: 'posts a Chat message', tool: 'gog_chat_messages_send / gog_chat_dm_send' }],
  drive: [{ method: /(?:^|\.)permissions\.(?:create|update)$/i, does: 'grants access to a file', tool: 'gog_drive_share' }],
  classroom: [
    { method: /(?:^|\.)courses\.announcements\.create$/i, does: 'posts to a class', tool: 'gog_classroom_announcements_create' },
    { method: /(?:^|\.)invitations\.create$/i, does: 'invites someone to a class', tool: 'gog_classroom_invitations_create' },
  ],
  calendar: [
    { method: /(?:^|\.)events\.(?:insert|import|quickadd)$/i, does: 'can put an event on guests\' calendars', tool: 'gog_calendar_create' },
    { method: /(?:^|\.)events\.(?:update|patch)$/i, does: 'can change what guests see', tool: 'gog_calendar_update / gog_calendar_respond' },
  ],
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

/**
 * A params/body string as the confirmation prompt shows it: parsed, when it is
 * JSON, so the user reads a structure rather than an escaped string; otherwise
 * (an `@file` reference, a typo) the string itself. Bounded like every other
 * body on the rail — the token binds the FULL string regardless.
 */
export function previewJson(text: string): unknown {
  if (text.length > BODY_PREVIEW_MAX) return bodyPreview(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Generic Google Discovery API access (gog 0.31). gog_api_list / gog_api_describe
// are read-only Discovery lookups; gog_api_call is a Discovery-backed escape
// hatch for any method gog has no dedicated subcommand for — guarded by an
// explicit write opt-in, a dry-run preview, and the dispatch rail.
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
    description: 'Call any Discovery-described Google API method directly — an escape hatch for endpoints gog has no dedicated tool for. Find the exact api/version/method/params with gog_api_describe first. Read methods (GET/LIST) run as-is. Mutating methods (POST/PUT/PATCH/DELETE) are refused unless you set allowWrite=true, and every write then asks the MCP host to show the user a confirmation prompt with the exact api/version/method/params/body before anything is sent; set dryRun=true to print the intended request without sending it (no prompt, no changes). Gmail send and forwarding methods (users.messages.send, users.drafts.send, forwarding/auto-forwarding, filters, delegates) are refused outright — use the dedicated gog_gmail_* tools, which ask the user to confirm. So are the other methods a dedicated tool asks about with a better preview: Chat spaces.messages.create, Drive permissions.create/update, Classroom courses.announcements.create and invitations.create, and Calendar events.insert/import/quickAdd/update/patch.' + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      api: z.string().describe('Discovery API name (e.g. drive, gmail, calendar)'),
      version: z.string().describe('API version (e.g. v3, v1)'),
      method: z.string().describe('Method id to call (e.g. files.list, files.create)'),
      params: z.string().optional().describe('Query/path parameters as a JSON object string (e.g. {"fileId":"abc","fields":"name"})'),
      body: z.string().optional().describe('Request body as a JSON string (for write methods)'),
      scope: z.string().optional().describe('Override the OAuth scope used for the call'),
      allowWrite: z.boolean().optional().describe('Required to invoke a mutating method (POST/PUT/PATCH/DELETE); the user is asked to confirm the exact request first. Without it, gog refuses write methods. Leave unset for read-only calls.'),
      dryRun: z.boolean().optional().describe('Print the intended request and exit without sending it (no changes made, no confirmation prompt)'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ api, version, method, params, body, scope, allowWrite, dryRun, account, confirmToken }, ctx) => {
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
    // SEC-2 (fleet-audit #931): allowWrite is a boolean the MODEL sets, and
    // the --force below skips gog's own confirmation, so a method blocklist
    // could never be complete (events.move/delete with sendUpdates=all,
    // acl.insert, settings.sendAs.create, updateVacation, batchDelete, ...).
    // Every write that will actually be sent asks the user first, about the
    // exact api/method/params/body, through the same rail as the dedicated
    // tools. A dry run sends nothing and is not gated; a write without
    // allowWrite is refused by gog itself.
    if (allowWrite && !dryRun) {
      const request = { api, version, method, params, body, scope };
      const view: Record<string, unknown> = { api, version, method };
      if (params !== undefined) view.params = previewJson(params);
      if (body !== undefined) view.body = previewJson(body);
      if (scope !== undefined) view.scope = scope;
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'api.call',
        message: `Review and confirm this raw Google API write (${api} ${version} ${method}):`,
        confirmationLabel: 'Confirm that this API method should be invoked with exactly these parameters.',
        details: view,
        unsupportedNote: 'Set dryRun=true to see the request gog would send without sending it, or use the dedicated gog_* tool for this operation.',
        fallback: {
          tool: 'gog_api_call',
          account,
          confirmToken,
          subject: () => ({ target: `${api}/${version}/${method}`, payload: request, preview: view }),
        },
      });
      if (confirmation) return confirmation;
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
