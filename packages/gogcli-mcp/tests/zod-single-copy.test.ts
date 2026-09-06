import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The zod counterpart of sdk-single-copy.test.ts, guarding the invariant that
// broke dependabot #333: the whole monorepo must resolve ONE copy of zod.
//
// Same shape of failure, a different package. `@cloudflare/vitest-pool-workers`
// (a root devDependency) declares zod as an **exact** pin, so it takes the
// hoisted root slot that `@chrischall/mcp-utils` and the MCP SDK resolve their
// zod peer from. The moment our workspaces ask for a newer zod than that pin,
// each nests its own copy — and because a `ZodType` carries brand-bearing
// internals, TypeScript compares the two NOMINALLY: every schema our tools hand
// `registerTool` fails with `TS2322: Type 'ZodString' is not assignable to type
// 'AnySchema'`, with no API change and nothing to fix in the source. #333 split
// the tree exactly that way and produced 11,024 type errors from a bump of one
// patch-level dependency.
//
// Read the resolved paths in such an error, not the signature.
//
// This asserts resolution identity rather than a version string: the failure is
// "two copies", not "the wrong version", and pinning a version here would just
// have to be edited on every future bump.
describe('zod is installed exactly once', () => {
  const here = createRequire(import.meta.url);

  // `import.meta.resolve`, not `require.resolve`, to reach the dependency's own
  // entry: these packages are ESM-only, so their `exports` maps carry no
  // `require` condition and CJS resolution of the bare specifier throws.
  const resolveFrom = (specifier: string): string =>
    realpathSync(createRequire(fileURLToPath(import.meta.resolve(specifier))).resolve('zod'));

  it('resolves to the same file for this package and for @chrischall/mcp-utils', () => {
    // mcp-utils declares zod as a peer, and its `accountParam` / `viewParam` /
    // `paginationParams` helpers build the very schemas our registrars pass to
    // `registerTool`, so its copy is the one they must be typed against.
    expect(resolveFrom('@chrischall/mcp-utils')).toBe(realpathSync(here.resolve('zod')));
  });

  it('resolves to the same file for the MCP SDK, which types every tool schema', () => {
    // `registerTool` accepts the raw shape and infers the handler's argument
    // types from it; a second copy makes every one of those schemas foreign.
    expect(resolveFrom('@modelcontextprotocol/sdk/server/mcp.js')).toBe(
      realpathSync(here.resolve('zod')),
    );
  });

  it('resolves to the same file for @cloudflare/vitest-pool-workers, which exact-pins zod', () => {
    // The exact pin here is what captured the root hoist slot in #333, and it
    // is why the root `overrides` block carries a zod entry.
    expect(resolveFrom('@cloudflare/vitest-pool-workers')).toBe(
      realpathSync(here.resolve('zod')),
    );
  });
});
