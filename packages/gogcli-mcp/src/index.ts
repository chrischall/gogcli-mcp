#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { BASE_TOOL_REGISTRARS, VERSION } from './server.js';
import { bootstrapGogAuth } from './bootstrap-auth.js';


// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli',
  version: VERSION,
  tools: BASE_TOOL_REGISTRARS,
});
