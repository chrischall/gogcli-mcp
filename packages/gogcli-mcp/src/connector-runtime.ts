import { runExecutor } from './runner.js';
import type { GogExecutor } from './runner.js';

// Runtime helpers for the Cloudflare connector (worker.ts), split out here so
// they can be unit-tested under the node pool — worker.ts itself imports the
// Worker-only `@chrischall/mcp-connector`/`agents` runtime and cannot load in
// node. These helpers touch only the `runExecutor` seam and global `fetch`.

// Mirrors runner.ts's TIMEOUT_MS: the budget the stdio path gives a `gog` call
// before it kills the child. Duplicated rather than imported to keep this module
// free of the spawn-side surface.
const DEFAULT_TIMEOUT_MS = 30_000;

// Headroom on top of the backend's own budget. The Fly runner kills `gog` and
// returns a real error; we only want the client deadline to fire when the
// backend cannot answer at all (scale-to-zero cold start that never wakes, or a
// wedged machine). Firing first would turn a useful "gog exited 1" into an
// opaque timeout.
const DEADLINE_GRACE_MS = 5_000;

// Build a GogExecutor that forwards a fully-assembled `gog` arg-array to the Fly
// backend's `/run` endpoint.
//
// The backend (and the `gog` process it spawns) own timeout/interactive
// behaviour, so `opts` does not change what the backend does — but `timeout`
// still has to be honoured HERE as a client-side deadline. Workers' `fetch` has
// no default timeout, and the stdio path's kill lives in a child process this
// path never spawns, so without an explicit signal a cold or wedged backend
// hangs the MCP request indefinitely with nothing to interrupt it.
export function makeFlyExecutor(endpoint: string, key: string): GogExecutor {
  return async (args, opts) => {
    const deadlineMs = (opts?.timeout ?? DEFAULT_TIMEOUT_MS) + DEADLINE_GRACE_MS;
    let res: Response;
    try {
      res = await fetch(endpoint + '/run', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ args }),
        signal: AbortSignal.timeout(deadlineMs),
      });
    } catch (err) {
      // AbortSignal.timeout rejects with a TimeoutError; a caller-supplied abort
      // surfaces as AbortError. Either way the bare message ("The operation was
      // aborted") says nothing about which backend failed to answer.
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(
          `gog-runner did not respond within ${deadlineMs}ms (${endpoint}) — the Fly backend may be cold or wedged`,
        );
      }
      throw err;
    }
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error || 'gog-runner HTTP ' + res.status);
    }
    const { stdout } = (await res.json()) as { stdout: string };
    return stdout;
  };
}

// Wrap an McpServer in a Proxy whose `registerTool` (and `tool`, if any
// registrar uses it) intercepts the tool handler so it runs inside the
// `runExecutor` ALS scope. This is the crux of the connector: it lets the
// UNCHANGED base registrars forward every `gog` call to the per-session Fly
// executor without any change to the registrars or `runner.ts` — when a
// handler's `run()` looks up `runExecutor.getStore()` it finds `executor` and
// forwards instead of spawning. Everything else proxies through via Reflect.
export function wrapServer<T extends object>(server: T, executor: GogExecutor): T {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'registerTool' || prop === 'tool') {
        const orig = (target as Record<string | symbol, (...a: unknown[]) => unknown>)[prop].bind(target);
        return (...args: unknown[]) => {
          const handler = args[args.length - 1];
          if (typeof handler === 'function') {
            args[args.length - 1] = (...h: unknown[]) =>
              runExecutor.run({ executor }, () => (handler as (...a: unknown[]) => unknown)(...h));
          }
          return orig(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
