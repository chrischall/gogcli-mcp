#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerGmailTools, useRemoteGogRunner, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { registerExtraGmailTools } from './tools/gmail-extra.js';


// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-gmail',
  version: VERSION,
  tools: [authToolsFor('gmail'), registerGmailTools, registerExtraGmailTools],
});
