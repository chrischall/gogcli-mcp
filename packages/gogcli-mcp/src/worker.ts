import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
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
import { createFlyExecutorResolver, wrapServer } from './connector-runtime.js';
import { gogAuth, CONNECTOR_INSTRUCTIONS, type GogProps } from './connector-auth.js';
import { handleAuthorize } from './connector-login.js';

// The Cloudflare remote-connector entrypoint for gogcli-mcp.
//
// It reuses the EXISTING transport-neutral tool registrars UNCHANGED and executes
// every assembled `gog` arg-array by forwarding it to a Fly.io backend (a Worker
// cannot spawn processes). The bridge is the `runExecutor` AsyncLocalStorage seam
// in `runner.ts`: `wrapServer` scopes each tool handler in `runExecutor.run(...)`
// so the handler's `run()` forwards to the authenticated caller's Fly executor.
//
// One stateless Worker serves several MCP endpoints under one OAuth login:
//   /mcp          all-services base (BASE_TOOL_REGISTRARS)
//   /mcp/sheets   auth + Sheets base + Sheets extras
//   /mcp/gmail    auth + Gmail base + Gmail extras
//   /mcp/drive    auth + Drive base + Drive extras
//   /mcp/docs     auth + Docs base + Docs extras
// Each per-service path exposes the SAME tool set as that sub-package's stdio
// server, so the ~50-70 extras per service are reachable without swamping one
// connector with all ~360 tools at once. Add whichever paths you want as separate
// connectors in claude.ai (each authorizes with the same connector key).

const VERSION = '2.30.0'; // x-release-please-version

type WorkerEnv = { FLY_ENDPOINT: string };

// One resolver per Worker isolate. Reusing an executor for the same backend
// credential preserves makeFlyExecutor's refusal-probe throttle across
// stateless requests; different credentials retain independent throttles.
const resolveFlyExecutor = createFlyExecutorResolver();

// Build a fresh SDK v2 server for every HTTP request. That is the transport
// model required by MCP 2026-07-28 multi round-trip requests: input_required
// returns to the client, and the later request reconstructs the server from
// the tool arguments plus protocol-managed inputResponses.
function makeHandler(route: string, registrars: ToolRegistrar[]) {
  return {
    fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
      const handler = createMcpHandler(() => {
        // Resolve the OAuth props lazily while the tool runs. OAuthProvider
        // establishes this request context before calling the MCP handler.
        const executor = ((args, options) => {
          const props = getMcpAuthContext()?.props as GogProps | undefined;
          if (!props?.key) throw new Error('Missing authenticated gogcli connector key');
          return resolveFlyExecutor(env.FLY_ENDPOINT, props.key)(args, options);
        }) satisfies ReturnType<typeof resolveFlyExecutor>;

        // `instructions` is the connector's only channel to the model that is
        // not a tool description. It explains that connector authentication
        // does not prove the Google credential itself is healthy.
        const server = new McpServer(
          { name: 'gogcli-mcp', version: VERSION },
          { instructions: CONNECTOR_INSTRUCTIONS },
        );
        const wrapped = wrapServer(server, executor);
        for (const register of registrars) register(wrapped);
        return server;
      }, {
        route,
        allowedHostnames: ['connector.gogcli.nullnet.app'],
      });
      return handler(request, env, ctx);
    },
  };
}

// auth + <service> base + <service> extras — the exact set each sub-package's
// stdio server exposes. The auth registrar is bound to THIS service's default
// `services` (least-privilege): a per-service connector re-auths requesting only
// its own scopes, so one unregistered scope for a service it doesn't wrap can't
// poison its re-auth with invalid_scope. The base /mcp agent keeps 'all'.
const svc = (service: string, base: ToolRegistrar, extra: ToolRegistrar): ToolRegistrar[] =>
  [authToolsFor(service), base, extra];

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
    '/mcp/sheets': makeHandler('/mcp/sheets', svc('sheets', registerSheetsTools, registerExtraSheetsTools)) as never,
    '/mcp/gmail': makeHandler('/mcp/gmail', svc('gmail', registerGmailTools, registerExtraGmailTools)) as never,
    '/mcp/drive': makeHandler('/mcp/drive', svc('drive,driveactivity,drivelabels', registerDriveTools, registerExtraDriveTools)) as never,
    '/mcp/docs': makeHandler('/mcp/docs', svc('docs', registerDocsTools, registerExtraDocsTools)) as never,
    '/mcp': makeHandler('/mcp', BASE_TOOL_REGISTRARS) as never,
  },
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});

export default handler;
