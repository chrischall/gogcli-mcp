#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { BASE_TOOL_REGISTRARS, VERSION } from './server.js';
import { useRemoteGogRunner } from './remote-runner.js';
import { bootstrapGogAuth } from './bootstrap-auth.js';


// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli',
  version: VERSION,
  tools: BASE_TOOL_REGISTRARS,
});
