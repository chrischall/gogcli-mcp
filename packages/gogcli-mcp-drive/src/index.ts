#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerDriveTools, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from './tools/drive-extra.js';


// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-drive',
  version: VERSION,
  tools: [authToolsFor('drive,driveactivity,drivelabels'), registerDriveTools, registerExtraDriveTools],
});
