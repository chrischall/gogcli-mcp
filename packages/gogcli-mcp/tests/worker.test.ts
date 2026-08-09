import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { ToolRegistrar } from '@chrischall/mcp-utils';
import {
  BASE_TOOL_REGISTRARS,
  registerAuthTools,
  registerSheetsTools,
  registerGmailTools,
  registerDriveTools,
  registerDocsTools,
} from '../src/lib.js';
import { registerExtraSheetsTools } from '../../gogcli-mcp-sheets/src/tools/sheets-extra.js';
import { registerExtraGmailTools } from '../../gogcli-mcp-gmail/src/tools/gmail-extra.js';
import { registerExtraDriveTools } from '../../gogcli-mcp-drive/src/tools/drive-extra.js';
import { registerExtraDocsTools } from '../../gogcli-mcp-docs/src/tools/docs-extra.js';

// Each per-service MCP path exposes auth + <service> base + <service> extras —
// the same tool set that sub-package's stdio server exposes. Mirror worker.ts's
// wiring. Min counts are conservative floors (base+auth alone is ~13-15).
const SERVICE_PATHS: Array<{
  path: string;
  regs: ToolRegistrar[];
  baseTool: string;
  minTools: number;
}> = [
  { path: '/mcp/sheets', regs: [registerAuthTools, registerSheetsTools, registerExtraSheetsTools], baseTool: 'gog_sheets_get', minTools: 40 },
  { path: '/mcp/gmail', regs: [registerAuthTools, registerGmailTools, registerExtraGmailTools], baseTool: 'gog_gmail_search', minTools: 40 },
  { path: '/mcp/drive', regs: [registerAuthTools, registerDriveTools, registerExtraDriveTools], baseTool: 'gog_drive_ls', minTools: 35 },
  { path: '/mcp/docs', regs: [registerAuthTools, registerDocsTools, registerExtraDocsTools], baseTool: 'gog_docs_cat', minTools: 60 },
];

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

  // Each per-service path is wired as an auth-gated API route (→ 401), not a
  // 404 from the default handler. (A 401 confirms the path is registered and
  // token-gated; correct routing to the SERVICE agent vs the base agent is
  // verified live post-deploy via an authenticated tools/list.)
  for (const { path } of SERVICE_PATHS) {
    it(`rejects an unauthenticated ${path} request`, async () => {
      const res = await SELF.fetch(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(res.status).toBe(401);
    });
  }

  it('GET /authorize renders the gogcli login page with the connector-key field', async () => {
    // `/authorize` is only reachable for a REGISTERED client, so the request has
    // to be preceded by a real dynamic client registration.
    //
    // It did not always: workers-oauth-provider 0.8.x parsed the request without
    // a `client_id` (it only called validateRedirectUriScheme unconditionally,
    // which is why `redirect_uri` was already here). 0.10.x moved the
    // `client_id is required` check and the client lookup ahead of everything
    // else in parseAuthRequest, so the old URL now throws before the login page
    // is ever rendered — an AuthorizationError from inside the library, not from
    // any code in this repo. Registering first is the fix, and it exercises the
    // path a real client actually takes.
    const redirectUri = 'https://example.com/callback';
    const registration = await SELF.fetch('https://example.com/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'worker test client',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(registration.status).toBe(201);
    const { client_id: clientId } = (await registration.json()) as { client_id: string };
    expect(clientId).toBeTruthy();

    // PKCE is mandatory for a public client (`token_endpoint_auth_method: none`)
    // on the authorization-code flow, and the provider enforces it during the
    // same parse. The challenge is never redeemed here — this test stops at the
    // rendered page — so any well-formed S256 value will do.
    const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const res = await SELF.fetch(
      'https://example.com/authorize?response_type=code&state=abc' +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    );
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

  // Each per-service path registers auth + that service's base + its EXTRAS —
  // proving the extended tool set is wired (well past the ~13 base+auth tools).
  for (const { path, regs, baseTool, minTools } of SERVICE_PATHS) {
    it(`${path} registers the extended ${baseTool.split('_')[1]} tool set (base + extras)`, async () => {
      const harness = await createTestHarness((server) => {
        for (const register of regs) register(server);
      });
      try {
        const names = (await harness.listTools()).map((t) => t.name);
        expect(names).toContain(baseTool); // the service's base op
        expect(names).toContain('gog_auth_list'); // auth tools included
        expect(names.length).toBeGreaterThan(minTools); // extras present, not just base
      } finally {
        await harness.close();
      }
    });
  }
});
