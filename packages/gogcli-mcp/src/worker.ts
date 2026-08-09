import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleAuthorize } from '@chrischall/mcp-connector';
import type { ToolRegistrar } from '@chrischall/mcp-utils';
import {
  BASE_TOOL_REGISTRARS,
  authToolsFor,
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
import { gogAuth, CONNECTOR_INSTRUCTIONS, type GogProps } from './connector-auth.js';

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

const VERSION = '2.21.1'; // x-release-please-version

// Build an McpAgent subclass whose init() registers `registrars` onto its server,
// each handler wrapped in the ALS scope carrying the per-session Fly executor.
// (Kept in worker.ts, not connector-runtime.ts, because it imports the Worker-only
// `agents` runtime; the node-testable helpers stay in connector-runtime.ts.)
function makeAgent(registrars: ToolRegistrar[]): typeof McpAgent {
  class GogAgent extends McpAgent<unknown, unknown, GogProps> {
    // `instructions` is the connector's only channel to the model that is not a
    // tool description, and it carries the one thing the client UI gets wrong:
    // "connected"/"refreshed" is a statement about the connector key, not about
    // Google. See CONNECTOR_INSTRUCTIONS for why that has to be said out loud.
    server = new McpServer(
      { name: 'gogcli-mcp', version: VERSION },
      { instructions: CONNECTOR_INSTRUCTIONS },
    );
    async init() {
      // NO third argument, deliberately: the hosted connector supplies no
      // per-caller access token, so `gog` runs as the Fly volume's own identity
      // and refreshes from its own keyring. That is what makes the eviction +
      // replay machinery in connector-runtime.ts INERT here — with no token
      // source there is no module-level cache that can go stale, so a Google
      // 401 on this path stops at the `no access token was supplied` guard and
      // logs `replay.declined`. That record is the expected outcome for a
      // hosted connector, not a bug; the transport-failure classification and
      // the auth log itself do apply here.
      //
      // Inert is not the same as unobserved. Because `gog` is spawned fresh per
      // /run and re-reads the keyring each time, a Google 401 here means the
      // STORED credential was refused — which no retry can repair, so no retry
      // is built. Instead that same guard first takes one live reading of the
      // Google layer (`GET /health/google` on the runner) and records it as
      // `refusal.google-ok` / `-unhealthy` / `-unmeasured`. It is throttled,
      // deadline-bounded, cannot throw, and leaves the caller's error
      // byte-identical; its whole job is to answer, in the log, the question
      // that could not be answered after the incident: at the moment Google
      // refused, was the refresh token on the volume alive or dead?
      // (docs/DEPLOY-CONNECTOR.md, "Reading the auth log" and "Why a hosted
      // Google 401 is measured rather than retried", says this for whoever is
      // reading logs rather than code.)
      const executor = makeFlyExecutor((this.env as { FLY_ENDPOINT: string }).FLY_ENDPOINT, this.props.key);
      const wrapped = wrapServer(this.server, executor);
      for (const register of registrars) register(wrapped);
    }
  }
  return GogAgent as unknown as typeof McpAgent;
}

// auth + <service> base + <service> extras — the exact set each sub-package's
// stdio server exposes. The auth registrar is bound to THIS service's default
// `services` (least-privilege): a per-service connector re-auths requesting only
// its own scopes, so one unregistered scope for a service it doesn't wrap can't
// poison its re-auth with invalid_scope. The base /mcp agent keeps 'all'.
const svc = (service: string, base: ToolRegistrar, extra: ToolRegistrar): ToolRegistrar[] =>
  [authToolsFor(service), base, extra];

export class GogcliMcpAgent extends makeAgent(BASE_TOOL_REGISTRARS) {}
export class GogcliSheetsAgent extends makeAgent(svc('sheets', registerSheetsTools, registerExtraSheetsTools)) {}
export class GogcliGmailAgent extends makeAgent(svc('gmail', registerGmailTools, registerExtraGmailTools)) {}
export class GogcliDriveAgent extends makeAgent(svc('drive,driveactivity,drivelabels', registerDriveTools, registerExtraDriveTools)) {}
export class GogcliDocsAgent extends makeAgent(svc('docs', registerDocsTools, registerExtraDocsTools)) {}

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
