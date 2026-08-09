import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guards the invariant that broke dependabot #220: the whole monorepo must
// resolve ONE copy of @modelcontextprotocol/sdk.
//
// `McpServer` carries a `private _serverInfo`, so TypeScript compares it
// NOMINALLY, not structurally. Two installed copies therefore become two
// mutually-unassignable classes, and every `ToolRegistrar` in server.ts fails
// with TS2322 — with no API change and no source change anywhere. #220 split
// the tree exactly that way: `agents` (a root devDependency, the Worker
// connector's McpAgent) exact-pins the SDK to 1.29.0 and so takes the hoisted
// root slot that `@chrischall/mcp-utils` resolves its peer from, while the
// workspaces asking for ^1.30.0 each nested their own copy.
//
// This asserts resolution identity rather than a version string: the failure is
// "two copies", not "the wrong version", and pinning a version here would just
// have to be edited on every future bump.
describe('@modelcontextprotocol/sdk is installed exactly once', () => {
  const here = createRequire(import.meta.url);

  // An exported subpath — the SDK's `exports` map does not expose package.json.
  const SDK_SUBPATH = '@modelcontextprotocol/sdk/server/mcp.js';

  // `import.meta.resolve`, not `require.resolve`, to reach the dependency's own
  // entry: these packages are ESM-only, so their `exports` maps carry no
  // `require` condition and CJS resolution of the bare specifier throws.
  const resolveFrom = (specifier: string): string =>
    realpathSync(
      createRequire(fileURLToPath(import.meta.resolve(specifier))).resolve(SDK_SUBPATH),
    );

  it('resolves to the same file for this package and for @chrischall/mcp-utils', () => {
    // mcp-utils declares the SDK as a peer and hands our registrars the
    // McpServer it built, so its copy is the one they must be typed against.
    expect(resolveFrom('@chrischall/mcp-utils')).toBe(
      realpathSync(here.resolve(SDK_SUBPATH)),
    );
  });

  it('resolves to the same file for `agents`, which exact-pins the SDK', () => {
    // The Worker connector builds its McpServer via McpAgent from `agents`.
    // An exact pin there is what captured the root hoist slot in #220.
    expect(resolveFrom('agents')).toBe(realpathSync(here.resolve(SDK_SUBPATH)));
  });
});
