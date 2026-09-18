#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerDriveTools, useRemoteGogRunner, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from './tools/drive-extra.js';


// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-drive',
  version: VERSION,
  tools: [authToolsFor('drive,driveactivity,drivelabels'), registerDriveTools, registerExtraDriveTools],
});
