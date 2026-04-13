import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';
import { toText, toError } from './utils.js';

export function registerAuthTools(server: McpServer): void {
  server.registerTool('gog_auth_list', {
    description: 'List all Google accounts stored in gogcli. Use this to check which accounts are configured and available.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      return toText(await run(['auth', 'list']));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_auth_status', {
    description: 'Show gogcli auth configuration: keyring backend, credential files, and auth setup.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      return toText(await run(['auth', 'status']));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_auth_services', {
    description: 'List all Google services supported by gogcli and the OAuth scopes each requires.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      return toText(await run(['auth', 'services']));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_auth_add', {
    description:
      'Authorize a Google account via browser-based OAuth. ' +
      'Opens a browser window where the user must sign in and grant access. ' +
      'Blocks for up to 5 minutes waiting for the user to complete authorization. ' +
      'If the browser does not open automatically, a fallback URL is included in the response. ' +
      'Use gog_auth_list to check which accounts are already configured.',
    annotations: { destructiveHint: true },
    inputSchema: {
      email: z.string().describe('Google account email to authorize'),
      services: z.string().optional().default('all').describe(
        'Services to authorize: "all" or comma-separated list (e.g. "sheets,gmail,calendar"). Default: "all"',
      ),
    },
  }, async ({ email, services = 'all' }) => {
    try {
      return toText(await run(['auth', 'add', email, '--services', services], {
        interactive: true,
        timeout: 300_000,
      }));
    } catch (err) {
      return toError(err);
    }
  });

  server.registerTool('gog_auth_run', {
    description: 'Run any gog auth subcommand. Run `gog auth --help` to see all available subcommands and flags. Note: for browser-based authorization, use gog_auth_add instead.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog auth subcommand, e.g. "remove", "alias", "tokens"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
    },
  }, async ({ subcommand, args }) => {
    try {
      return toText(await run(['auth', subcommand, ...args]));
    } catch (err) {
      return toError(err);
    }
  });
}
