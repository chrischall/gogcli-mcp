import { createConnector } from '@chrischall/mcp-connector';
import { BASE_TOOL_REGISTRARS } from './lib.js';
import type { GogExecutor } from './lib.js';
import { makeFlyExecutor, wrapServer } from './connector-runtime.js';
import { gogAuth, type GogProps } from './connector-auth.js';

// The Cloudflare remote-connector entrypoint for gogcli-mcp.
//
// It reuses the base package's EXISTING transport-neutral tool registrars
// (`BASE_TOOL_REGISTRARS`, the same ones the stdio server boots) UNCHANGED, and
// executes every assembled `gog` arg-array by forwarding it to a Fly.io backend
// over authenticated HTTPS instead of spawning a local `gog` process (a Worker
// cannot spawn processes).
//
// The bridge is the `runExecutor` AsyncLocalStorage seam in `runner.ts`: each
// tool handler runs inside `runExecutor.run({ executor }, ...)`, so when its
// `run()` call looks up `runExecutor.getStore()` it finds the per-session Fly
// executor and forwards the arg-array to `POST <FLY_ENDPOINT>/run` rather than
// spawning. `wrapServer` below is what injects that scope around every handler
// the unchanged registrars register.
//
// Auth is a FIELD LOGIN (a personal connector key), NOT Google OAuth — see
// `connector-auth.ts`. The Google OAuth handshake lives inside the Fly backend.

interface GogClient {
  executor: GogExecutor;
}

const { Agent, handler } = createConnector<GogProps, GogClient>({
  name: 'gogcli-mcp',
  version: '2.14.0', // x-release-please-version
  auth: gogAuth,
  buildClient: (props, env) => ({
    executor: makeFlyExecutor((env as any).FLY_ENDPOINT, props.key),
  }),
  // Reuse the base server's registrars unchanged; each one is wrapped so its
  // handlers run inside the per-session Fly executor's ALS scope.
  tools: BASE_TOOL_REGISTRARS.map(
    (reg) => (server: any, client: GogClient) =>
      // `reg` is a ToolRegistrar (server, deps) — the base registrars ignore the
      // second arg, but pass `client` to satisfy its arity.
      reg(wrapServer(server, client.executor), client),
  ),
});

// The connector's per-session MCP agent Durable Object
// (`wrangler.jsonc`'s `MCP_OBJECT` → `GogcliMcpAgent`) resolves this export.
export { Agent as GogcliMcpAgent };

export default handler;
