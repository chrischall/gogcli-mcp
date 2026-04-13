import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

export function registerContactsTools(server: McpServer): void {
  server.registerTool('gog_contacts_search', {
    description: 'Search Google Contacts by name, email, or phone.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Search query (name, email, or phone)'),
      account: accountParam,
    },
  }, async ({ query, account }) => {
    return runOrDiagnose(['contacts', 'search', query], { account });
  });

  server.registerTool('gog_contacts_list', {
    description: 'List all Google Contacts.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['contacts', 'list'], { account });
  });

  server.registerTool('gog_contacts_get', {
    description: 'Get a contact by resource name.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      resourceName: z.string().describe('Contact resource name (e.g. people/c12345)'),
      account: accountParam,
    },
  }, async ({ resourceName, account }) => {
    return runOrDiagnose(['contacts', 'get', resourceName], { account });
  });

  server.registerTool('gog_contacts_create', {
    description: 'Create a new Google Contact.',
    annotations: { destructiveHint: true },
    inputSchema: {
      givenName: z.string().describe('Given (first) name'),
      familyName: z.string().optional().describe('Family (last) name'),
      email: z.string().optional().describe('Email address'),
      phone: z.string().optional().describe('Phone number'),
      org: z.string().optional().describe('Organization/company name'),
      title: z.string().optional().describe('Job title'),
      account: accountParam,
    },
  }, async ({ givenName, familyName, email, phone, org, title, account }) => {
    const args = ['contacts', 'create', `--given=${givenName}`];
    if (familyName) args.push(`--family=${familyName}`);
    if (email) args.push(`--email=${email}`);
    if (phone) args.push(`--phone=${phone}`);
    if (org) args.push(`--org=${org}`);
    if (title) args.push(`--title=${title}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_contacts_run', {
    description: 'Run any gog contacts subcommand not covered by the other tools. Run `gog contacts --help` for the full list of subcommands, or `gog contacts <subcommand> --help` for flags on a specific subcommand.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog contacts subcommand to run, e.g. "update", "delete", "directory"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['contacts', subcommand, ...args], { account });
  });
}
