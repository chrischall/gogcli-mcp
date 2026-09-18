#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerSlidesTools, bootstrapGogAuth } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from './tools/slides-extra.js';


// Seed gog's keyring from GOG_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCOUNT when the host injects them.
await bootstrapGogAuth();

await runMcp({
  name: 'gogcli-slides',
  version: VERSION,
  tools: [authToolsFor('slides'), registerSlidesTools, registerExtraSlidesTools],
});
