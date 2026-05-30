import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

// People is the richer API behind Google Contacts: Workspace directory
// search, profile fields, and relations.
export function registerExtraContactsTools(server: McpServer): void {
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

  server.registerTool('gog_contacts_update', {
    description: 'Update an existing Google Contact. Empty string clears a field; repeatable fields (url/address/custom/relation) take comma/semicolon-separated lists.',
    inputSchema: {
      resourceName: z.string().describe('Contact resource name (people/...)'),
      given: z.string().optional().describe('Given (first) name'),
      family: z.string().optional().describe('Family (last) name'),
      email: z.string().optional().describe('Email address (empty string clears)'),
      phone: z.string().optional().describe('Phone number (empty string clears)'),
      org: z.string().optional().describe('Organization/company name (empty string clears)'),
      title: z.string().optional().describe('Job title (empty string clears)'),
      url: z.string().optional().describe('URL(s), comma-separated (empty string clears all)'),
      note: z.string().optional().describe('Note/biography (empty string clears)'),
      address: z.string().optional().describe('Postal address(es), semicolon-separated (empty string clears all)'),
      birthday: z.string().optional().describe('Birthday in YYYY-MM-DD (empty string clears)'),
      ignoreEtag: z.boolean().optional().describe('Allow update even if a supplied etag is stale (may overwrite concurrent changes)'),
      account: accountParam,
    },
  }, async ({ resourceName, given, family, email, phone, org, title, url, note, address, birthday, ignoreEtag, account }) => {
    const args = ['contacts', 'update', resourceName];
    if (given !== undefined) args.push(`--given=${given}`);
    if (family !== undefined) args.push(`--family=${family}`);
    if (email !== undefined) args.push(`--email=${email}`);
    if (phone !== undefined) args.push(`--phone=${phone}`);
    if (org !== undefined) args.push(`--org=${org}`);
    if (title !== undefined) args.push(`--title=${title}`);
    if (url !== undefined) args.push(`--url=${url}`);
    if (note !== undefined) args.push(`--note=${note}`);
    if (address !== undefined) args.push(`--address=${address}`);
    if (birthday !== undefined) args.push(`--birthday=${birthday}`);
    if (ignoreEtag) args.push('--ignore-etag');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_contacts_delete', {
    description: 'Delete a Google Contact by resource name.',
    annotations: { destructiveHint: true },
    inputSchema: {
      resourceName: z.string().describe('Contact resource name (people/...)'),
      account: accountParam,
    },
  }, async ({ resourceName, account }) => {
    return runOrDiagnose(['contacts', 'delete', resourceName], { account });
  });

  server.registerTool('gog_contacts_export', {
    description: 'Export contacts as vCard (.vcf). Provide a selector (resource name, email, or name), or use query / all to export multiple.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      selector: z.string().optional().describe('Contact resource name (people/...), email, or name'),
      query: z.string().optional().describe('Search query to export (max 30 results)'),
      all: z.boolean().optional().describe('Export all personal contacts'),
      out: z.string().optional().describe('Output path (.vcf), or - for stdout (default: stdout)'),
      max: z.number().optional().describe('Max results for query (1-30)'),
      page: z.string().optional().describe('Start page token for all'),
      account: accountParam,
    },
  }, async ({ selector, query, all, out, max, page, account }) => {
    const args = ['contacts', 'export'];
    if (selector) args.push(selector);
    if (query) args.push(`--query=${query}`);
    if (all) args.push('--all');
    if (out) args.push(`--out=${out}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_contacts_dedupe', {
    description: 'Find likely duplicate personal contacts (preview only — does not modify anything).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      match: z.string().optional().describe('Match fields, comma-separated from email,phone,name (default: email,phone)'),
      max: z.number().optional().describe('Max contacts to scan (0 = all)'),
      account: accountParam,
    },
  }, async ({ match, max, account }) => {
    const args = ['contacts', 'dedupe'];
    if (match) args.push(`--match=${match}`);
    if (max !== undefined) args.push(`--max=${max}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_contacts_directory_list', {
    description: 'List people from the Google Workspace directory (domain shared contacts).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      max: z.number().optional().describe('Max results (default: 50)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ max, page, all, account }) => {
    const args = ['contacts', 'directory', 'list'];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_contacts_other_list', {
    description: 'List "other contacts" — auto-collected addresses (e.g. people you have emailed) that are not in your saved contacts.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ max, page, all, account }) => {
    const args = ['contacts', 'other', 'list'];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_contacts_other_search', {
    description: 'Search "other contacts" — auto-collected addresses not in your saved contacts.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Search query'),
      max: z.number().optional().describe('Max results (default: 50)'),
      account: accountParam,
    },
  }, async ({ query, max, account }) => {
    const args = ['contacts', 'other', 'search', query];
    if (max !== undefined) args.push(`--max=${max}`);
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
