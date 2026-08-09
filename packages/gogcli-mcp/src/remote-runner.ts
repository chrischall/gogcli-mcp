import { readEnvVar } from '@chrischall/mcp-utils';
import { setDefaultGogExecutor } from './runner.js';
import { makeFlyExecutor } from './connector-runtime.js';

/**
 * Let a stdio server run `gog` on the Fly backend instead of spawning it.
 *
 * The default stdio path shells out to the `gog` binary (`runner.ts`,
 * `spawn(GOG_PATH ?? 'gog')`), which is right on a laptop and impossible
 * anywhere the binary is not installed — notably mcp-host, whose runner image
 * is deliberately Node + git + tar and nothing else. Baking a Go binary into a
 * generic runner for one MCP's sake, or curling an unpinned release tarball
 * inside an install, are both worse than using the seam that already exists:
 * `makeFlyExecutor` has forwarded arg-arrays to `<runner>/run` for the
 * Cloudflare connector since that connector shipped, and it touches nothing
 * Worker-only.
 *
 * So this is wiring, not new machinery. Set both variables and the process
 * executes remotely; leave either unset and nothing changes, which is what
 * keeps every existing local install on the binary it already has.
 *
 * ## Why a process-wide default and not the AsyncLocalStorage
 *
 * `runExecutor` is an AsyncLocalStorage, and the Worker wraps each REQUEST in
 * `runExecutor.run(...)` because one isolate serves many callers whose backend
 * credentials differ. A stdio process is the opposite: one backend for its
 * whole life.
 *
 * This used to reach for `enterWith` on the theory that it "sets the store for
 * the whole process". It does not. `enterWith` sets the store on the async
 * resource that is CURRENT when it runs — here, module evaluation — and the
 * tool calls arrive later as I/O events on the transport's own resources, which
 * do not descend from that. So `getStore()` was undefined at exactly the moment
 * `run()` asked, and the seam reverted to spawning a binary the host does not
 * have. Every hosted gog MCP answered "gog executable not found" while pointed
 * at a healthy backend, and the unit test missed it because a test that calls
 * this function itself awaits inside the resource it just mutated.
 *
 * A process-lifetime value is not a scoped value, so it does not live in a
 * scope: `setDefaultGogExecutor` holds it, and a per-request store still beats
 * it (runner.ts `activeExecutor`) so the Worker path is unchanged.
 *
 * Call before the server starts, so no tool can be serviced ahead of it.
 */
export function useRemoteGogRunner(env: NodeJS.ProcessEnv = process.env): boolean {
  // The shared reader, not a local trim: it already treats blanks, unexpanded
  // `${...}` placeholders AND the literal strings "undefined"/"null" as unset.
  // Those last two are what a hand-rolled check misses, and they arrive whenever
  // a host stringifies a missing value into an env block.
  const endpoint = readEnvVar('GOG_RUNNER_URL', { env });
  const key = readEnvVar('GOG_RUNNER_KEY', { env });
  // Both or neither. A URL with no key would send unauthenticated requests the
  // runner rejects, and a key with no URL is a credential configured for
  // nothing — either alone is a misconfiguration, and silently spawning
  // instead would hide it until someone wondered why the binary was needed.
  if (!endpoint || !key) return false;
  setDefaultGogExecutor(makeFlyExecutor(endpoint.replace(/\/+$/, ''), key));
  return true;
}
