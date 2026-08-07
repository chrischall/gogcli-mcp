#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerSheetsTools } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSheetsTools } from './tools/sheets-extra.js';
import { useRemoteGogRunner } from '../../gogcli-mcp/src/remote-runner.js';


// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

await runMcp({
  name: 'gogcli-sheets',
  version: VERSION,
  tools: [authToolsFor('sheets'), registerSheetsTools, registerExtraSheetsTools],
});
