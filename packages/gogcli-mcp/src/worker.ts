import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleAuthorize } from '@chrischall/mcp-connector';
import type { ToolRegistrar } from '@chrischall/mcp-utils';
import {
  BASE_TOOL_REGISTRARS,
  registerAuthTools,
  registerSheetsTools,
  registerGmailTools,
  registerDriveTools,
  registerDocsTools,
} from './lib.js';
import { registerExtraSheetsTools } from '../../gogcli-mcp-sheets/src/tools/sheets-extra.js';
import { registerExtraGmailTools } from '../../gogcli-mcp-gmail/src/tools/gmail-extra.js';
import { registerExtraDriveTools } from '../../gogcli-mcp-drive/src/tools/drive-extra.js';
import { registerExtraDocsTools } from '../../gogcli-mcp-docs/src/tools/docs-extra.js';
import { makeFlyExecutor, wrapServer } from './connector-runtime.js';
import { gogAuth, type GogProps } from './connector-auth.js';

// The Cloudflare remote-connector entrypoint for gogcli-mcp.
//
// It reuses the EXISTING transport-neutral tool registrars UNCHANGED and executes
// every assembled `gog` arg-array by forwarding it to a Fly.io backend (a Worker
// cannot spawn processes). The bridge is the `runExecutor` AsyncLocalStorage seam
// in `runner.ts`: `wrapServer` scopes each tool handler in `runExecutor.run(...)`
// so the handler's `run()` forwards to the per-session Fly executor.
//
// One Worker serves several MCP endpoints under one OAuth login, each a distinct
// tool set backed by its own Durable Object:
//   /mcp          all-services base (BASE_TOOL_REGISTRARS)
//   /mcp/sheets   auth + Sheets base + Sheets extras
//   /mcp/gmail    auth + Gmail base + Gmail extras
//   /mcp/drive    auth + Drive base + Drive extras
//   /mcp/docs     auth + Docs base + Docs extras
// Each per-service path exposes the SAME tool set as that sub-package's stdio
// server, so the ~50-70 extras per service are reachable without swamping one
// connector with all ~360 tools at once. Add whichever paths you want as separate
// connectors in claude.ai (each authorizes with the same connector key).

const VERSION = '2.16.5'; // x-release-please-version

// Build an McpAgent subclass whose init() registers `registrars` onto its server,
// each handler wrapped in the ALS scope carrying the per-session Fly executor.
// (Kept in worker.ts, not connector-runtime.ts, because it imports the Worker-only
// `agents` runtime; the node-testable helpers stay in connector-runtime.ts.)
function makeAgent(registrars: ToolRegistrar[]): typeof McpAgent {
  class GogAgent extends McpAgent<unknown, unknown, GogProps> {
    server = new McpServer({ name: 'gogcli-mcp', version: VERSION });
    async init() {
      const executor = makeFlyExecutor((this.env as { FLY_ENDPOINT: string }).FLY_ENDPOINT, this.props.key);
      const wrapped = wrapServer(this.server, executor);
      for (const register of registrars) register(wrapped);
    }
  }
  return GogAgent as unknown as typeof McpAgent;
}

// auth + <service> base + <service> extras — the exact set each sub-package's
// stdio server exposes.
const svc = (base: ToolRegistrar, extra: ToolRegistrar): ToolRegistrar[] => [registerAuthTools, base, extra];

export class GogcliMcpAgent extends makeAgent(BASE_TOOL_REGISTRARS) {}
export class GogcliSheetsAgent extends makeAgent(svc(registerSheetsTools, registerExtraSheetsTools)) {}
export class GogcliGmailAgent extends makeAgent(svc(registerGmailTools, registerExtraGmailTools)) {}
export class GogcliDriveAgent extends makeAgent(svc(registerDriveTools, registerExtraDriveTools)) {}
export class GogcliDocsAgent extends makeAgent(svc(registerDocsTools, registerExtraDocsTools)) {}

const defaultHandler = {
  fetch(request: Request, env: unknown): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return handleAuthorize(request, env, gogAuth);
    return new Response('Not found', { status: 404 });
  },
};

// NOTE: OAuthProvider matches apiHandlers by PREFIX and returns the FIRST match,
// so the specific per-service paths MUST be listed before the base `/mcp`
// (otherwise `/mcp` greedily swallows `/mcp/sheets`).
const handler = new OAuthProvider({
  apiHandlers: {
    '/mcp/sheets': GogcliSheetsAgent.serve('/mcp/sheets', { binding: 'SHEETS_MCP' }) as never,
    '/mcp/gmail': GogcliGmailAgent.serve('/mcp/gmail', { binding: 'GMAIL_MCP' }) as never,
    '/mcp/drive': GogcliDriveAgent.serve('/mcp/drive', { binding: 'DRIVE_MCP' }) as never,
    '/mcp/docs': GogcliDocsAgent.serve('/mcp/docs', { binding: 'DOCS_MCP' }) as never,
    '/mcp': GogcliMcpAgent.serve('/mcp') as never,
    '/sse': GogcliMcpAgent.serveSSE('/sse') as never,
  },
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});

export default handler;
