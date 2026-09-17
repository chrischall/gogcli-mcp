import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Worker runtime still installs the legacy SDK through Cloudflare Agents,
// while this project itself now uses the modular SDK v2 server.
// Keep each lane on one physical copy: both server classes carry private state,
// so duplicate copies produce nominal TypeScript failures that look like API
// incompatibilities.
const here = createRequire(import.meta.url);

const resolveFrom = (specifier: string, target: string): string =>
  realpathSync(createRequire(fileURLToPath(import.meta.resolve(specifier))).resolve(target));

describe('MCP SDK packages are each installed exactly once', () => {
  const LEGACY_SERVER = '@modelcontextprotocol/sdk/server/mcp.js';
  const MODERN_SERVER = '@modelcontextprotocol/server';

  it('keeps the retained legacy lane used by agents at the root', () => {
    const root = realpathSync(here.resolve(LEGACY_SERVER));
    expect(resolveFrom('agents', LEGACY_SERVER)).toBe(root);
  });

  it('keeps the SDK v2 server shared by this package and mcp-utils', () => {
    expect(resolveFrom('@chrischall/mcp-utils', MODERN_SERVER)).toBe(
      realpathSync(here.resolve(MODERN_SERVER)),
    );
  });
});
