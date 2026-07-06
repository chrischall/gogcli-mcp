#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, registerAuthTools, registerDriveTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraDriveTools } from './tools/drive-extra.js';

await runMcp({
  name: 'gogcli-drive',
  version: VERSION,
  tools: [registerAuthTools, registerDriveTools, registerExtraDriveTools],
});
