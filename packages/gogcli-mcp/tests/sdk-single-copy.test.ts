import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Keep the modular SDK v2 server on one physical copy: its McpServer class
// carries private state, so duplicate copies produce nominal TypeScript failures
// that look like API incompatibilities.
const here = createRequire(import.meta.url);

const resolveFrom = (specifier: string, target: string): string =>
  realpathSync(createRequire(fileURLToPath(import.meta.resolve(specifier))).resolve(target));

describe('the MCP server SDK is installed exactly once', () => {
  const MODERN_SERVER = '@modelcontextprotocol/server';

  it('keeps the SDK v2 server shared by this package and mcp-utils', () => {
    expect(resolveFrom('@chrischall/mcp-utils', MODERN_SERVER)).toBe(
      realpathSync(here.resolve(MODERN_SERVER)),
    );
  });
});
