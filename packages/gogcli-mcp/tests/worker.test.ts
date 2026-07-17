import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { BASE_TOOL_REGISTRARS } from '../src/lib.js';

// Handshake + tool-surface test for the gogcli Cloudflare remote connector, run
// inside the real Workers runtime (Miniflare) via `@cloudflare/vitest-pool-workers`
// against `wrangler.jsonc`. It proves things that don't require a live Fly
// backend or an authenticated session:
//   1. the OAuth default handler serves discovery + the login page;
//   2. an unauthenticated `/mcp` request is rejected before any tool code runs;
//   3. the base registrars register the full gog tool surface.
//
// The full authenticated `initialize` + `tools/list` over `/mcp` requires a real
// OAuth access token minted via `workers-oauth-provider`'s KV-backed grant flow
// (POST /authorize with a real connector key → auth code → POST /token), which
// would mean a live Fly login or extensive KV mocking — out of scope for a
// hermetic in-process test. So #3 asserts tool registration through the same
// in-memory MCP harness the stdio suite uses, wired exactly as `worker.ts` wires
// it (BASE_TOOL_REGISTRARS), rather than through the token-gated `/mcp` route.

describe('gogcli Cloudflare connector — OAuth surface', () => {
  it('serves the OAuth authorization-server discovery document', async () => {
    const res = await SELF.fetch('https://example.com/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
    expect(meta.authorization_endpoint).toContain('/authorize');
    expect(meta.token_endpoint).toContain('/token');
  });

  it('rejects an unauthenticated /mcp request', async () => {
    const res = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /authorize renders the gogcli login page with the connector-key field', async () => {
    // No `client_id` query param: the login page renders without needing a
    // registered OAuth client, which is all we verify here.
    const res = await SELF.fetch('https://example.com/authorize?response_type=code&state=abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('gogcli');
    expect(html).toContain('gogcli connector key');
    expect(html).toContain('type="password"');
  });
});

describe('gogcli Cloudflare connector — tool surface', () => {
  it('registers the base gog tool set via the same registrars as worker.ts', async () => {
    // Mirror src/worker.ts's `tools` wiring: register every BASE_TOOL_REGISTRARS
    // onto the in-memory harness server (no executor needed just to list tools).
    const harness = await createTestHarness((server) => {
      for (const register of BASE_TOOL_REGISTRARS) register(server);
    });

    try {
      const names = (await harness.listTools()).map((t) => t.name);
      // Spot-check representative tools from multiple services + a run escape hatch.
      expect(names).toContain('gog_sheets_get');
      expect(names).toContain('gog_gmail_search');
      expect(names).toContain('gog_drive_ls');
      expect(names).toContain('gog_sheets_run');
      // The base package exposes a broad multi-service surface.
      expect(names.length).toBeGreaterThan(50);
    } finally {
      await harness.close();
    }
  });
});
