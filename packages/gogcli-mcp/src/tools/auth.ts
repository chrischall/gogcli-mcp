import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';
import { errorResult, rawTextResult } from '@chrischall/mcp-utils';
import { errorText, registerRunTool } from './utils.js';

export function registerAuthTools(server: McpServer): void {
  server.registerTool('gog_auth_list', {
    description: 'List all Google accounts stored in gogcli. Use this to check which accounts are configured and available.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      return rawTextResult(await run(['auth', 'list']));
    } catch (err) {
      return errorResult(errorText(err));
    }
  });

  server.registerTool('gog_auth_status', {
    description: 'Show gogcli auth configuration: keyring backend, credential files, and auth setup.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      return rawTextResult(await run(['auth', 'status']));
    } catch (err) {
      return errorResult(errorText(err));
    }
  });

  server.registerTool('gog_auth_services', {
    description: 'List all Google services supported by gogcli and the OAuth scopes each requires.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      return rawTextResult(await run(['auth', 'services']));
    } catch (err) {
      return errorResult(errorText(err));
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
      return rawTextResult(await run(['auth', 'add', email, '--services', services], {
        interactive: true,
        timeout: 300_000,
      }));
    } catch (err) {
      return errorResult(errorText(err));
    }
  });

  registerRunTool(server, {
    service: 'auth',
    examples: '"remove", "alias", "list"',
    omitAccount: true,
    note: 'For browser-based authorization, use gog_auth_add instead.',
  });
}
