import { runExecutor } from './runner.js';
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
 * ## Why `enterWith` and not `run`
 *
 * `runExecutor` is an AsyncLocalStorage. The Worker wraps each REQUEST in
 * `runExecutor.run(...)` because a Worker isolate serves many of them and the
 * executor differs per user. A stdio process is one user for its whole life,
 * and its tool calls arrive later as I/O callbacks — which would NOT inherit a
 * store established by a `run()` that had already returned. `enterWith` sets it
 * for the remainder of this execution and everything descending from it, which
 * is the whole process. Using `run()` here would look correct and then fall
 * back to spawning on the first actual tool call.
 *
 * Call before the server starts, so no tool can be serviced ahead of it.
 */
export function useRemoteGogRunner(env: NodeJS.ProcessEnv = process.env): boolean {
  // Read directly and trim: an MCP host that passes an unexpanded `${...}`
  // placeholder or a blank string should read as "not configured", not as a URL.
  const clean = (v: string | undefined): string | undefined => {
    const t = (v ?? '').trim();
    return !t || t.startsWith('${') ? undefined : t;
  };
  const endpoint = clean(env.GOG_RUNNER_URL);
  const key = clean(env.GOG_RUNNER_KEY);
  // Both or neither. A URL with no key would send unauthenticated requests the
  // runner rejects, and a key with no URL is a credential configured for
  // nothing — either alone is a misconfiguration, and silently spawning
  // instead would hide it until someone wondered why the binary was needed.
  if (!endpoint || !key) return false;
  runExecutor.enterWith({ executor: makeFlyExecutor(endpoint.replace(/\/+$/, ''), key) });
  return true;
}
