import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';
import { errorResult, rawTextResult } from '@chrischall/mcp-utils';
import { errorText, formatAuthHealth, registerRunTool } from './utils.js';

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

  server.registerTool('gog_auth_health', {
    description:
      'Check the LIVE health of each stored Google account. Unlike gog_auth_status (which only ' +
      'reports keyring/config setup), this performs a real token refresh against Google, so it detects ' +
      'expired or revoked (invalid_grant) refresh tokens — the account-wide sign-out that blocks every ' +
      'service. Reports per account: whether the token is currently valid, the mapped cause when it is ' +
      'not, how long ago it was authorized, and a warning as it approaches the 7-day refresh-token limit ' +
      'that applies to OAuth apps whose consent screen is still in "Testing" mode. Run it proactively to ' +
      're-authorize on your own schedule instead of mid-task.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      // `run` injects --json; --check makes gog probe each token live.
      return rawTextResult(formatAuthHealth(await run(['auth', 'list', '--check']), Date.now()));
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

  server.registerTool('gog_auth_add_url', {
    description:
      'Begin REMOTE/headless Google authorization (step 1 of 2). Returns a sign-in URL to open in any ' +
      'browser — no local server or terminal on the gogcli host is needed, so this works over the hosted ' +
      'connector where the interactive gog_auth_add cannot. Hand the URL to the user; after they sign in, ' +
      'the browser is redirected to a localhost URL that fails to load — that is expected. They copy that ' +
      'full redirected URL (from the address bar) and you pass it to gog_auth_add_complete. The link is ' +
      'valid for 10 minutes. If you pass a custom `services` here, pass the SAME value to ' +
      'gog_auth_add_complete or the second step will not match this one.',
    inputSchema: {
      email: z.string().describe('Google account email to authorize'),
      services: z.string().optional().default('all').describe(
        'Services to authorize: "all" or comma-separated list (e.g. "sheets,gmail,calendar"). Default: "all"',
      ),
    },
  }, async ({ email, services = 'all' }) => {
    try {
      // --force-consent guarantees a refresh token even if a prior grant exists
      // (the whole point when recovering from a dead one). redactMode 'tokens'
      // keeps the consent URL's scope names intact (the shared redactor mangles
      // them) while still stripping any real token — a step-1 URL carries none.
      return rawTextResult(await run(
        ['auth', 'add', email, '--remote', '--step', '1', '--services', services, '--force-consent'],
        { redactMode: 'tokens' },
      ));
    } catch (err) {
      return errorResult(errorText(err));
    }
  });

  server.registerTool('gog_auth_add_complete', {
    description:
      'Complete REMOTE/headless Google authorization (step 2 of 2). Takes the full redirected localhost ' +
      'URL the user copied after finishing gog_auth_add_url, exchanges it for a refresh token, and stores ' +
      'it. Use the SAME `services` value you passed to gog_auth_add_url. Must run within 10 minutes of ' +
      'step 1 and against the same gogcli host.',
    annotations: { destructiveHint: true },
    inputSchema: {
      email: z.string().describe('Google account email being authorized (same as step 1)'),
      redirectUrl: z.string().describe(
        'The full localhost redirect URL the user copied from the browser address bar after signing in ' +
        '(contains code and state; the page itself fails to load, which is expected).',
      ),
      services: z.string().optional().default('all').describe(
        'Services authorized — MUST match the value passed to gog_auth_add_url. Default: "all"',
      ),
    },
  }, async ({ email, redirectUrl, services = 'all' }) => {
    try {
      return rawTextResult(await run(
        ['auth', 'add', email, '--remote', '--step', '2', '--auth-url', redirectUrl,
          '--services', services, '--force-consent'],
      ));
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
