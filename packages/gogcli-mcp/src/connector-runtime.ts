import { runExecutor } from './runner.js';
import type { GogExecutor } from './runner.js';

// Runtime helpers for the Cloudflare connector (worker.ts), split out here so
// they can be unit-tested under the node pool — worker.ts itself imports the
// Worker-only `@chrischall/mcp-connector`/`agents` runtime and cannot load in
// node. These helpers touch only the `runExecutor` seam and global `fetch`.

// Build a GogExecutor that forwards a fully-assembled `gog` arg-array to the Fly
// backend's `/run` endpoint. The backend (and the `gog` process it spawns)
// handle timeouts/interactive behaviour, so the executor `opts` are ignored.
export function makeFlyExecutor(endpoint: string, key: string): GogExecutor {
  return async (args) => {
    const res = await fetch(endpoint + '/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args }),
    });
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
