import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraContactsTools(server: McpServer): void {
  // ─── People API tools ──────────────────────────────────────────
  // People is the richer API behind Google Contacts: Workspace directory
  // search, profile fields, and relations.

  server.registerTool('gog_people_me', {
    description: 'Show your own People profile (people/me).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['people', 'me'], { account });
  });

  server.registerTool('gog_people_get', {
    description: 'Get a People profile by resource name.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().describe('Person resource name (people/...) or email'),
      account: accountParam,
    },
  }, async ({ userId, account }) => {
    return runOrDiagnose(['people', 'get', userId], { account });
  });

  server.registerTool('gog_people_search', {
    description: 'Search the Google Workspace directory (covers internal users, unlike contacts search which is limited to your personal contacts).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Search query (name, email, etc.)'),
      max: z.number().optional().describe('Max results (default: 50)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ query, max, page, all, account }) => {
    const args = ['people', 'search', query];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_people_relations', {
    description: 'Get relations (manager, reports, etc.) for a user. Defaults to self when userId is omitted.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().optional().describe('Person resource name (defaults to self when omitted)'),
      type: z.string().optional().describe('Filter to a specific relation type (e.g. "manager")'),
      account: accountParam,
    },
  }, async ({ userId, type, account }) => {
    const args = ['people', 'relations'];
    if (userId) args.push(userId);
    if (type) args.push(`--type=${type}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_people_raw', {
    description: 'Dump the raw People API response as JSON (lossless; for scripting and LLM consumption).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().describe('Person resource name (people/...) or email'),
      personFields: z.string().optional().describe('People API personFields mask (default: broad set)'),
      pretty: z.boolean().optional().describe('Pretty-print JSON (default: compact single-line)'),
      account: accountParam,
    },
  }, async ({ userId, personFields, pretty, account }) => {
    const args = ['people', 'raw', userId];
    if (personFields) args.push(`--person-fields=${personFields}`);
    if (pretty) args.push('--pretty');
    return runOrDiagnose(args, { account });
  });
}
