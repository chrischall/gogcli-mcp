#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION, authToolsFor, registerSlidesTools, useRemoteGogRunner } from '../../gogcli-mcp/src/lib.js';
import { registerExtraSlidesTools } from './tools/slides-extra.js';

// Execute `gog` on the Fly backend when the host points us at one; without
// it, nothing changes and we spawn the local binary as before.
useRemoteGogRunner();

await runMcp({
  name: 'gogcli-slides',
  version: VERSION,
  tools: [authToolsFor('slides'), registerSlidesTools, registerExtraSlidesTools],
});
