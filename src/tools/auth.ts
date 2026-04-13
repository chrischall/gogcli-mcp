import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { run } from '../runner.js';

function toText(output: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: output }] };
}

function toError(err: unknown): { content: [{ type: 'text'; text: string }] } {
  return toText(err instanceof Error ? `Error: ${err.message}` : String(err));
}

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

  server.registerTool('gog_auth_run', {
    description: 'Run any gog auth subcommand. Run `gog auth --help` to see all available subcommands and flags. Note: gog auth add requires interactive browser auth and cannot be completed over MCP — run it in your terminal instead: gog auth add <email> --services <service>',
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
