import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

// Generic Google Discovery API access (gog 0.31). gog_api_list / gog_api_describe
// are read-only Discovery lookups; gog_api_call is a Discovery-backed escape
// hatch for any method gog has no dedicated subcommand for — guarded by an
// explicit write opt-in and a dry-run preview.
export function registerApiTools(server: McpServer): void {
  server.registerTool('gog_api_list', {
    description: 'List the Google Discovery APIs available for gog_api_call / gog_api_describe (name + version + title).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      all: z.boolean().optional().describe('Include every Discovery API (including preview/less-common ones) instead of the curated default set'),
      account: accountParam,
    },
  }, async ({ all, account }) => {
    const args = ['api', 'list'];
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_api_describe', {
    description: 'Describe a Google Discovery API, or a single method within it — its parameters, request/response schema, and required OAuth scopes. Use this to discover the exact api/version/method and params before calling gog_api_call.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      api: z.string().describe('Discovery API name (e.g. drive, gmail, calendar)'),
      version: z.string().describe('API version (e.g. v3, v1)'),
      method: z.string().optional().describe('Optional method id to describe a single method (e.g. files.list); omit to describe the whole API'),
      account: accountParam,
    },
  }, async ({ api, version, method, account }) => {
    const args = ['api', 'describe', api, version];
    if (method) args.push(method);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_api_call', {
    description: 'Call any Discovery-described Google API method directly — an escape hatch for endpoints gog has no dedicated tool for. Find the exact api/version/method/params with gog_api_describe first. Read methods (GET/LIST) run as-is. Mutating methods (POST/PUT/PATCH/DELETE) are refused unless you set allowWrite=true — keep it false to preview, or set dryRun=true to print the intended request without sending it.',
    annotations: { destructiveHint: true },
    inputSchema: {
      api: z.string().describe('Discovery API name (e.g. drive, gmail, calendar)'),
      version: z.string().describe('API version (e.g. v3, v1)'),
      method: z.string().describe('Method id to call (e.g. files.list, files.create)'),
      params: z.string().optional().describe('Query/path parameters as a JSON object string (e.g. {"fileId":"abc","fields":"name"})'),
      body: z.string().optional().describe('Request body as a JSON string (for write methods)'),
      scope: z.string().optional().describe('Override the OAuth scope used for the call'),
      allowWrite: z.boolean().optional().describe('Required to invoke a mutating method (POST/PUT/PATCH/DELETE). Without it, gog refuses write methods. Leave unset for read-only calls.'),
      dryRun: z.boolean().optional().describe('Print the intended request and exit without sending it (no changes made)'),
      account: accountParam,
    },
  }, async ({ api, version, method, params, body, scope, allowWrite, dryRun, account }) => {
    const args = ['api', 'call', api, version, method];
    if (params) args.push(`--params=${params}`);
    if (body) args.push(`--body=${body}`);
    if (scope) args.push(`--scope=${scope}`);
    // gog additionally gates mutating Discovery calls behind a confirmation;
    // the runner injects --no-input, so --allow-write alone still refuses.
    if (allowWrite) args.push('--allow-write');
    if (dryRun) args.push('--dry-run');
    // Fleet convention: --force is appended LAST (after --dry-run when both are set).
    if (allowWrite) args.push('--force');
    return runOrDiagnose(args, { account });
  });
}
