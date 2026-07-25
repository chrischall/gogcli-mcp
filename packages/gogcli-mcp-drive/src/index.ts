#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerDriveTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from './tools/drive-extra.js';

await runMcp({
  name: 'gogcli-drive',
  version: VERSION,
  tools: [authToolsFor('drive,driveactivity,drivelabels'), registerDriveTools, registerExtraDriveTools],
});
