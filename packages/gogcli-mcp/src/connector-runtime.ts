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

// Status codes the Fly runner uses to classify its OWN failures. These must stay
// in sync with fly-gog-runner/server.mjs — they are the contract that lets this
// side tell "gog ran and failed" apart from "the request never arrived", without
// having to guess from the response body.
//
// 422: `gog` executed and exited non-zero. Deterministic — never retry.
// 503: the runner is draining (SIGINT from Fly's autostop). Transient — retry.
// Any other non-2xx: infrastructure, i.e. Fly's edge, not us.
const RUNNER_GOG_FAILED = 422;
const RUNNER_DRAINING = 503;

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
      const detail =
        body && typeof body.error === 'string'
          ? body.stderr && body.stderr.trim() && body.stderr.trim() !== body.error.trim()
            ? `${body.error}\n${body.stderr}`
            : body.error
          : '';

      // 422 is the runner's "gog ran and exited non-zero" status. It is only
      // ever produced by our own handler, so reaching here proves the request
      // was delivered and executed. Deterministic — say so, and say nothing
      // that invites a retry.
      if (res.status === RUNNER_GOG_FAILED) {
        throw new Error(detail || 'gog failed on the runner (no detail supplied)');
      }

      // The runner's drain response: it is up, but deliberately refusing new
      // work while it shuts down. The one runner-authored failure worth retrying.
      if (res.status === RUNNER_DRAINING || body?.retryable === true) {
        throw new Error(
          `gog-runner is restarting; retry this call.${detail ? ` ${detail}` : ''}`,
        );
      }

      // Anything else non-2xx is infrastructure: Fly's edge could not reach the
      // Machine, or the Machine answered with something that is not ours. Only
      // claim the request never arrived when there is genuinely no runner body
      // — a runner that did answer deserves to have its own words repeated.
      //
      // The status is deliberately NOT interpolated here. A runner body proves
      // gog ran, so this is a deterministic failure; embedding the literal
      // status would put "502" into the message, which matches
      // TRANSIENT_ERROR_PATTERN (/\b5\d\d\b/) in tools/utils.ts and re-attaches
      // the very "this is transient, retry the same call" hint this change
      // exists to remove — reintroducing the bug during the rollout window this
      // branch exists to cover. Anything genuinely transient in gog's own text
      // (a Google 5xx, say) still matches on its own merits, which is correct.
      if (detail) {
        throw new Error(detail);
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
