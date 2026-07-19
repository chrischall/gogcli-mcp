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
      // Two very different failures arrive as non-2xx, and collapsing them (as
      // this used to) is what made a real bug look like random flakiness:
      //
      //  a) The runner answered with its own JSON — `gog` actually ran on the
      //     box and failed. Deterministic: the same call will fail the same way.
      //  b) The body is NOT the runner's JSON (Fly's HTML error page, or empty).
      //     Then the request never reached `gog` at all; Fly's edge proxy is
      //     reporting that it could not reach the Machine — typically because
      //     the Machine was starting from scale-to-zero, or was mid-shutdown.
      //     Genuinely transient, and the only case worth retrying.
      const body = (await res.json().catch(() => null)) as
        | { error?: string; stderr?: string; retryable?: boolean }
        | null;
      if (body && typeof body.error === 'string') {
        const detail = body.stderr ? `${body.error}\n${body.stderr}` : body.error;
        // The runner's own drain response (503) is the one runner-authored
        // failure that IS worth retrying; everything else came from gog.
        throw new Error(
          body.retryable ? `gog-runner is restarting; retry this call. ${detail}` : detail,
        );
      }
      throw new Error(
        `gog-runner HTTP ${res.status}: the response did not come from the runner, ` +
        'so the request never reached gog. The backend Machine was most likely starting ' +
        'or shutting down — this is transient, retry the same call.',
      );
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
