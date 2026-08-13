import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { BASE_TOOL_REGISTRARS } from '../src/server.js';

// The bug this guards against was a NAME mismatch: the cursor was called `page`
// while every response reports `nextPageToken`, and MCP inputs are zod objects
// that silently strip unknown keys — so a client guessing the name from the
// response got page 1 forever, with no error. Prose that steers a caller back
// to the deprecated alias re-creates exactly that trap, one tool at a time.

type ToolDef = { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } };

async function allTools(): Promise<ToolDef[]> {
  const harness = await createTestHarness((server) => {
    for (const register of BASE_TOOL_REGISTRARS) register(server);
  });
  const { tools } = await harness.client.listTools();
  await harness.close();
  return tools as ToolDef[];
}

describe('page-cursor contract across every base tool', () => {
  it('never tells a caller to pass the cursor as the deprecated `page`', async () => {
    // The alias as its own token: `page` closed immediately, which `pageToken`
    // can never match. A looser pattern matches the correct name's prefix and
    // fails on a description that is already right.
    const offenders = (await allTools())
      .filter((t) => /`page`|\bas page\b/i.test(t.description ?? ''))
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it('always offers the `page` alias wherever `pageToken` is accepted', async () => {
    const mismatched = (await allTools())
      .filter((t) => {
        const props = t.inputSchema?.properties ?? {};
        return 'pageToken' in props && !('page' in props);
      })
      .map((t) => t.name);
    expect(mismatched).toEqual([]);
  });

  it('names the cursor after the response field wherever one is paginated', async () => {
    const tools = await allTools();
    const withCursor = tools.filter((t) => 'pageToken' in (t.inputSchema?.properties ?? {}));
    // Guards the audit itself: if this ever drops to zero the two tests above
    // pass vacuously and the contract stops being checked at all.
    expect(withCursor.length).toBeGreaterThan(0);
  });
});
